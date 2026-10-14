import { describe, it, expect, beforeEach, vi } from "vitest";
import { VOUCHERS_PER_JOB } from "../syncJobs";

/**
 * `POST /api/tally/push`, stood up against a fake database.
 *
 * SYNC-08: omitting `voucherIds` means "every approved voucher", and all of
 * them used to go into one job. One job means one payload holding one full XML
 * envelope per voucher — built inside this request, written to one JSONB
 * column, and handed back whole in one HTTP response — and the sync rows in
 * front of it were written with an `upsert` per voucher, sequentially, at
 * ~160-290ms a round trip. At month-end volume the request died before the job
 * was queued, so the bigger the backlog the more certainly the push failed.
 *
 * These assertions are about what the route *asks the database to write*: how
 * many jobs, carrying which vouchers, with which dependency, in how many
 * statements. None of that is reachable without standing the handler up.
 */

type RouteResult = { status: number; body: Record<string, unknown> };

const h = vi.hoisted(() => {
  interface FakeVoucher {
    id: string;
    userId: string;
    clientId: string;
    date: Date;
    voucherType: string;
    narration: string | null;
    status: string;
    lines: Record<string, unknown>[];
    invoice: { vendor: string; invoiceNumber: string } | null;
  }

  const state = {
    /** The gate the route checks before anything else. */
    companyStatus: "READY" as string,
    vouchers: [] as FakeVoucher[],
    /** Ledgers with no GUID, i.e. what MASTER_CREATE would have to create. */
    unsyncedLedgers: [] as Record<string, unknown>[],
    createdJobs: [] as { id: string; kind: string; payload: Record<string, unknown> }[],
    /** Every statement issued against VoucherSync, in order. */
    syncStatements: [] as { op: string; rows: number }[],
    syncRows: new Map<string, { id: string; voucherId: string; remoteId: string }>(),
  };

  const prisma = {
    tallyCompany: {
      findUnique: async () => ({
        id: "tc1",
        companyName: "RAOTECH",
        status: state.companyStatus,
        booksFrom: new Date("2026-04-01T00:00:00.000Z"),
        fyStart: new Date("2026-04-01T00:00:00.000Z"),
      }),
    },
    voucher: {
      findMany: async (args: { where: { id?: { in: string[] } } }) => {
        const ids = args.where.id?.in;
        const rows = ids
          ? state.vouchers.filter((v) => ids.includes(v.id))
          : state.vouchers;
        return rows.map((v) => ({ ...v }));
      },
    },
    ledger: {
      findMany: async () => state.unsyncedLedgers,
    },
    stockItem: {
      findMany: async () => [] as Record<string, unknown>[],
    },
    syncJob: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const job = {
          id: `job-${state.createdJobs.length + 1}`,
          kind: data.kind as string,
          payload: data.payload as Record<string, unknown>,
        };
        state.createdJobs.push(job);
        return job;
      },
    },
    voucherSync: {
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: { voucherId: string; remoteId: string }[];
        skipDuplicates?: boolean;
      }) => {
        state.syncStatements.push({ op: "createMany", rows: data.length });
        let count = 0;
        for (const row of data) {
          if (state.syncRows.has(row.voucherId)) {
            if (skipDuplicates) continue;
            throw new Error("duplicate VoucherSync row");
          }
          state.syncRows.set(row.voucherId, {
            id: `vs-${state.syncRows.size + 1}`,
            voucherId: row.voucherId,
            remoteId: row.remoteId,
          });
          count += 1;
        }
        return { count };
      },
      updateMany: async (args: { where: { voucherId: { in: string[] } } }) => {
        state.syncStatements.push({ op: "updateMany", rows: args.where.voucherId.in.length });
        return { count: args.where.voucherId.in.length };
      },
      findMany: async (args: { where: { voucherId: { in: string[] } } }) => {
        state.syncStatements.push({ op: "findMany", rows: args.where.voucherId.in.length });
        return args.where.voucherId.in
          .map((id) => state.syncRows.get(id))
          .filter(Boolean) as { id: string; voucherId: string; remoteId: string }[];
      },
      update: async ({ where, data }: { where: { id: string }; data: { remoteId: string } }) => {
        state.syncStatements.push({ op: "update", rows: 1 });
        for (const row of state.syncRows.values()) {
          if (row.id === where.id) row.remoteId = data.remoteId;
        }
        return data;
      },
    },
  };

  return { state, prisma };
});

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));

