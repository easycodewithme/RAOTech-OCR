import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BLANK_REJECTION_REASON,
  applyJobResult,
  hasBlockingPushIssues,
  isAlreadyAbsent,
  isTallySuccess,
  preflightForPush,
  rejectionReason,
  type JobResultBody,
  type TallyCounters,
  toTallyId,
} from "../syncJobs";
import { remoteIdFor } from "../exportXml";

const counters = (o: Partial<TallyCounters> = {}): TallyCounters => ({
  created: 1,
  altered: 0,
  deleted: 0,
  ignored: 0,
  errors: 0,
  exceptions: 0,
  lastVchId: 12,
  lastMId: 0,
  lineErrors: [],
  ...o,
});

describe("isTallySuccess", () => {
  it("accepts a clean import", () => {
    expect(isTallySuccess(counters())).toBe(true);
  });

  it("treats exceptions as failure — this is the whole point", () => {
    // Tally reports business rejections as EXCEPTIONS, never as ERRORS.
    // Checking `errors` alone reports every single failure as a success.
    expect(isTallySuccess(counters({ created: 0, errors: 0, exceptions: 1 }))).toBe(false);
  });

  it("treats errors as failure too — a delete of a missing voucher uses that counter", () => {
    expect(isTallySuccess(counters({ created: 0, errors: 1, exceptions: 0 }))).toBe(false);
  });

  it("treats a line error as failure even when both counters read zero", () => {
    expect(
      isTallySuccess(counters({ lineErrors: ["Ledger 'Acme Traders' does not exist!"] }))
    ).toBe(false);
  });

  it("treats a missing counter block as failure rather than assuming the best", () => {
    expect(isTallySuccess(null)).toBe(false);
    expect(isTallySuccess(undefined)).toBe(false);
  });

  it("tolerates a partial object from an older connector build", () => {
    expect(isTallySuccess({ created: 1 })).toBe(true);
    expect(isTallySuccess({ exceptions: 2 })).toBe(false);
  });
});

describe("rejectionReason", () => {
  it("prefers Tally's verbatim line error", () => {
    const reason = rejectionReason({
      voucherId: "v1",
      ok: false,
      tally: counters({ exceptions: 1, lineErrors: ["Ledger 'Acme' does not exist!"] }),
    });
    expect(reason).toBe("Ledger 'Acme' does not exist!");
  });

  it("falls back to the connector's own error", () => {
    expect(
      rejectionReason({ voucherId: "v1", ok: false, error: "tally is not reachable" })
    ).toBe("tally is not reachable");
  });

  it("explains a blank reason instead of storing an empty string", () => {
    // Measured: an unbalanced voucher and a Tally in education mode are both
    // rejected with no reason at all. An empty string renders as a red row with
    // nothing to act on.
    const reason = rejectionReason({
      voucherId: "v1",
      ok: false,
      tally: counters({ created: 0, exceptions: 1, lineErrors: ["  "] }),
      error: "",
    });
    expect(reason).toBe(BLANK_REJECTION_REASON);
    expect(reason).toMatch(/education mode/i);
    expect(reason).toMatch(/debits and credits/i);
  });

  it("uses the job-level transport error when nothing else is available", () => {
    expect(rejectionReason(undefined, "connector went offline")).toBe(
      "connector went offline"
    );
  });
});

describe("isAlreadyAbsent", () => {
  it("recognises the one rejection that means the user already got what they asked for", () => {
    expect(
      isAlreadyAbsent(
        counters({ created: 0, errors: 1, lineErrors: ["Voucher does not exist!"] })
      )
    ).toBe(true);
  });

  it("does not confuse it with a missing ledger", () => {
    expect(
      isAlreadyAbsent(counters({ exceptions: 1, lineErrors: ["Ledger 'X' does not exist!"] }))
    ).toBe(false);
  });
});

