import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BLANK_REJECTION_REASON,
  VOUCHERS_PER_JOB,
  applyJobResult,
  chunk,
  hasBlockingPushIssues,
  isAlreadyAbsent,
  isTallySuccess,
  preflightForPush,
  rejectionReason,
  type JobResultBody,
  type TallyCounters,
  toTallyId,
} from "../syncJobs";
import { buildTallyXml, remoteIdFor } from "../exportXml";

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
  const state = {
    job: initialState as string,
    /** Jobs waiting on this one. Empty unless a test is exercising that path. */
    dependents: [] as {
      id: string;
      kind: string;
      payload: Record<string, unknown>;
      tallyCompanyId: string | null;
    }[],
    /**
     * The company's sync status. Only the MASTER_PULL replay path reads it —
     * that is how `applyJobResult` tells "the effect finished" (READY) from
     * "the effect was cut off half-way" (still SYNCING).
     */
    companyStatus: "SYNCING" as string,
  };
  const calls = {
    voucherSync: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    voucher: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    ledger: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    device: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    company: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
    createdJobs: [] as Record<string, unknown>[],
    dependentLookups: [] as { where: Record<string, unknown> }[],
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
      /**
       * Dependent lookup for `failDependentJobs`. Returns whatever the fixture
       * put in `state.dependents`, so a test that does not care about the
       * dependency chain sees an empty list and the helper returns early.
       */
      findMany: async (args: { where: Record<string, unknown> }) => {
        calls.dependentLookups.push(args);
        return state.dependents;
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
      // The three below exist for the MASTER_PULL replay path, which runs the
      // real `applyMasterPull` against this fake. An empty chart is enough:
      // what is being proved there is that the effect runs at all.
      findMany: async () => [] as { id: string; name: string; tallyGuid: string | null }[],
      createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }),
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        calls.ledger.push(args);
        return args.data;
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
        if (typeof args.data.status === "string") state.companyStatus = args.data.status;
        return args.data;
      },
      findUnique: async () => ({ companyName: "RAOTECH", status: state.companyStatus }),
    },
    /** Chunked adoption writes go through here; running them is enough. */
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
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

  /**
   * SYNC-06. The most expensive lie this module could tell.
   *
   * `runner.go` returns a job-level failure with *no* results array when Tally
   * goes unreachable partway through a batch — by then it has already imported
   * the vouchers before that point, and they are in the client's live books.
   * Marking all of them FAILED told a CA that 200 vouchers were rejected when
   * 140 were posted, and the conscientious response to that screen — re-keying
   * them into Tally by hand — creates entries with no REMOTEID: permanent
   * duplicates nothing here can see or clean up.
   */
  it("does not claim a rejection when the job reported no per-voucher results", async () => {
    const outcome = await applyJobResult(fake.db, pushJob(), {
      ok: false,
      error: "tally is not reachable",
      results: [],
    });

    expect(outcome.state).toBe("FAILED");
    // The job failed; the vouchers' fate is unknown, and neither posted nor
    // failed is a count this result supports.
    expect(outcome.failed).toBe(0);
    expect(outcome.posted).toBe(0);
    expect(outcome.unknown).toBe(2);

    expect(fake.calls.voucherSync).toHaveLength(1);
    const write = fake.calls.voucherSync[0];
    expect(write.data.state).toBe("SENDING");
    expect(write.where.voucherId).toEqual({ in: ["v1", "v2"] });
    // Only rows still in flight. A voucher an earlier job did establish an
    // outcome for keeps it — this job's silence is not evidence against it.
    expect(write.where.state).toEqual({ in: ["QUEUED", "SENDING"] });

    // The message has to carry the job-level cause and, more importantly, tell
    // the user what not to do about it.
    const error = String(write.data.error);
    expect(error).toContain("tally is not reachable");
    expect(error).toMatch(/do not know whether it was posted/i);
    expect(error).toMatch(/do not key it into tally by hand/i);
    expect(error).toMatch(/push again/i);

    // Nothing may advance to POSTED, and nothing may be reported as rejected.
    expect(fake.calls.voucher).toHaveLength(0);
  });

  it("re-stamps lastAttemptAt so the row surfaces through the stuck report", async () => {
    // SENDING is only visible as a problem once `lastAttemptAt` ages past the
    // dashboard's ten-minute grace period. Stamping it here starts that clock
    // at the failure rather than at the claim, which is what turns the row from
    // "a push in flight" into "a push nobody ever heard back about".
    const before = Date.now();
    await applyJobResult(fake.db, pushJob(), { ok: false, error: "connector shut down" });

    const at = fake.calls.voucherSync[0].data.lastAttemptAt as Date;
    expect(at).toBeInstanceOf(Date);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
    expect(fake.calls.voucherSync[0].data.jobId).toBe("job-1");
  });

  it("still uses a per-voucher result when the job as a whole failed", async () => {
    // The no-results case is the *only* one that changes. A connector that got
    // as far as reporting per voucher knows more than the job-level error does,
    // and that per-voucher verdict must win.
    const outcome = await applyJobResult(fake.db, pushJob(), {
      ok: false,
      error: "connector shut down after 2 of 2 vouchers",
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
    });

    expect(outcome.state).toBe("FAILED");
    expect(outcome.posted).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.unknown).toBeUndefined();

    const v1 = fake.calls.voucherSync.find((c) => c.where.voucherId === "v1");
    const v2 = fake.calls.voucherSync.find((c) => c.where.voucherId === "v2");
    expect(v1?.data.state).toBe("POSTED");
    expect(v2?.data.state).toBe("FAILED");
    expect(v2?.data.error).toBe("Ledger 'Acme Traders' does not exist!");
  });

  it("leaves a delete whose outcome is unknown recoverable too", async () => {
    const outcome = await applyJobResult(fake.db, pushJob("VOUCHER_DELETE"), {
      ok: false,
      error: "tally is not reachable",
    });

    expect(outcome.unknown).toBe(2);
    const error = String(fake.calls.voucherSync[0].data.error);
    expect(error).toMatch(/whether it was removed/i);
    // Re-running a delete is always safe: Tally treats "no such voucher" as
    // success, which is exactly the state the user asked for.
    expect(error).toMatch(/run the delete again/i);
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

  /**
   * The push queued behind a master create must not be left waiting for ever.
   *
   * `claimJob` will not hand out a job whose dependency is unfinished, which is
   * what stops forty bogus `Ledger 'X' does not exist!` failures. The cost of
   * that guard is this obligation: a master that never reaches DONE has to take
   * its dependents down with it, or the guard converts one loud failure into a
   * silent permanent stall.
   */
  it("fails the dependent push when the master create is rejected by Tally", async () => {
    fake.state.dependents = [
      {
        id: "job-3",
        kind: "VOUCHER_PUSH",
        payload: { dependsOnJobId: "job-2", vouchers: [{ voucherId: "v1" }, { voucherId: "v2" }] },
        tallyCompanyId: "tc1",
      },
    ];

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
      // `ok: true` with an exception is the exact trap: the job succeeded,
      // the import did not.
      { ok: true, tally: counters({ created: 0, exceptions: 1, lineErrors: ["nope"] }) }
    );

    const failedSync = fake.calls.voucherSync.find((c) => c.data.state === "FAILED");
    expect(failedSync).toBeDefined();
    expect(failedSync!.where.voucherId).toEqual({ in: ["v1", "v2"] });
    // The reason names the upstream cause, not the symptom each voucher would
    // otherwise have shown.
    expect(String(failedSync!.data.error)).toContain("could not be created in Tally first");
  });

  it("leaves dependents alone when the master create succeeds", async () => {
    fake.state.dependents = [
      {
        id: "job-3",
        kind: "VOUCHER_PUSH",
        payload: { dependsOnJobId: "job-2", vouchers: [{ voucherId: "v1" }] },
        tallyCompanyId: "tc1",
      },
    ];

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
      { ok: true, tally: counters({ created: 1 }) }
    );

    expect(fake.calls.dependentLookups).toHaveLength(0);
    expect(fake.calls.voucherSync.filter((c) => c.data.state === "FAILED")).toHaveLength(0);
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

  /**
   * SYNC-07's other half. The job is marked terminal *before* the effect runs,
   * so a master pull whose write was cut off half-way left the job DONE, the
   * chart half-written and the company stuck at SYNCING. The connector's retry
   * then lost the guarded transition and did nothing, and the pull could never
   * complete. Re-running is safe because adoption is keyed on Tally's GUID.
   */
  const masterPullJob = {
    id: "job-9",
    userId: "u1",
    clientId: "c1",
    tallyCompanyId: "tc1",
    deviceId: "d1",
    kind: "MASTER_PULL" as const,
    payload: { companyName: "RAOTECH" },
  };

  const pullBody: JobResultBody = {
    ok: true,
    companies: [{ name: "RAOTECH", booksFrom: "20260401" }],
    ledgers: [
      { name: "Acme Traders", parent: "Sundry Creditors", guid: "guid-1" },
    ],
  };

  it("re-applies a replayed MASTER_PULL whose effect never finished", async () => {
    const done = makeDb("DONE");
    done.state.companyStatus = "SYNCING";

    const outcome = await applyJobResult(done.db, masterPullJob, pullBody);

    expect(outcome.applied).toBe(true);
    expect(outcome.state).toBe("DONE");
    // The proof the effect ran: the company was carried to READY, which is the
    // last thing `applyMasterPull` does.
    expect(done.calls.company.some((c) => c.data.status === "READY")).toBe(true);
  });

  it("does not re-apply a MASTER_PULL that already completed", async () => {
    const done = makeDb("DONE");
    done.state.companyStatus = "READY";

    const outcome = await applyJobResult(done.db, masterPullJob, pullBody);

    expect(outcome.applied).toBe(false);
    expect(done.calls.company).toHaveLength(0);
  });

  it("does not re-apply a replay that reports a failure", async () => {
    // A stale report of a failed pull must not be allowed to write a chart, and
    // must not walk the job's recorded outcome around either.
    const done = makeDb("DONE");
    done.state.companyStatus = "SYNCING";

    const outcome = await applyJobResult(done.db, masterPullJob, {
      ok: false,
      error: "tally is not reachable",
    });

    expect(outcome.applied).toBe(false);
    expect(done.calls.company).toHaveLength(0);
  });
});