vi.mock("@/lib/clientContext", () => ({
  getActiveClient: vi.fn(async () => ({
    user: { id: "u1", clerkId: "user_test" },
    client: { id: "c1", gstin: null },
  })),
}));

// Imported after the mocks so the route picks them up.
const { POST } = await import("@/app/api/tally/push/route");

function voucher(i: number) {
  return {
    id: `v${String(i).padStart(4, "0")}`,
    userId: "u1",
    clientId: "c1",
    // Ordered by date, a day apart, so the chunks are visibly contiguous.
    date: new Date(Date.UTC(2026, 7, 1, 0, 0, i)),
    voucherType: "PURCHASE",
    narration: null,
    status: "APPROVED",
    lines: [
      {
        id: `l${i}a`,
        sortOrder: 0,
        role: "ITEM",
        ledgerId: "l-purchase",
        ledgerNameSnapshot: "Purchase - GST 18%",
        debit: 1000,
        credit: 0,
        stockItemId: null,
        stockItemName: null,
        quantity: null,
        unit: null,
        rate: null,
        hsnCode: null,
        gstRate: 18,
      },
      {
        id: `l${i}b`,
        sortOrder: 1,
        role: "PARTY",
        ledgerId: "l-party",
        ledgerNameSnapshot: "Acme Traders",
        debit: 0,
        credit: 1000,
        stockItemId: null,
        stockItemName: null,
        quantity: null,
        unit: null,
        rate: null,
        hsnCode: null,
        gstRate: null,
      },
    ],
    invoice: { vendor: "Acme Traders", invoiceNumber: `INV-${i}` },
  };
}

const post = async (body: Record<string, unknown> = {}) =>
  (await POST(new Request("http://localhost/api/tally/push", {
    method: "POST",
    body: JSON.stringify(body),
  }))) as unknown as RouteResult;

