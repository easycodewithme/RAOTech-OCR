import { describe, it, expect } from "vitest";
import { buildBankVoucher, type BankVoucherInput } from "../buildBankVoucher";

/**
 * SYNC-03: a bank payment to a supplier has to say which bill it touches.
 *
 * Bank vouchers only ever produced ITEM and BANK lines, so nothing ever reached
 * the emitter's party branch and a payment posted with no allocation at all.
 * The counter-ledger being Sundry Creditors is precisely the case where that
 * matters: the ledger is written to Tally with ISBILLWISEON=Yes, so an entry
 * naming no bill is parked On Account, the invoice stays 100% outstanding, and
 * an unapplied payment sits beside it in every ageing report the firm sends.
 */

const base = (o: Partial<BankVoucherInput> = {}): BankVoucherInput => ({
  date: new Date("2026-08-05"),
  bankLedgerId: "L_BANK",
  bankLedgerName: "HDFC Current A/c",
  withdrawal: 0,
  deposit: 0,
  allocations: [],
  ...o,
});

const creditor = (o: Record<string, unknown> = {}) => ({
  ledgerId: "L_ACME",
  ledgerName: "Acme Pvt Ltd",
  amount: 5000,
  ledgerGroup: "SUNDRY_CREDITORS" as const,
  ...o,
});

describe("buildBankVoucher — party allocation", () => {
  it("a payment to a creditor becomes a PARTY line carrying an allocation", () => {
    const { draft, errors } = buildBankVoucher(
      base({ withdrawal: 5000, allocations: [creditor()] })
    );

    expect(errors).toEqual([]);
    const party = draft!.lines.find((l) => l.role === "PARTY");
    // The whole bug in one assertion: this line used to be an ITEM with no
    // allocation, which Tally reads as "post it On Account and tell nobody".
    expect(party).toBeDefined();
    expect(party!.ledgerId).toBe("L_ACME");
    expect(party!.debit).toBeCloseTo(5000, 2);
  });

  it("says On Account explicitly when the bill is not known", () => {
    const { draft } = buildBankVoucher(base({ withdrawal: 5000, allocations: [creditor()] }));
    const party = draft!.lines.find((l) => l.role === "PARTY")!;

    // Not a placeholder: this is the same posting Tally already makes for an
    // unallocated entry, stated rather than left to be inferred from silence.
    expect(party.billRefType).toBe("On Account");
    expect(party.billRefName).toBeNull();
  });

  it("emits Agst Ref against the bill when one has been chosen", () => {
    const { draft } = buildBankVoucher(
      base({ withdrawal: 5000, allocations: [creditor({ billRefName: "INV-1" })] })
    );
    const party = draft!.lines.find((l) => l.role === "PARTY")!;
    expect(party.billRefType).toBe("Agst Ref");
    expect(party.billRefName).toBe("INV-1");
  });

  it("a receipt from a debtor allocates on the credit side", () => {
    const { draft } = buildBankVoucher(
      base({
        deposit: 12000,
        allocations: [
          creditor({ amount: 12000, ledgerGroup: "SUNDRY_DEBTORS", ledgerName: "Beta Ltd" }),
        ],
      })
    );
    const party = draft!.lines.find((l) => l.role === "PARTY")!;
    expect(draft!.voucherType).toBe("RECEIPT");
    expect(party.credit).toBeCloseTo(12000, 2);
    expect(party.billRefType).toBe("On Account");
  });

  it("trims a bill reference, and treats a blank one as no reference", () => {
    const named = buildBankVoucher(
      base({ withdrawal: 5000, allocations: [creditor({ billRefName: "  INV-2  " })] })
    ).draft!;
    expect(named.lines.find((l) => l.role === "PARTY")!.billRefName).toBe("INV-2");

    const blank = buildBankVoucher(
      base({ withdrawal: 5000, allocations: [creditor({ billRefName: "   " })] })
    ).draft!;
    expect(blank.lines.find((l) => l.role === "PARTY")!.billRefType).toBe("On Account");
  });
});

