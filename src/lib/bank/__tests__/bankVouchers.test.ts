import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  BankStatementNotReadyError,
  buildVouchersForStatement,
  parseAllocations,
  validateStatementBalance,
  type BalanceCheckTxn,
} from "../bankVouchers";

/* ------------------------------------------------------------- balances */

const line = (o: Partial<BalanceCheckTxn> & { id: string }): BalanceCheckTxn => ({
  description: "txn",
  date: new Date("2026-07-05"),
  withdrawal: 0,
  deposit: 0,
  ...o,
});

describe("validateStatementBalance", () => {
  it("reconciles a statement that walks cleanly from opening to closing", () => {
    const check = validateStatementBalance(
      [
        line({ id: "t1", deposit: 10000, balance: 20000 }),
        line({ id: "t2", withdrawal: 2500, balance: 17500 }),
        line({ id: "t3", withdrawal: 500, balance: 17000 }),
      ],
      10000,
      17000
    );
    expect(check.ok).toBe(true);
    expect(check.checked).toBe(true);
    expect(check.firstBreakTxnId).toBeNull();
    expect(check.computedClosing).toBeCloseTo(17000, 2);
    expect(check.note).toMatch(/Reconciled/);
  });

  it("names the first row where the walk diverges, not the last", () => {
    // The 2,500 withdrawal was parsed as 250: every printed balance from there
    // on is 2,250 out, but only the first one is the user's problem.
    const check = validateStatementBalance(
      [
        line({ id: "t1", deposit: 10000, balance: 20000 }),
        line({ id: "t2", withdrawal: 250, description: "NEFT DR ACME", balance: 17500 }),
        line({ id: "t3", withdrawal: 500, balance: 17000 }),
      ],
      10000,
      17000
    );
    expect(check.ok).toBe(false);
    expect(check.firstBreakTxnId).toBe("t2");
    expect(check.firstBreakRow).toBe(2);
    expect(check.note).toContain("NEFT DR ACME");
    expect(check.note).toMatch(/row 2/);
    // Both figures appear, so the user can see which way it is out.
    expect(check.note).toMatch(/19,750\.00/);
    expect(check.note).toMatch(/17,500\.00/);
  });

  it("catches a dropped row from the closing balance when no row prints one", () => {
    // A withdrawal never made it into the file, so the rows end up richer than
    // the statement says.
    const check = validateStatementBalance(
      [line({ id: "t1", deposit: 10000 }), line({ id: "t2", withdrawal: 2500 })],
      10000,
      15000
    );
    expect(check.ok).toBe(false);
    expect(check.firstBreakTxnId).toBeNull();
    expect(check.note).toMatch(/do not reconcile/);
    expect(check.note).toMatch(/too much/);
    expect(check.note).toMatch(/a page, that never made it into the file/);
  });

  it("says the other direction when a deposit is the row that went astray", () => {
    const check = validateStatementBalance(
      [line({ id: "t1", deposit: 10000 })],
      10000,
      25000
    );
    expect(check.ok).toBe(false);
    expect(check.note).toMatch(/₹5,000\.00 missing/);
  });

  it("says it was never checked rather than showing a green tick", () => {
    const check = validateStatementBalance([line({ id: "t1", deposit: 10000 })], null, 10000);
    expect(check.checked).toBe(false);
    expect(check.ok).toBe(true);
    expect(check.note).toMatch(/no opening balance/i);
  });

  it("finishes the walk when there is an opening balance but no closing one", () => {
    const check = validateStatementBalance(
      [line({ id: "t1", deposit: 10000, balance: 20000 })],
      10000,
      null
    );
    expect(check.checked).toBe(true);
    expect(check.ok).toBe(true);
    expect(check.computedClosing).toBeCloseTo(20000, 2);
    expect(check.note).toMatch(/no closing balance/);
  });

  it("tolerates float noise under half a paisa", () => {
    const check = validateStatementBalance(
      [line({ id: "t1", withdrawal: 0.1 }), line({ id: "t2", withdrawal: 0.2 })],
      1,
      0.7
    );
    expect(check.ok).toBe(true);
  });
});