/**
 * SYNC-08. The push used to put every approved voucher into one job: one full
 * XML envelope per voucher, in one JSONB column, returned in one HTTP response.
 * At month-end that could not be built, let alone sent.
 */
describe("chunk / VOUCHERS_PER_JOB", () => {
  it("splits in order, with the remainder last", () => {
    const ids = Array.from({ length: 7 }, (_, i) => `v${i + 1}`);
    expect(chunk(ids, 3)).toEqual([
      ["v1", "v2", "v3"],
      ["v4", "v5", "v6"],
      ["v7"],
    ]);
  });

  it("leaves a batch at or below the cap as a single job", () => {
    const ids = Array.from({ length: VOUCHERS_PER_JOB }, (_, i) => `v${i}`);
    expect(chunk(ids, VOUCHERS_PER_JOB)).toHaveLength(1);
    expect(chunk([], VOUCHERS_PER_JOB)).toEqual([]);
  });

  /**
   * The cap is a payload-size decision, so it is worth checking against the
   * envelopes this codebase actually emits rather than against a remembered
   * number. A GST purchase with a party line, a purchase line and three tax
   * lines is the ordinary shape.
   */
  it("keeps a full job's payload to a size a single response can carry", () => {
    const xml = buildTallyXml({
      companyName: "RAOTECH",
      ledgers: [],
      vouchers: [
        {
          id: "8f14e45f-ceea-467a-9c1e-4d4b0f2a1c33",
          voucherType: "PURCHASE",
          date: new Date("2026-08-01T00:00:00.000Z"),
          narration: "Purchase invoice INV-2026-0481 from Acme Traders Pvt Ltd",
          partyName: "Acme Traders Pvt Ltd",
          invoiceNumber: "INV-2026-0481",
          lines: [
            { ledgerName: "Acme Traders Pvt Ltd", role: "PARTY", debit: 0, credit: 118000 },
            { ledgerName: "Purchase - GST 18%", role: "ITEM", debit: 100000, credit: 0, hsnCode: "8471", gstRate: 18 },
            { ledgerName: "CGST Input", role: "TAX", debit: 9000, credit: 0, gstRate: 9 },
            { ledgerName: "SGST Input", role: "TAX", debit: 9000, credit: 0, gstRate: 9 },
            { ledgerName: "Round Off", role: "ROUND_OFF", debit: 0, credit: 0 },
          ],
        },
      ],
    });

    // A full job is `VOUCHERS_PER_JOB` of these plus the JSON around them. The
    // ceiling is deliberately loose: what is being asserted is the order of
    // magnitude — hundreds of kilobytes, not the megabytes an uncapped
    // month-end push would have produced.
    const perJob = xml.length * VOUCHERS_PER_JOB;
    expect(xml.length).toBeLessThan(8 * 1024);
    expect(perJob).toBeLessThan(1024 * 1024);
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
