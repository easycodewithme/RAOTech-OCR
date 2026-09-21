import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Prisma, type User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet, TTL } from "@/lib/serverCache";
import { trace, traceAsync } from "@/lib/trace";

export const userCacheKey = (clerkId: string) => `user:${clerkId}`;

/**
 * Clerk user ids are `user_` + a base58 suffix, and have been for the whole
 * life of this product. Anything stored in `User.clerkId` that does not look
 * like one was never written by a Clerk sign-in — it is a placeholder from
 * before this column was the join key. That distinction is the entire gate on
 * the adoption path below, so it lives here with its reasoning attached.
 */
const CLERK_ID_SHAPE = /^user_[A-Za-z0-9]+$/;

/** True only for a P2002 raised by the `User.email` unique constraint. */
function isEmailTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes("email");
  return typeof target === "string" ? target.includes("email") : false;
}

/**
 * Resolve the database User for the current Clerk session, creating it on first
 * use. Returns null when unauthenticated.
 *
 * **`clerkId` is the join key. `email` is an attribute.** This used to be the
 * other way round — the cold path upserted `where: { email }` — and that meant
 * any Clerk account presenting a known email address took ownership of the
 * matching User row, and with it every Client, Invoice, Voucher, Ledger and
 * paired connector device hanging off it. Email addresses get reassigned inside
 * a firm; a Clerk account is the thing that actually authenticated. Matching on
 * the mutable one silently transferred a client's books.
 *
 * Memoised per request: a single page render calls this several times (directly
 * and via getActiveClient), and each call used to cost a Clerk API round trip
 * plus a write to Postgres.
 */
export const getDbUser = cache(async () => {
  return traceAsync("getDbUser", "resolve", async () => {
    // auth() decodes the session cookie locally — no network call, unlike
    // currentUser(), which hits Clerk's API every time.
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      trace("getDbUser", "no-auth-session");
      return null;
    }

    // Warm instance: no round trip at all.
    const cached = cacheGet<User>(userCacheKey(clerkId));
    if (cached) {
      trace("getDbUser", "cache-hit", { clerkId });
      return cached;
    }
    trace("getDbUser", "cache-miss", { clerkId });

    // Hot path: one indexed read, no write.
    const existing = await traceAsync(
      "getDbUser",
      "db-find-by-clerkId",
      () => prisma.user.findUnique({ where: { clerkId } }),
      { clerkId }
    );
    if (existing) return cacheSet(userCacheKey(clerkId), existing, TTL.user);

    // Cold path: this Clerk account has no row yet.
    const user = await traceAsync("getDbUser", "clerk-currentUser", () => currentUser(), { clerkId });
    if (!user) return null;
    const email = user.emailAddresses[0]?.emailAddress;
    if (!email) return null;
    const name = user.firstName || user.username || "User";

    try {
      // Upsert on clerkId, never on email. The `update` branch only fires if a
      // concurrent request created the row between the read above and this
      // write, and it touches only attributes — it can never repoint a row at
      // a different account, because the row it finds is already ours.
      const created = await traceAsync(
        "getDbUser",
        "db-upsert-user",
        () =>
          prisma.user.upsert({
            where: { clerkId },
            update: { email, name },
            create: { clerkId, email, name },
          }),
        { clerkId, email }
      );
      return cacheSet(userCacheKey(clerkId), created, TTL.user);
    } catch (error) {
      // Anything other than "that email is already on another row" is a real
      // failure and must not be swallowed into a null (which reads as "signed
      // out" three layers up).
      if (!isEmailTaken(error)) throw error;
    }

    // ---------------------------------------------------------------------
    // One-time migration path, and deliberately nothing more.
    //
    // Rows written before clerkId was the join key are found by email and
    // *adopted* — their clerkId is backfilled so every later request takes the
    // hot path — rather than duplicated, which the unique email constraint
    // would refuse anyway.
    //
    // The gate: we adopt only a row whose stored clerkId was never a real Clerk
    // account. A row already bound to some other `user_...` belongs to that
    // account, and re-pointing it is precisely the takeover this rewrite
    // exists to stop — so we refuse and leave the data alone. The cost of
    // refusing is that a user who deleted and recreated their Clerk account
    // under the same address is locked out until an operator repoints the row
    // by hand. That is the right way round: a support ticket is recoverable,
    // handing one firm's ledgers to another login is not.
    // ---------------------------------------------------------------------
    const holder = await traceAsync(
      "getDbUser",
      "db-find-by-email",
      () => prisma.user.findUnique({ where: { email } }),
      { clerkId, email }
    );
    if (!holder) {
      // The colliding row vanished between the write and this read. Nothing to
      // adopt and nothing to hand back; the next request creates it cleanly.
      trace("getDbUser", "email-holder-vanished", { clerkId, email });
      return null;
    }
    if (holder.clerkId === clerkId) return cacheSet(userCacheKey(clerkId), holder, TTL.user);

    if (!CLERK_ID_SHAPE.test(holder.clerkId)) {
      // Conditional on the stale value, so two concurrent sign-ins cannot both
      // believe they adopted it.
      const adopted = await prisma.user.updateMany({
        where: { id: holder.id, clerkId: holder.clerkId },
        data: { clerkId, name },
      });
      trace("getDbUser", "adopted-legacy-row", {
        clerkId,
        email,
        userId: holder.id,
        previousClerkId: holder.clerkId,
        count: adopted.count,
      });
      const row = await prisma.user.findUnique({ where: { clerkId } });
      return row ? cacheSet(userCacheKey(clerkId), row, TTL.user) : null;
    }

    // Two live Clerk accounts, one email address. Not ours to resolve.
    console.error(
      "[getDbUser] refusing to rebind User row to a different Clerk account",
      { userId: holder.id, email, heldBy: holder.clerkId, presentedBy: clerkId }
    );
    return null;
  });
});