describe("parseAllocations", () => {
  it("keeps well-formed legs and drops everything else", () => {
    expect(
      parseAllocations([
        { ledgerId: "L1", ledgerName: "Rent", amount: 5000 },
        { ledgerId: "L2", amount: 0 },
        { amount: "not a number" },
        null,
        "nonsense",
      ] as never)
    ).toEqual([{ ledgerId: "L1", ledgerName: "Rent", amount: 5000 }]);
  });

  it("treats a null column as no split at all", () => {
    expect(parseAllocations(null)).toEqual([]);
  });
});

/* -------------------------------------------------------------- building */

interface FakeTxn {
  id: string;
  date: Date | null;
  description: string;
  withdrawal: number;
  deposit: number;
  classification: "PAYMENT" | "RECEIPT" | "CONTRA" | null;
  ledgerId: string | null;
  ledgerNameSnapshot: string | null;
  confidence: number | null;
  allocations: unknown;
  saved: boolean;
  voucherId: string | null;
  sortOrder: number;
}

const fakeTxn = (o: Partial<FakeTxn> & { id: string }): FakeTxn => ({
  date: new Date("2026-07-05"),
  description: "NEFT DR ACME TRADERS",
  withdrawal: 0,
  deposit: 0,
  classification: null,
  ledgerId: null,
  ledgerNameSnapshot: null,
  confidence: null,
  allocations: null,
  saved: true,
  voucherId: null,
  sortOrder: 0,
  ...o,
});

/**
 * A Prisma stand-in, cast the way `syncJobs.test.ts` does it. Only the handful
 * of calls `buildVouchersForStatement` makes are modelled, and the claim on
 * `bankTxn.updateMany` behaves like the real conditional update — which is the
 * thing worth testing.
 */
function makeDb(opts: {
  bankLedgerId?: string | null;
  txns: FakeTxn[];
  ledgers?: { id: string; name: string }[];
  /** Fires just before the claim, to simulate a concurrent build winning. */
  beforeClaim?: (txnId: string) => void;
}) {
  const state = {
    txns: opts.txns,
    ledgers: opts.ledgers ?? [
      { id: "L_BANK", name: "HDFC Current A/c" },
      { id: "L_RENT", name: "Rent" },
      { id: "L_GST", name: "CGST Input" },
    ],
    invoices: [] as Record<string, unknown>[],
    vouchers: [] as Record<string, unknown>[],
    deletedVouchers: [] as string[],
    deletedInvoices: [] as string[],
  };

  let seq = 0;

  const db = {
    bankStatement: {
      findFirst: async ({ where }: { where: { userId: string; clientId: string } }) => {
        if (where.userId !== "u1" || where.clientId !== "c1") return null;
        return {
          id: "s1",
          bankName: "HDFC Bank",
          accountNumber: "50200012345",
          bankLedgerId: opts.bankLedgerId === undefined ? "L_BANK" : opts.bankLedgerId,
        };
      },
    },
    bankTxn: {
      findMany: async ({ where }: { where: { id?: { in: string[] } } }) => {
        const ids = where.id?.in;
        return state.txns.filter((t) => !ids || ids.includes(t.id)).map((t) => ({ ...t }));
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; voucherId: null };
        data: { voucherId: string };
      }) => {
        const row = state.txns.find((t) => t.id === where.id);
        if (!row || row.voucherId !== null) return { count: 0 };
        row.voucherId = data.voucherId;
        return { count: 1 };
      },
    },
    ledger: {
      findMany: async ({
        where,
      }: {
        where: { id: { in: string[] }; userId: string; clientId: string };
      }) => {
        if (where.userId !== "u1" || where.clientId !== "c1") return [];
        return state.ledgers.filter((l) => where.id.in.includes(l.id));
      },
    },
    invoice: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `inv-${++seq}`;
        state.invoices.push({ id, ...data });
        return { id };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.deletedInvoices.push(where.id);
        return { id: where.id };
      },
    },
    voucher: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `vch-${++seq}`;
        state.vouchers.push({ id, ...data });
        // The race window is between creating the voucher and claiming the row.
        opts.beforeClaim?.(id);
        return { id };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        state.deletedVouchers.push(where.id);
        return { id: where.id };
      },
    },
  };

  return { db: db as unknown as PrismaClient, state };
}

