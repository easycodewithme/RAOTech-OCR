import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The audit recorder (REL-01).
 *
 * Two things here are worth a test and the rest is plumbing. The first is the
 * contract that an audit write can never break the operation it is recording:
 * a push that is already queued, or an approval that already committed, must
 * not be turned into a 500 by a failure to write a row *about* it. The second
 * is the identity that ends up on the row — the whole point of the table is
 * that it still names a person after that person's account is gone, which only
 * works if the email and name are copied in at write time rather than joined
 * to later.
 *
 * Prisma, Clerk and the session helpers are stubbed the way `getDbUser.test.ts`
 * and `ingestionPersistence.test.ts` stub them: `vi.hoisted` state, a fake
 * delegate that records what the module *asks the database to write*, which is
 * exactly the thing that would be wrong.
 */

type CreateArgs = { data: Record<string, unknown> };

const h = vi.hoisted(() => {
  const state = {
    created: [] as Record<string, unknown>[],
    createThrows: null as Error | null,
    dbUser: null as Record<string, unknown> | null,
    getDbUserThrows: null as Error | null,
  };

  const prisma = {
    auditEvent: {
      create: vi.fn(async (args: CreateArgs) => {
        if (state.createThrows) throw state.createThrows;
        state.created.push(args.data);
        return { id: "audit-1", ...args.data };
      }),
    },
  };

  return { state, prisma };
});

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

vi.mock("@/lib/getDbUser", () => ({
  getDbUser: vi.fn(async () => {
    if (h.state.getDbUserThrows) throw h.state.getDbUserThrows;
    return h.state.dbUser;
  }),
}));

// The real one prints on every call; the assertions below are about the write.
vi.mock("@/lib/trace", () => ({ trace: vi.fn() }));

const { recordAuditEvent, vouchersPhrase, isAuditAction, AUDIT_ACTIONS, AUDIT_ACTION_LABELS } =
  await import("@/lib/audit");

beforeEach(() => {
  h.state.created = [];
  h.state.createThrows = null;
  h.state.getDbUserThrows = null;
  h.state.dbUser = {
    id: "firm-1",
    clerkId: "user_abc123",
    email: "priya@raoandco.in",
    name: "Priya",
  };
  vi.clearAllMocks();
});

const baseEvent = {
  userId: "firm-1",
  clientId: "client-1",
  action: "VOUCHER_APPROVED" as const,
  entityType: "VOUCHER" as const,
  summary: "Approved 34 vouchers for Acme Traders",
};

describe("recordAuditEvent", () => {
  it("denormalises the actor onto the row instead of leaving a join to do", async () => {
    await recordAuditEvent({ ...baseEvent, entityId: "v-1" });

    expect(h.state.created).toHaveLength(1);
    const row = h.state.created[0];
    // The three copies that make the row outlive the staff member.
    expect(row.actorClerkId).toBe("user_abc123");
    expect(row.actorEmail).toBe("priya@raoandco.in");
    expect(row.actorName).toBe("Priya");
    // And the tenant boundary, which is not the same field as the actor.
    expect(row.userId).toBe("firm-1");
    expect(row.clientId).toBe("client-1");
  });

  it("prefers an explicitly supplied actor over the session", async () => {
    // The shape a background job uses: no Clerk session to read.
    await recordAuditEvent({
      ...baseEvent,
      actor: { clerkId: null, email: "connector@raoandco.in", name: "Tally connector" },
    });

    expect(h.state.created[0].actorEmail).toBe("connector@raoandco.in");
    expect(h.state.created[0].actorName).toBe("Tally connector");
  });

  it("still records the event when there is no resolvable actor", async () => {
    h.state.dbUser = null;

    await recordAuditEvent(baseEvent);

    // "We do not know who" is a far better answer than no record that it
    // happened at all — so the row is written with null actor fields.
    expect(h.state.created).toHaveLength(1);
    expect(h.state.created[0].actorEmail).toBeNull();
    expect(h.state.created[0].actorName).toBeNull();
    expect(h.state.created[0].summary).toBe(baseEvent.summary);
  });

  it("normalises the optional fields to null rather than leaving them undefined", async () => {
    await recordAuditEvent({
      userId: "firm-1",
      action: "MASTERS_CREATED",
      entityType: "TALLY_COMPANY",
      summary: "Created 12 ledgers in Tally",
    });

    const row = h.state.created[0];
    // clientId is nullable on purpose — firm-level actions have no client.
    expect(row.clientId).toBeNull();
    expect(row.entityId).toBeNull();
    expect(row.metadata).toBeUndefined();
  });

  it("passes metadata through as a plain object", async () => {
    await recordAuditEvent({
      ...baseEvent,
      metadata: { approvedCount: 34, voucherIds: ["v-1", "v-2"], skipped: [] },
    });

    expect(h.state.created[0].metadata).toEqual({
      approvedCount: 34,
      voucherIds: ["v-1", "v-2"],
      skipped: [],
    });
  });

  // ── The contract that matters ──────────────────────────────────────────
  //
  // A push is already on the queue and an approval has already committed by
  // the time this runs. Rethrowing here would turn work that succeeded into a
  // 500, and the caller would repeat it — which for a push means a duplicate
  // voucher in a client's live TallyPrime. A gap in the trail is the cheaper
  // failure, so it is the one we take.

  it("swallows a failing database write instead of breaking the operation", async () => {
    h.state.createThrows = new Error("connection terminated unexpectedly");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordAuditEvent(baseEvent)).resolves.toBeUndefined();

    // Swallowed, but never silent: the failure is on the console with enough
    // context to say which event was lost.
    expect(logged).toHaveBeenCalledOnce();
    expect(logged.mock.calls[0][0]).toBe("[AUDIT_WRITE_FAILED]");
    logged.mockRestore();
  });

  it("swallows a failing actor lookup too", async () => {
    // Identity resolution can throw — `getDbUser` deliberately rethrows
    // anything that is not an email collision.
    h.state.getDbUserThrows = new Error("Clerk unavailable");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(recordAuditEvent(baseEvent)).resolves.toBeUndefined();

    expect(h.prisma.auditEvent.create).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});

describe("audit action tokens", () => {
  it("covers every write point the product has", () => {
    // If a write point is added without a token, this is where it is noticed.
    expect(AUDIT_ACTIONS).toEqual([
      "VOUCHER_APPROVED",
      "VOUCHERS_PUSHED",
      "VOUCHERS_DELETED_FROM_TALLY",
      "INVOICE_DELETED",
      "MASTERS_CREATED",
    ]);
  });

  it("gives every token a human label, so no screen renders a raw token", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
  });

  it("narrows an untrusted query-string value", () => {
    // The read endpoint rejects on this rather than ignoring the filter: a
    // filter that silently does nothing shows a full list and lets the reader
    // conclude the thing they filtered for never happened.
    expect(isAuditAction("VOUCHERS_PUSHED")).toBe(true);
    expect(isAuditAction("voucher_approved")).toBe(false);
    expect(isAuditAction("DROP TABLE")).toBe(false);
    expect(isAuditAction(undefined)).toBe(false);
    expect(isAuditAction(42)).toBe(false);
  });
});

describe("vouchersPhrase", () => {
  it("agrees with itself on singular and plural", () => {
    expect(vouchersPhrase(1)).toBe("1 voucher");
    expect(vouchersPhrase(0)).toBe("0 vouchers");
    expect(vouchersPhrase(34)).toBe("34 vouchers");
  });

  it("groups large counts the Indian way, like every other number on screen", () => {
    expect(vouchersPhrase(120000)).toBe("1,20,000 vouchers");
  });
});