describe("preflightForPush", () => {
  const voucher = (date: string, id = "v1") => ({
    id,
    date: new Date(date),
    invoiceNumber: "INV-1",
    lines: [
      { ledgerName: "Purchase - GST 18%", debit: 1000, credit: 0 },
      { ledgerName: "Acme Traders", debit: 0, credit: 1000 },
    ],
  });

  const booksFrom = new Date(Date.UTC(2026, 3, 1));
  const now = new Date(Date.UTC(2026, 7, 25));

  it("blocks a voucher dated before books-beginning", () => {
    // Measured: 2026-03-31 against books beginning 2026-04-01 was rejected with
    // "The date 31-3-2026 is Out of Range!".
    const issues = preflightForPush([voucher("2026-03-31")], { booksFrom, now });
    expect(hasBlockingPushIssues(issues)).toBe(true);
    expect(issues.some((i) => i.code === "DATE_OUT_OF_RANGE")).toBe(true);
  });

  it("accepts books-beginning itself", () => {
    expect(
      hasBlockingPushIssues(preflightForPush([voucher("2026-04-01")], { booksFrom, now }))
    ).toBe(false);
  });

  it("does not impose an upper bound Tally does not have", () => {
    // Both of these posted cleanly against a live Tally: the first day of the
    // next financial year, and a date two financial years out. Enforcing the
    // reported EndingAt would have rejected every one of them.
    for (const date of ["2027-03-31", "2027-04-01"]) {
      const issues = preflightForPush([voucher(date)], { booksFrom, now });
      expect(hasBlockingPushIssues(issues)).toBe(false);
    }
  });

  it("warns, without blocking, on a date more than a year out", () => {
    const issues = preflightForPush([voucher("2028-06-15")], { booksFrom, now });
    expect(hasBlockingPushIssues(issues)).toBe(false);
    const warning = issues.find((i) => i.code === "DATE_FAR_FUTURE");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toMatch(/typo/i);
  });

  it("leaves the existing blocking checks alone", () => {
    const unbalanced = {
      id: "v2",
      date: new Date("2026-08-01"),
      invoiceNumber: "INV-2",
      lines: [
        { ledgerName: "Purchase - GST 18%", debit: 1000, credit: 0 },
        { ledgerName: "Acme Traders", debit: 0, credit: 900 },
      ],
    };
    const issues = preflightForPush([unbalanced], { booksFrom, now });
    expect(issues.some((i) => i.code === "UNBALANCED" && i.severity === "error")).toBe(true);
  });
});

/**
 * A fake just wide enough for `applyJobResult`. It exists to prove the guarded
 * transition: the job's state is real, so a second call genuinely loses the
 * race the way it would in Postgres.
 */
function makeDb(initialState: "QUEUED" | "CLAIMED" | "DONE" | "FAILED" = "CLAIMED") {
  const state = { job: initialState as string };
  const calls = {
    voucherSync: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    voucher: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    ledger: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    device: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    company: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    createdJobs: [] as Record<string, unknown>[],
  };

  const db = {
    syncJob: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; state?: { in: string[] } };
        data: { state: string };
      }) => {
        const allowed = where.state?.in ?? [];
        if (!allowed.includes(state.job)) return { count: 0 };
        state.job = data.state;
        return { count: 1 };
      },
      findUnique: async () => ({ state: state.job }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.createdJobs.push(data);
        return { id: `job-${calls.createdJobs.length}`, ...data };
      },
    },
    voucherSync: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.voucherSync.push(args);
        return { count: 1 };
      },
    },
    voucher: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.voucher.push(args);
        return { count: 1 };
      },
    },
    /**
     * Read only when Tally rejects a voucher and gives no reason, to decide
     * whether the "you probably have inventory switched off" wording applies.
     * Empty here: none of these fixtures move stock.
     */
    voucherLine: {
      findMany: async () => [] as { voucherId: string }[],
    },
    ledger: {
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.ledger.push(args);
        return { count: 1 };
      },
    },
    connectorDevice: {
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.device.push(args);
        return args.data;
      },
    },
    tallyCompany: {
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.company.push(args);
        return args.data;
      },
      findUnique: async () => ({ companyName: "RAOTECH" }),
    },
  };

  return { db: db as unknown as PrismaClient, calls, state };
}

const pushJob = (kind: "VOUCHER_PUSH" | "VOUCHER_DELETE" = "VOUCHER_PUSH") => ({
  id: "job-1",
  userId: "u1",
  clientId: "c1",
  tallyCompanyId: "tc1",
  deviceId: "d1",
  kind,
  payload: {
    companyName: "RAOTECH",
    vouchers: [
      { voucherId: "v1", remoteId: remoteIdFor("v1"), xml: "<ENVELOPE/>" },
      { voucherId: "v2", remoteId: remoteIdFor("v2"), xml: "<ENVELOPE/>" },
    ],
  },
});