const input = { userId: "u1", clientId: "c1", statementId: "s1" };

type VoucherLine = {
  ledgerNameSnapshot: string | null;
  role: string;
  debit: number;
  credit: number;
};
const linesOf = (voucher: Record<string, unknown>): VoucherLine[] =>
  ((voucher.lines as { create: VoucherLine[] }).create ?? []) as VoucherLine[];

describe("buildVouchersForStatement", () => {
  let fake: ReturnType<typeof makeDb>;

  it("refuses, by name, when the statement has no bank ledger", async () => {
    fake = makeDb({
      bankLedgerId: null,
      txns: [fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT" })],
    });

    await expect(buildVouchersForStatement(fake.db, input)).rejects.toBeInstanceOf(
      BankStatementNotReadyError
    );

    // The competitor's version of this is the two-word string "Please Select
    // Bank". Ours has to say which account, what the field is for, and that
    // existing work is safe.
    const message = await buildVouchersForStatement(fake.db, input).then(
      () => "",
      (e: Error) => e.message
    );
    expect(message).toContain("HDFC Bank");
    expect(message).toContain("50200012345");
    expect(message).toMatch(/bank account itself on one side/);
    expect(message).toMatch(/are kept/);
    expect(fake.state.vouchers).toHaveLength(0);
  });

  it("refuses when the bound bank ledger has since been deleted", async () => {
    fake = makeDb({
      txns: [fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT" })],
      ledgers: [{ id: "L_RENT", name: "Rent" }],
    });
    await expect(buildVouchersForStatement(fake.db, input)).rejects.toThrow(/no longer exists/);
  });

  it("builds a Payment from a single ledger and claims the row", async () => {
    fake = makeDb({
      txns: [fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT", ledgerNameSnapshot: "stale" })],
    });

    const result = await buildVouchersForStatement(fake.db, input);

    expect(result.built).toHaveLength(1);
    expect(result.built[0].voucherType).toBe("PAYMENT");
    expect(result.failed).toEqual([]);
    expect(fake.state.txns[0].voucherId).toBe(result.built[0].voucherId);

    const voucher = fake.state.vouchers[0];
    expect(voucher.status).toBe("APPROVED");
    const lines = linesOf(voucher);
    const bank = lines.find((l) => l.role === "BANK")!;
    expect(bank.credit).toBeCloseTo(5000, 2);
    // The name is re-read from the ledger table, not taken from the row's
    // possibly-stale snapshot — that snapshot is what reaches <LEDGERNAME>.
    const item = lines.find((l) => l.role === "ITEM")!;
    expect(item.ledgerNameSnapshot).toBe("Rent");
    expect(item.debit).toBeCloseTo(5000, 2);
  });

  it("builds a Receipt from a deposit", async () => {
    fake = makeDb({ txns: [fakeTxn({ id: "t1", deposit: 12000, ledgerId: "L_RENT" })] });
    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.built[0].voucherType).toBe("RECEIPT");
    const bank = linesOf(fake.state.vouchers[0]).find((l) => l.role === "BANK")!;
    expect(bank.debit).toBeCloseTo(12000, 2);
  });

  it("honours a Contra override, which is the only way to get one", async () => {
    fake = makeDb({
      txns: [
        fakeTxn({ id: "t1", withdrawal: 10000, ledgerId: "L_RENT", classification: "CONTRA" }),
      ],
    });
    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.built[0].voucherType).toBe("CONTRA");
  });

  it("splits a line across ledgers when allocations are present", async () => {
    fake = makeDb({
      txns: [
        fakeTxn({
          id: "t1",
          withdrawal: 11800,
          ledgerId: "L_RENT",
          allocations: [
            { ledgerId: "L_RENT", ledgerName: "Rent", amount: 10000 },
            { ledgerId: "L_GST", ledgerName: "CGST Input", amount: 1800 },
          ],
        }),
      ],
    });

    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.built).toHaveLength(1);

    const lines = linesOf(fake.state.vouchers[0]);
    expect(lines.filter((l) => l.role === "ITEM")).toHaveLength(2);
    expect(lines.find((l) => l.role === "BANK")!.credit).toBeCloseTo(11800, 2);
    const debits = lines.reduce((s, l) => s + l.debit, 0);
    const credits = lines.reduce((s, l) => s + l.credit, 0);
    expect(debits).toBeCloseTo(credits, 2);
    // No plug line: an exact split must not invent a round-off.
    expect(lines.some((l) => l.role === "ROUND_OFF")).toBe(false);
  });

  it("refuses a split that does not total the transaction, in buildBankVoucher's own words", async () => {
    fake = makeDb({
      txns: [
        fakeTxn({
          id: "t1",
          withdrawal: 11800,
          ledgerId: "L_RENT",
          allocations: [
            { ledgerId: "L_RENT", ledgerName: "Rent", amount: 10000 },
            { ledgerId: "L_GST", ledgerName: "CGST Input", amount: 1500 },
          ],
        }),
      ],
    });

    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.built).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].messages[0]).toMatch(/11,?500\.00/);
    expect(result.failed[0].messages[0]).toMatch(/11,?800\.00/);
    expect(result.failed[0].messages[0]).toMatch(/match exactly/);
    // Nothing was written, and above all the row was not claimed.
    expect(fake.state.vouchers).toHaveLength(0);
    expect(fake.state.txns[0].voucherId).toBeNull();
  });

  it("skips rows that have not been saved — choosing and committing are separate", async () => {
    fake = makeDb({
      txns: [
        fakeTxn({ id: "t1", withdrawal: 500, ledgerId: "L_RENT", saved: false }),
        fakeTxn({ id: "t2", withdrawal: 700, ledgerId: "L_RENT", saved: true, sortOrder: 1 }),
      ],
    });

    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.built.map((b) => b.txnId)).toEqual(["t2"]);
    expect(result.skipped[0]).toEqual({
      txnId: "t1",
      reason: "Not saved yet. Assigning a ledger and saving the row are separate steps.",
    });
  });

  it("fails a saved row that has no ledger at all rather than posting a half voucher", async () => {
    fake = makeDb({ txns: [fakeTxn({ id: "t1", withdrawal: 500 })] });
    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.built).toEqual([]);
    expect(result.failed[0].messages[0]).toMatch(/no ledger|does not exist/i);
  });

  it("fails an undated row", async () => {
    fake = makeDb({
      txns: [fakeTxn({ id: "t1", withdrawal: 500, ledgerId: "L_RENT", date: null })],
    });
    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.failed[0].messages[0]).toMatch(/no date/i);
  });

  it("fails a row whose ledger has been deleted from the workspace", async () => {
    fake = makeDb({
      txns: [fakeTxn({ id: "t1", withdrawal: 500, ledgerId: "L_GONE" })],
    });
    const result = await buildVouchersForStatement(fake.db, input);
    expect(result.failed[0].messages[0]).toMatch(/does not exist in this workspace/);
  });

  /**
   * The re-run test. Build, push, one voucher fails in Tally, user hits send
   * again: the already-built rows must not produce a second voucher, and their
   * ids must still come back so the failed one can be re-sent.
   */
  it("is safely re-runnable — a second build creates nothing and still reports the ids", async () => {
    fake = makeDb({
      txns: [
        fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT" }),
        fakeTxn({ id: "t2", deposit: 9000, ledgerId: "L_RENT", sortOrder: 1 }),
      ],
    });

    const first = await buildVouchersForStatement(fake.db, input);
    expect(first.built).toHaveLength(2);
    expect(fake.state.vouchers).toHaveLength(2);

    const second = await buildVouchersForStatement(fake.db, input);
    expect(second.built).toEqual([]);
    expect(second.skipped.map((s) => s.reason)).toEqual(["Already built.", "Already built."]);
    expect(second.voucherIds.sort()).toEqual(first.voucherIds.sort());
    expect(fake.state.vouchers).toHaveLength(2);
  });

  it("loses the claim to a concurrent build and cleans up after itself", async () => {
    fake = makeDb({
      txns: [fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT" })],
      // Another build got there first, between our create and our claim.
      beforeClaim: () => {
        fake.state.txns[0].voucherId = "vch-someone-else";
      },
    });

    const result = await buildVouchersForStatement(fake.db, input);

    expect(result.built).toEqual([]);
    expect(result.skipped[0].reason).toBe("Already built.");
    // The orphan voucher is removed. There is no invoice to clean up.
    expect(fake.state.deletedVouchers).toHaveLength(1);
    expect(fake.state.deletedInvoices).toEqual([]);
    expect(fake.state.txns[0].voucherId).toBe("vch-someone-else");
  });

  it("restricts the build to the rows it was asked about", async () => {
    fake = makeDb({
      txns: [
        fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT" }),
        fakeTxn({ id: "t2", withdrawal: 700, ledgerId: "L_RENT", sortOrder: 1 }),
      ],
    });
    const result = await buildVouchersForStatement(fake.db, { ...input, txnIds: ["t2"] });
    expect(result.built.map((b) => b.txnId)).toEqual(["t2"]);
    expect(fake.state.txns[0].voucherId).toBeNull();
  });

  /**
   * No invoice, at all.
   *
   * This used to write a synthetic carrier `Invoice` with a `bank://` file URL,
   * because `Voucher.invoiceId` was a required FK. That fake bill then showed up
   * in the invoice list, on the pipeline board and in the Tally export as a
   * document with a null vendor and a null number. `invoiceId` is nullable now
   * and a bank row is exactly the case it was made nullable for.
   *
   * The two fields the carrier had to leave empty are still worth stating,
   * because the push path reads them off the voucher's invoice: `vendor` becomes
   * <PARTYLEDGERNAME> and would name a party ledger that does not exist, and
   * `invoiceNumber` becomes <VOUCHERNUMBER> where the exporter's `RAO-<id>`
   * fallback is the stable one. Absent satisfies both.
   */
  it("writes no invoice at all — the voucher stands on its own", async () => {
    fake = makeDb({
      txns: [fakeTxn({ id: "t1", withdrawal: 5000, ledgerId: "L_RENT" })],
    });
    const result = await buildVouchersForStatement(fake.db, input);

    expect(result.built).toHaveLength(1);
    expect(fake.state.invoices).toEqual([]);
    expect(fake.state.vouchers).toHaveLength(1);
    expect(fake.state.vouchers[0].invoiceId).toBeUndefined();
  });

  it("refuses to read a statement belonging to another workspace", async () => {
    fake = makeDb({ txns: [fakeTxn({ id: "t1", withdrawal: 500, ledgerId: "L_RENT" })] });
    await expect(
      buildVouchersForStatement(fake.db, { ...input, clientId: "someone-else" })
    ).rejects.toThrow(/not found/i);
  });
});

describe("build result plumbing", () => {
  it("returns nothing to do for an empty selection rather than throwing", async () => {
    const fake = makeDb({ txns: [] });
    const result = await buildVouchersForStatement(fake.db, input);
    expect(result).toEqual({ built: [], skipped: [], failed: [], voucherIds: [] });
  });
});