describe("buildBankVoucher — everything that is not a party is untouched", () => {
  it("an expense ledger stays an ITEM with no allocation", () => {
    // Tally rejects a BILLALLOCATIONS.LIST on a ledger it is not ageing, so
    // this is not a missing feature — emitting one here would break the post.
    const { draft } = buildBankVoucher(
      base({
        withdrawal: 5000,
        allocations: [
          { ledgerId: "L_RENT", ledgerName: "Rent", amount: 5000, ledgerGroup: "INDIRECT_EXPENSES" },
        ],
      })
    );
    const line = draft!.lines.find((l) => l.ledgerId === "L_RENT")!;
    expect(line.role).toBe("ITEM");
    expect(line.billRefType ?? null).toBeNull();
  });

  it("an allocation with no group given behaves exactly as it did before", () => {
    // Unknown is not guessed. Callers that cannot supply the group get the old
    // behaviour rather than a fabricated party allocation.
    const { draft } = buildBankVoucher(
      base({
        withdrawal: 5000,
        allocations: [{ ledgerId: "L_ACME", ledgerName: "Acme Pvt Ltd", amount: 5000 }],
      })
    );
    const line = draft!.lines.find((l) => l.ledgerId === "L_ACME")!;
    expect(line.role).toBe("ITEM");
    expect(line.billRefType ?? null).toBeNull();
  });

  it("the bank side never carries an allocation", () => {
    const { draft } = buildBankVoucher(base({ withdrawal: 5000, allocations: [creditor()] }));
    const bank = draft!.lines.find((l) => l.role === "BANK")!;
    expect(bank.billRefType ?? null).toBeNull();
  });
});

describe("buildBankVoucher — splits keep every allocation on its own line", () => {
  it("pairs each bill reference with the ledger it belongs to, and stays balanced", () => {
    const { draft, errors } = buildBankVoucher(
      base({
        withdrawal: 8000,
        allocations: [
          creditor({ amount: 3000, billRefName: "INV-1" }),
          creditor({
            ledgerId: "L_BETA",
            ledgerName: "Beta Ltd",
            amount: 2000,
            ledgerGroup: "SUNDRY_CREDITORS",
          }),
          { ledgerId: "L_RENT", ledgerName: "Rent", amount: 3000 },
        ],
      })
    );

    expect(errors).toEqual([]);
    const byLedger = new Map(draft!.lines.map((l) => [l.ledgerId, l]));

    // A misaligned pairing would put one supplier's bill reference on another
    // supplier's account — worse than no allocation at all.
    expect(byLedger.get("L_ACME")!.billRefType).toBe("Agst Ref");
    expect(byLedger.get("L_ACME")!.billRefName).toBe("INV-1");
    expect(byLedger.get("L_BETA")!.billRefType).toBe("On Account");
    expect(byLedger.get("L_BETA")!.billRefName).toBeNull();
    expect(byLedger.get("L_RENT")!.billRefType ?? null).toBeNull();

    expect(draft!.totalDebit).toBeCloseTo(draft!.totalCredit, 2);
    expect(draft!.lines.some((l) => l.role === "ROUND_OFF")).toBe(false);
  });

  it("the allocated amount is the line's own amount, on its own side", () => {
    // The sign invariant upstream of the XML: the emitter reuses the ledger
    // entry's amount string, so the amount on this line is the amount Tally is
    // told to knock off the bill.
    const { draft } = buildBankVoucher(
      base({ withdrawal: 1234.56, allocations: [creditor({ amount: 1234.56, billRefName: "INV-1" })] })
    );
    const party = draft!.lines.find((l) => l.role === "PARTY")!;
    expect(party.debit).toBeCloseTo(1234.56, 2);
    expect(party.credit).toBe(0);
    expect(draft!.totalDebit).toBeCloseTo(draft!.totalCredit, 2);
  });
});