describe("applyJobResult", () => {
  let fake: ReturnType<typeof makeDb>;
  beforeEach(() => {
    fake = makeDb();
  });

  const body: JobResultBody = {
    ok: true,
    durationMs: 1840,
    results: [
      { voucherId: "v1", ok: true, tally: counters() },
      {
        voucherId: "v2",
        ok: false,
        tally: counters({
          created: 0,
          exceptions: 1,
          lineErrors: ["Ledger 'Acme Traders' does not exist!"],
        }),
      },
    ],
  };

  it("posts the good voucher and fails the rejected one", () => {
    return applyJobResult(fake.db, pushJob(), body).then((outcome) => {
      expect(outcome.applied).toBe(true);
      expect(outcome.state).toBe("DONE");
      expect(outcome.posted).toBe(1);
      expect(outcome.failed).toBe(1);

      const v2 = fake.calls.voucherSync.find((c) => c.where.voucherId === "v2");
      expect(v2?.data.state).toBe("FAILED");
      expect(v2?.data.error).toBe("Ledger 'Acme Traders' does not exist!");

      // Only the successful voucher may be advanced. A batch partially
      // succeeding is the normal case, not the edge case.
      expect(fake.calls.voucher).toHaveLength(1);
      expect(fake.calls.voucher[0].where.id).toBe("v1");
      expect(fake.calls.voucher[0].data.status).toBe("POSTED");
    });
  });

  it("does not trust the connector's own ok over Tally's counters", async () => {
    await applyJobResult(fake.db, pushJob(), {
      ok: true,
      results: [
        { voucherId: "v1", ok: true, tally: counters({ created: 0, errors: 0, exceptions: 1 }) },
      ],
    });

    const v1 = fake.calls.voucherSync.find((c) => c.where.voucherId === "v1");
    expect(v1?.data.state).toBe("FAILED");
    expect(fake.calls.voucher).toHaveLength(0);
  });

  it("is idempotent: a replayed result changes nothing", async () => {
    const first = await applyJobResult(fake.db, pushJob(), body);
    expect(first.applied).toBe(true);

    const before = {
      voucherSync: fake.calls.voucherSync.length,
      voucher: fake.calls.voucher.length,
    };

    const second = await applyJobResult(fake.db, pushJob(), body);
    expect(second.applied).toBe(false);
    expect(second.state).toBe("DONE");
    expect(fake.calls.voucherSync).toHaveLength(before.voucherSync);
    expect(fake.calls.voucher).toHaveLength(before.voucher);
  });

  it("cannot walk a DONE job backwards into FAILED", async () => {
    await applyJobResult(fake.db, pushJob(), body);

    // The reaper requeued the job, a second device ran it, and this late report
    // from the first device says the connection dropped.
    const late = await applyJobResult(fake.db, pushJob(), {
      ok: false,
      error: "tally is not reachable",
    });

    expect(late.applied).toBe(false);
    expect(late.state).toBe("DONE");
    expect(fake.state.job).toBe("DONE");
  });

  it("fails every voucher a job carried when the job never reached Tally", async () => {
    const outcome = await applyJobResult(fake.db, pushJob(), {
      ok: false,
      error: "tally is not reachable",
      results: [],
    });

    expect(outcome.state).toBe("FAILED");
    expect(outcome.failed).toBe(2);
    // Otherwise both rows sit at SENDING for ever and the UI spins on a job
    // that is already dead.
    expect(fake.calls.voucherSync.map((c) => c.data.state)).toEqual(["FAILED", "FAILED"]);
    expect(fake.calls.voucherSync[0].data.error).toBe("tally is not reachable");
  });

  it("treats deleting a voucher Tally never had as success", async () => {
    const outcome = await applyJobResult(fake.db, pushJob("VOUCHER_DELETE"), {
      ok: true,
      results: [
        { voucherId: "v1", ok: true, tally: counters({ created: 0, deleted: 1 }) },
        {
          voucherId: "v2",
          ok: false,
          tally: counters({
            created: 0,
            deleted: 0,
            errors: 1,
            lineErrors: ["Voucher does not exist!"],
          }),
        },
      ],
    });

    // Both are DELETED: the second is already absent from Tally, which is
    // exactly the state the user asked for. Failing it would leave a red row no
    // retry could ever clear.
    expect(outcome.posted).toBe(2);
    expect(fake.calls.voucherSync.map((c) => c.data.state)).toEqual(["DELETED", "DELETED"]);
    expect(fake.calls.voucher.map((c) => c.data.status)).toEqual(["APPROVED", "APPROVED"]);
  });

  it("marks a MASTER_CREATE's ledgers and queues the read-back that learns their GUIDs", async () => {
    const outcome = await applyJobResult(
      fake.db,
      {
        id: "job-2",
        userId: "u1",
        clientId: "c1",
        tallyCompanyId: "tc1",
        deviceId: "d1",
        kind: "MASTER_CREATE",
        payload: { companyName: "RAOTECH", ledgerIds: ["l1", "l2"], xml: "<ENVELOPE/>" },
      },
      { ok: true, tally: counters({ created: 2, lastMId: 12 }) }
    );

    expect(outcome.applied).toBe(true);
    expect(fake.calls.ledger[0].data.tallyCompanyId).toBe("tc1");
    // Tally returns no GUIDs on import, so identity is only ever learnt by
    // reading back.
    expect(fake.calls.createdJobs).toHaveLength(1);
    expect(fake.calls.createdJobs[0].kind).toBe("MASTER_PULL");
  });

  it("does not mark ledgers created when Tally rejected the batch", async () => {
    await applyJobResult(
      fake.db,
      {
        id: "job-2",
        userId: "u1",
        clientId: "c1",
        tallyCompanyId: "tc1",
        deviceId: "d1",
        kind: "MASTER_CREATE",
        payload: { companyName: "RAOTECH", ledgerIds: ["l1"], xml: "<ENVELOPE/>" },
      },
      { ok: true, tally: counters({ created: 0, exceptions: 1, lineErrors: ["nope"] }) }
    );

    expect(fake.calls.ledger).toHaveLength(0);
    expect(fake.calls.createdJobs).toHaveLength(0);
  });

  it("records reachability from a PING", async () => {
    await applyJobResult(
      fake.db,
      {
        id: "job-3",
        userId: "u1",
        clientId: "c1",
        tallyCompanyId: null,
        deviceId: "d1",
        kind: "PING",
        payload: {},
      },
      { ok: true }
    );

    expect(fake.calls.device[0].where.id).toBe("d1");
    expect(fake.calls.device[0].data.tallyReachable).toBe(true);
  });

  it("flags education mode on the company when Tally admits to it", async () => {
    await applyJobResult(fake.db, pushJob(), {
      ok: true,
      results: [
        {
          voucherId: "v1",
          ok: false,
          tally: counters({
            created: 0,
            exceptions: 1,
            lineErrors: ["Educational version: only some dates are allowed"],
          }),
        },
      ],
    });

    expect(fake.calls.company.some((c) => c.data.educationMode === true)).toBe(true);
  });
});

/**
 * A connector sending Tally's voucher id as a string used to make
 * `applyJobResult` throw on an `Int?` column. The result endpoint answered 500,
 * the job was never recorded — and every voucher in it was already in the
 * client's books. Silently posted, locally unknown, addressable only by a
 * REMOTEID that cannot be read back out: an orphan.
 */
describe("toTallyId", () => {
  it("accepts what the Go agent sends", () => {
    expect(toTallyId(75)).toBe(75);
  });

  it("accepts what a string-typed connector sends", () => {
    expect(toTallyId("75")).toBe(75);
    expect(toTallyId(" 75 ")).toBe(75);
  });

  it("treats absent, zero and nonsense as no id rather than throwing", () => {
    expect(toTallyId(null)).toBeNull();
    expect(toTallyId(undefined)).toBeNull();
    expect(toTallyId("")).toBeNull();
    expect(toTallyId(0)).toBeNull();
    expect(toTallyId("0")).toBeNull();
    expect(toTallyId("abc")).toBeNull();
    expect(toTallyId(1.5)).toBeNull();
  });
});
