import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Identity resolution, which is the one thing in this codebase where being
 * wrong is unrecoverable: the cold path used to upsert `where: { email }`, so
 * any Clerk account presenting a known address took ownership of the User row
 * and every Client, Invoice, Voucher, Ledger and paired device beneath it.
 * The last test here is the one that matters — it asserts the refusal.
 */

type UpsertArgs = {
  where: { clerkId: string };
  update: Record<string, unknown>;
  create: Record<string, string>;
};

type UpdateManyArgs = {
  where: { id: string; clerkId: string };
  data: Record<string, unknown>;
};

const h = vi.hoisted(() => {
  const state = {
    byClerkId: new Map<string, Record<string, unknown>>(),
    byEmail: new Map<string, Record<string, unknown>>(),
    upsertCalls: [] as Record<string, unknown>[],
    updateManyCalls: [] as Record<string, unknown>[],
    clerkUserId: "user_new",
    clerkEmail: "ca@firm.in",
  };

  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, string> }) => {
        if (where.clerkId) return state.byClerkId.get(where.clerkId) ?? null;
        if (where.email) return state.byEmail.get(where.email) ?? null;
        return null;
      }),
      upsert: vi.fn(async (args: UpsertArgs) => {
        state.upsertCalls.push(args);
        const clerkId = args.where.clerkId as string;
        const found = state.byClerkId.get(clerkId);
        if (found) return found;
        const email = args.create.email as string;
        const holder = state.byEmail.get(email);
        if (holder) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "6.19.0",
            meta: { target: ["email"] },
          });
        }
        const row = { id: "uuid-new", ...args.create };
        state.byClerkId.set(clerkId, row);
        state.byEmail.set(email, row);
        return row;
      }),
      updateMany: vi.fn(async (args: UpdateManyArgs) => {
        state.updateManyCalls.push(args);
        for (const row of state.byEmail.values()) {
          if (row.id !== args.where.id) continue;
          if (row.clerkId !== args.where.clerkId) return { count: 0 };
          state.byClerkId.delete(row.clerkId as string);
          Object.assign(row, args.data);
          state.byClerkId.set(row.clerkId as string, row);
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
  };

  return { state, prisma };
});

// react's cache() memoises per render; there is no render here.
vi.mock("react", () => ({ cache: <T,>(fn: T) => fn }));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: h.state.clerkUserId })),
  currentUser: vi.fn(async () => ({
    id: h.state.clerkUserId,
    emailAddresses: [{ emailAddress: h.state.clerkEmail }],
    firstName: "Priya",
    username: null,
  })),
}));

// The real one is a module-level Map that would leak rows between tests.
vi.mock("@/lib/serverCache", () => {
  const store = new Map<string, unknown>();
  return {
    cacheGet: (k: string) => store.get(k),
    cacheSet: (k: string, v: unknown) => {
      store.set(k, v);
      return v;
    },
    cacheDelete: (k: string) => void store.delete(k),
    TTL: { user: 1, client: 1, clientList: 1 },
    __store: store,
  };
});

const { getDbUser } = await import("@/lib/getDbUser");
const serverCache = (await import("@/lib/serverCache")) as unknown as {
  __store: Map<string, unknown>;
};

beforeEach(() => {
  h.state.byClerkId.clear();
  h.state.byEmail.clear();
  h.state.upsertCalls = [];
  h.state.updateManyCalls = [];
  h.state.clerkUserId = "user_new";
  h.state.clerkEmail = "ca@firm.in";
  serverCache.__store.clear();
  vi.clearAllMocks();
});

function seed(row: { id: string; clerkId: string; email: string; name?: string }) {
  h.state.byClerkId.set(row.clerkId, row);
  h.state.byEmail.set(row.email, row);
  return row;
}

describe("getDbUser identity (REL-11)", () => {
  it("takes the hot path on clerkId without writing", async () => {
    seed({ id: "u1", clerkId: "user_new", email: "ca@firm.in" });

    const user = await getDbUser();

    expect(user?.id).toBe("u1");
    expect(h.prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("creates a first-sign-in row keyed on clerkId, not on email", async () => {
    const user = await getDbUser();

    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].where).toEqual({ clerkId: "user_new" });
    expect(user?.email).toBe("ca@firm.in");
    // The uuid default is left to the schema; this route no longer forces the
    // primary key to be a Clerk id.
    expect((user as { id: string }).id).toBe("uuid-new");
  });

  it("adopts a pre-clerkId row rather than duplicating it", async () => {
    // A row from before clerkId was the join key: the column holds a
    // placeholder, not a Clerk account.
    seed({ id: "u-legacy", clerkId: "legacy-seed-1", email: "ca@firm.in" });

    const user = await getDbUser();

    expect(user?.id).toBe("u-legacy");
    expect(user?.clerkId).toBe("user_new");
    // Conditional on the stale value, so two concurrent sign-ins cannot both
    // think they adopted it.
    expect(h.state.updateManyCalls[0].where).toEqual({
      id: "u-legacy",
      clerkId: "legacy-seed-1",
    });
  });

  it("refuses to rebind a row that already belongs to another Clerk account", async () => {
    const victim = seed({ id: "u-firm-a", clerkId: "user_incumbent", email: "ca@firm.in" });

    const user = await getDbUser();

    // No row handed back, and — the part that matters — the incumbent's row is
    // untouched. The old upsert-on-email would have moved this firm's entire
    // book of clients, invoices, vouchers and ledgers under `user_new`.
    expect(user).toBeNull();
    expect(victim.clerkId).toBe("user_incumbent");
    expect(h.prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("returns null when there is no Clerk session", async () => {
    h.state.clerkUserId = "";

    expect(await getDbUser()).toBeNull();
    expect(h.prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
