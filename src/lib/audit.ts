import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { formatCount } from "@/lib/format";
import { trace } from "@/lib/trace";

/**
 * The recording end of the audit trail (REL-01).
 *
 * The only actor field this schema had was `Voucher.approvedBy`, and with one
 * login per firm that column is a constant — so the practice could not answer
 * the one question a regulated profession must be able to answer: *who posted
 * this to the client's books?* Deletions were recorded nowhere at all.
 *
 * Everything here writes to `AuditEvent`, which is append-only by convention:
 * nothing in this file updates or deletes a row, and nothing else should
 * either. The actor's email and name are copied in at write time rather than
 * joined on later, because the record has to still make sense after the staff
 * member has left the firm and their `User` row is gone.
 */

/**
 * The stable machine tokens. A closed union rather than free strings so the
 * read side can filter on them without a `LIKE`, and so a typo at a write site
 * is a type error instead of an event nobody can find again.
 *
 * These are deliberately *few*. One token per category of thing-that-happened,
 * not one per route: a firm owner filtering this screen is asking "show me the
 * approvals" or "show me what left for Tally", never "show me the approvals
 * that came from the bulk endpoint rather than the single one". Which endpoint
 * it was, how many vouchers, and whether a human or the confidence sweep chose
 * them all live in `summary` and `metadata`, where they read as English
 * instead of as a filter value nobody would guess.
 */
export const AUDIT_ACTIONS = [
  "VOUCHER_APPROVED",
  "VOUCHERS_PUSHED",
  "VOUCHERS_DELETED_FROM_TALLY",
  "INVOICE_DELETED",
  "MASTERS_CREATED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Narrow an untrusted query-string value onto the union. */
export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

/**
 * What a filter control and a table cell call each action.
 *
 * Lives beside the tokens so the API, the screen and any future export agree
 * on one wording. "Pushed to Tally" and "Deleted from Tally" are kept as
 * separate, unmistakable phrases on purpose: they are the two events that
 * change a client's live books, and reading one as the other is the mistake
 * this whole table exists to make impossible.
 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  VOUCHER_APPROVED: "Approved",
  VOUCHERS_PUSHED: "Pushed to Tally",
  VOUCHERS_DELETED_FROM_TALLY: "Deleted from Tally",
  INVOICE_DELETED: "Invoice deleted",
  MASTERS_CREATED: "Masters created in Tally",
};

/**
 * What the event is *about*, for the `[entityType, entityId]` index — the
 * "everything that ever happened to this voucher" query.
 *
 * `TALLY_COMPANY` is the subject for master creation: ledgers and stock items
 * are created in a batch addressed by name, so no single row is the thing that
 * changed — the company's chart of accounts is.
 */
export const AUDIT_ENTITY_TYPES = ["VOUCHER", "INVOICE", "TALLY_COMPANY"] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Identity as it will be frozen into the row. Every field is optional because
 * a missing actor must still produce an event: "we do not know who" is a far
 * better answer than no record that it happened at all.
 */
export interface AuditActor {
  clerkId?: string | null;
  email?: string | null;
  name?: string | null;
}

export interface RecordAuditEventInput {
  /** The firm. The tenant boundary — always the signed-in user's `User.id`. */
  userId: string;
  /** The client whose books were touched. Null for firm-level actions. */
  clientId?: string | null;
  action: AuditAction;
  entityType: AuditEntityType;
  /**
   * The single row this is about, when there is one. Left null for a batch —
   * see the granularity note on `recordAuditEvent`. Never a foreign key: the
   * row must outlive the thing it describes, which is exactly the case worth
   * auditing.
   */
  entityId?: string | null;
  /** One sentence a person reads without decoding `metadata`. */
  summary: string;
  /** Counts, ids, Tally's counters — anything with no column of its own. */
  metadata?: Record<string, unknown> | null;
  /**
   * Pre-resolved actor. Only for callers with no Clerk session to read — a
   * background job draining the sync queue, say. Request handlers omit it and
   * let the session answer.
   */
  actor?: AuditActor | null;
}

/**
 * Who is doing this, as Clerk knows them and as a human will read them.
 *
 * `getDbUser()` is memoised per request and every caller here has already gone
 * through `getActiveClient()`, so this is a cache hit rather than a second
 * round trip to Clerk and Postgres.
 *
 * Resolving the actor from the *session* rather than from the `userId` the
 * caller passed is the point of the whole exercise. Today they are the same
 * row, because a firm has one login. The moment staff get their own logins
 * (the `ClientMember` and `OrgMember` tables are already in the schema), the
 * tenant and the actor stop being the same thing, and every event written from
 * that day forward names the person instead of the firm — with no change at
 * any call site.
 */
async function resolveActor(explicit?: AuditActor | null): Promise<AuditActor> {
  if (explicit) return explicit;
  const user = await getDbUser();
  if (!user) return {};
  return { clerkId: user.clerkId, email: user.email, name: user.name };
}

/**
 * Write one audit event.
 *
 * **This must never break the operation it is recording.** An approval that
 * succeeded, or a push that is already on the queue, has happened whether or
 * not we managed to write a row about it — and turning a successful push into
 * a 500 would leave the caller retrying work that is already in the client's
 * books. So every failure here is caught, logged loudly enough to notice, and
 * swallowed. A missing audit row is a gap in the trail; a failed push that the
 * user repeats is a duplicate voucher in someone's live TallyPrime.
 *
 * It *is* awaited rather than fired and forgotten. The insert is a single
 * indexed write, and on a serverless runtime a promise still in flight when the
 * response returns is simply killed — which would drop exactly the events this
 * table exists for, silently and only in production.
 *
 * **Granularity: one event per operation, not per row.** A bulk approve of 200
 * vouchers writes ONE event ("Approved 200 vouchers for Acme Traders"), not 200.
 * The test is what a firm owner learns while scanning the screen: 200 identical
 * rows bury the delete that happened underneath them and teach the owner to
 * stop reading, while one row says the true thing — that at 14:32 someone
 * approved two hundred vouchers in a single action. The voucher ids go in
 * `metadata` so the detail is never lost, only folded.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  try {
    const actor = await resolveActor(input.actor);

    await prisma.auditEvent.create({
      data: {
        userId: input.userId,
        clientId: input.clientId ?? null,
        actorClerkId: actor.clerkId ?? null,
        actorEmail: actor.email ?? null,
        actorName: actor.name ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        // `metadata` is a Json column and Prisma types it as InputJsonValue,
        // which a `Record<string, unknown>` does not structurally satisfy. The
        // cast is safe because every call site passes plain JSON-able values;
        // widening the parameter type instead would push that cast out to five
        // routes rather than keeping it in one place.
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    trace("audit", "recorded", {
      action: input.action,
      userId: input.userId,
      clientId: input.clientId ?? null,
      entityId: input.entityId ?? null,
    });
  } catch (error) {
    // Loud, but non-fatal. See the contract above.
    console.error("[AUDIT_WRITE_FAILED]", {
      action: input.action,
      userId: input.userId,
      clientId: input.clientId ?? null,
      summary: input.summary,
      error,
    });
  }
}

/**
 * "1 voucher" / "34 vouchers", Indian-grouped.
 *
 * Four routes need this exact phrase in their summary and each had started
 * writing its own `count === 1 ? "" : "s"`. Counting goes through
 * `formatCount` so a batch of 1,20,000 reads the way every other number in
 * this product does.
 */
export function vouchersPhrase(count: number): string {
  return `${formatCount(count)} voucher${count === 1 ? "" : "s"}`;
}
