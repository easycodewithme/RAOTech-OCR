import { describe, it, expect } from "vitest";
import {
  buildBankVoucher,
  defaultBankVoucherType,
  type BankVoucherInput,
} from "../buildBankVoucher";

const base = (o: Partial<BankVoucherInput> = {}): BankVoucherInput => ({
  date: new Date("2026-08-05"),
  bankLedgerId: "L_BANK",
  bankLedgerName: "HDFC Current A/c",
  withdrawal: 0,
  deposit: 0,
  allocations: [],
  ...o,
});

describe("buildBankVoucher — direction", () => {
  it("a withdrawal becomes a Payment: bank credited, counter-ledger debited", () => {
    const { draft, errors } = buildBankVoucher(
      base({
        withdrawal: 5000,
        allocations: [{ ledgerId: "L_RENT", ledgerName: "Rent", amount: 5000 }],
      })
    );
    expect(errors).toEqual([]);
    expect(draft!.voucherType).toBe("PAYMENT");
    const bank = draft!.lines.find((l) => l.role === "BANK")!;
    expect(bank.credit).toBeCloseTo(5000, 2);
    expect(bank.debit).toBe(0);
    const other = draft!.lines.find((l) => l.role === "ITEM")!;
    expect(other.debit).toBeCloseTo(5000, 2);
    expect(draft!.totalDebit).toBeCloseTo(draft!.totalCredit, 2);
  });

  it("a deposit becomes a Receipt: bank debited, counter-ledger credited", () => {
    const { draft } = buildBankVoucher(
      base({
        deposit: 12000,
        allocations: [{ ledgerId: "L_SALES", ledgerName: "Sales", amount: 12000 }],
      })
    );
    expect(draft!.voucherType).toBe("RECEIPT");
    const bank = draft!.lines.find((l) => l.role === "BANK")!;
    expect(bank.debit).toBeCloseTo(12000, 2);
    const other = draft!.lines.find((l) => l.role === "ITEM")!;
    expect(other.credit).toBeCloseTo(12000, 2);
  });

  /**
   * Contra cannot be inferred: a transfer between the firm's own accounts looks
   * exactly like an ordinary payment from one side of the statement.
   */
  it("Contra is only ever chosen explicitly, and keeps the sides", () => {
    const { draft } = buildBankVoucher(
      base({
        withdrawal: 25000,
        allocations: [{ ledgerId: "L_CASH", ledgerName: "Cash", amount: 25000 }],
        voucherTypeOverride: "CONTRA",
      })
    );
    expect(draft!.voucherType).toBe("CONTRA");
    expect(draft!.lines.find((l) => l.role === "BANK")!.credit).toBeCloseTo(25000, 2);
    expect(draft!.lines.find((l) => l.role === "ITEM")!.debit).toBeCloseTo(25000, 2);
  });

  it("defaultBankVoucherType never guesses Contra", () => {
    expect(defaultBankVoucherType(100, 0)).toBe("PAYMENT");
    expect(defaultBankVoucherType(0, 100)).toBe("RECEIPT");
    expect(defaultBankVoucherType(0, 0)).toBeNull();
  });
});

describe("buildBankVoucher — splits", () => {
  it("splits one line across several ledgers and stays balanced", () => {
    const { draft, errors } = buildBankVoucher(
      base({
        withdrawal: 10000,
        allocations: [
          { ledgerId: "L_RENT", ledgerName: "Rent", amount: 7000 },
          { ledgerId: "L_ELEC", ledgerName: "Electricity", amount: 3000 },
        ],
      })
    );
    expect(errors).toEqual([]);
    expect(draft!.lines.filter((l) => l.role === "ITEM")).toHaveLength(2);
    expect(draft!.totalDebit).toBeCloseTo(10000, 2);
    expect(draft!.totalCredit).toBeCloseTo(10000, 2);
  });

  /**
   * The important refusal. Tally would happily accept a voucher balanced with a
   * round-off plug, and the books would be quietly wrong by the unallocated
   * amount. Better to refuse and make the user finish the split.
   */
  it("refuses a split that does not total the transaction", () => {
    const { draft, errors } = buildBankVoucher(
      base({
        withdrawal: 10000,
        allocations: [
          { ledgerId: "L_RENT", ledgerName: "Rent", amount: 7000 },
          { ledgerId: "L_ELEC", ledgerName: "Electricity", amount: 2000 },
        ],
      })
    );
    expect(draft).toBeNull();
    expect(errors.join(" ")).toMatch(/must match exactly/i);
    expect(errors.join(" ")).toMatch(/9000\.00.*10000\.00/);
  });

  it("never emits a round-off line — a residual here would be a bug, not rounding", () => {
    const { draft } = buildBankVoucher(
      base({
        deposit: 999.99,
        allocations: [{ ledgerId: "L_X", ledgerName: "X", amount: 999.99 }],
      })
    );
    expect(draft!.lines.some((l) => l.role === "ROUND_OFF")).toBe(false);
    expect(draft!.roundOff).toBe(0);
  });
});

describe("buildBankVoucher — refusals", () => {
  it("refuses a line with no ledger chosen", () => {
    const { draft, errors } = buildBankVoucher(base({ withdrawal: 500 }));
    expect(draft).toBeNull();
    expect(errors.join(" ")).toMatch(/no ledger has been chosen/i);
  });

  it("refuses a line with no amount", () => {
    const { draft, errors } = buildBankVoucher(
      base({ allocations: [{ ledgerId: "L", ledgerName: "L", amount: 0 }] })
    );
    expect(draft).toBeNull();
    expect(errors.join(" ")).toMatch(/no amount/i);
  });

  it("refuses a line that is both a withdrawal and a deposit", () => {
    const { draft, errors } = buildBankVoucher(
      base({
        withdrawal: 100,
        deposit: 100,
        allocations: [{ ledgerId: "L", ledgerName: "L", amount: 100 }],
      })
    );
    expect(draft).toBeNull();
    expect(errors.join(" ")).toMatch(/one or the other/i);
  });

  it("still flags an allocation with no ledger id, so approval is blocked", () => {
    const { draft } = buildBankVoucher(
      base({
        withdrawal: 400,
        allocations: [{ ledgerId: null, ledgerName: "Suspense", amount: 400 }],
      })
    );
    expect(draft!.hasUnmapped).toBe(true);
  });
});