describe("POST /api/tally/push", () => {
  beforeEach(() => {
    h.state.companyStatus = "READY";
    h.state.vouchers = [];
    h.state.unsyncedLedgers = [];
    h.state.createdJobs = [];
    h.state.syncStatements = [];
    h.state.syncRows = new Map();
  });

  it("keeps a batch at or below the cap in a single job", async () => {
    h.state.vouchers = Array.from({ length: 5 }, (_, i) => voucher(i));

    const res = await post();

    expect(res.status).toBe(200);
    expect(h.state.createdJobs).toHaveLength(1);
    expect(h.state.createdJobs[0].kind).toBe("VOUCHER_PUSH");
    expect(res.body.voucherPushJobIds).toEqual(["job-1"]);
  });

  it("splits a push above the cap across several jobs", async () => {
    const total = VOUCHERS_PER_JOB * 2 + 37;
    h.state.vouchers = Array.from({ length: total }, (_, i) => voucher(i));
    // One ledger Tally has never heard of, so a MASTER_CREATE leads the queue.
    h.state.unsyncedLedgers = [
      {
        id: "l-purchase",
        name: "Purchase - GST 18%",
        group: "PURCHASE_ACCOUNTS",
        ledgerType: "PURCHASE",
        gstRate: 18,
        parentGstin: null,
      },
    ];

    const res = await post();

    const kinds = h.state.createdJobs.map((j) => j.kind);
    expect(kinds).toEqual([
      "MASTER_CREATE",
      "VOUCHER_PUSH",
      "VOUCHER_PUSH",
      "VOUCHER_PUSH",
    ]);

    const pushes = h.state.createdJobs.filter((j) => j.kind === "VOUCHER_PUSH");
    const sizes = pushes.map(
      (j) => (j.payload.vouchers as { voucherId: string }[]).length
    );
    expect(sizes).toEqual([VOUCHERS_PER_JOB, VOUCHERS_PER_JOB, 37]);

    // Every voucher goes exactly once, in date order, in contiguous slices —
    // so a half-drained queue is "everything up to the 12th is in", not a
    // random scatter of the month.
    const carried = pushes.flatMap((j) =>
      (j.payload.vouchers as { voucherId: string }[]).map((v) => v.voucherId)
    );
    expect(carried).toHaveLength(total);
    expect(new Set(carried).size).toBe(total);
    expect(carried).toEqual(h.state.vouchers.map((v) => v.id));

    expect(res.body.jobIds).toHaveLength(4);
    expect(res.body.voucherPushJobIds).toHaveLength(3);
    expect(res.body.voucherIds).toHaveLength(total);
  });

  it("puts the master dependency on every chunk, not just the first", async () => {
    // `claimJob` enforces `dependsOnJobId` per job. A chunk without it would be
    // handed out whatever the master create did, and every voucher in it would
    // come back `Ledger 'X' does not exist!` — the exact wall of failures the
    // dependency exists to prevent.
    h.state.vouchers = Array.from({ length: VOUCHERS_PER_JOB + 1 }, (_, i) => voucher(i));
    h.state.unsyncedLedgers = [
      {
        id: "l-purchase",
        name: "Purchase - GST 18%",
        group: "PURCHASE_ACCOUNTS",
        ledgerType: "PURCHASE",
        gstRate: 18,
        parentGstin: null,
      },
    ];

    const res = await post();

    const masterJobId = res.body.masterJobId as string;
    expect(masterJobId).toBe("job-1");

    const pushes = h.state.createdJobs.filter((j) => j.kind === "VOUCHER_PUSH");
    expect(pushes).toHaveLength(2);
    for (const job of pushes) {
      expect(job.payload.dependsOnJobId).toBe(masterJobId);
    }
  });

  it("does not stamp a dependency when there are no masters to create", async () => {
    h.state.vouchers = Array.from({ length: VOUCHERS_PER_JOB + 1 }, (_, i) => voucher(i));

    const res = await post();

    expect(res.body.masterJobId).toBeNull();
    for (const job of h.state.createdJobs) {
      expect(job.payload.dependsOnJobId).toBeUndefined();
    }
  });

  it("writes the sync rows in bulk instead of one round trip per voucher", async () => {
    const total = VOUCHERS_PER_JOB * 2;
    h.state.vouchers = Array.from({ length: total }, (_, i) => voucher(i));

    await post();

    // Three statements a chunk — insert the missing rows, reset them all, read
    // the remote ids back — and no per-voucher write at all. The old code
    // issued one `upsert` per voucher, which is what could not finish.
    const perVoucherWrites = h.state.syncStatements.filter((s) => s.op === "update");
    expect(perVoucherWrites).toHaveLength(0);
    expect(h.state.syncStatements).toHaveLength(6);
    expect(h.state.syncRows.size).toBe(total);
  });

  it("repairs a sync row whose remote id is not the one Tally holds", async () => {
    // `remoteId` is the only per-row value, so no bulk statement can set it —
    // and a row carrying anything but `RAO-<uuid>` names a voucher Tally does
    // not hold, so a delete against it would silently miss.
    h.state.vouchers = [voucher(1)];
    h.state.syncRows.set("v0001", {
      id: "vs-legacy",
      voucherId: "v0001",
      remoteId: "LEGACY-1",
    });

    await post();

    expect(h.state.syncRows.get("v0001")?.remoteId).toBe("RAO-v0001");
    expect(h.state.syncStatements.filter((s) => s.op === "update")).toHaveLength(1);
  });

  it("still refuses to push before the masters have been synced", async () => {
    h.state.vouchers = [voucher(1)];
    h.state.companyStatus = "UNSYNCED";

    const res = await post();

    expect(res.status).toBe(409);
    expect(h.state.createdJobs).toHaveLength(0);
  });
});
