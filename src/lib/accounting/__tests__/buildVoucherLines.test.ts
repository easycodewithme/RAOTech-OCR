import { describe, it, expect } from "vitest";
import { buildVoucherFromLines, sumSides } from "../buildVoucherLines";
import type { VoucherLineInput } from "../types";

const line = (
  role: VoucherLineInput["role"],
  amount: number,
  side: "DR" | "CR",
  ledgerId: string | null = "L1"
): VoucherLineInput => ({
  role,
  ledgerId,
  ledgerName: ledgerId ? `Ledger ${ledgerId}` : null,
  amount,
  side,
});

describe("buildVoucherFromLines", () => {
  it("keeps a balanced set balanced and adds no round-off line", () => {
    const v = buildVoucherFromLines({
      voucherType: "JOURNAL",
      date: new Date("2026-08-01"),
      lines: [line("ITEM", 1000, "DR", "L_EXP"), line("PARTY", 1000, "CR", "L_PARTY")],
    });
    expect(v.totalDebit).toBeCloseTo(1000, 2);
    expect(v.totalCredit).toBeCloseTo(1000, 2);
    expect(v.roundOff).toBe(0);
    expect(v.lines.some((l) => l.role === "ROUND_OFF")).toBe(false);
  });

  /**
   * A journal is the case the old invoice-shaped builder could not express at
   * all: several ledgers, each naming its own side, with no party and no tax.
   */
  it("builds a multi-line journal with no party and no tax", () => {
    const v = buildVoucherFromLines({
      voucherType: "JOURNAL",
      date: new Date("2026-08-01"),
      lines: [
        line("ITEM", 6000, "DR", "L_RENT"),
        line("ITEM", 1500, "DR", "L_ELEC"),
        line("BANK", 7500, "CR", "L_BANK"),
      ],
    });
    expect(v.lines).toHaveLength(3);
    expect(v.totalDebit).toBeCloseTo(7500, 2);
    expect(v.totalCredit).toBeCloseTo(7500, 2);
    expect(v.hasUnmapped).toBe(false);
  });

  it("posts the residual to round-off, on the side that balances", () => {
    const v = buildVoucherFromLines({
      voucherType: "PURCHASE",
      date: new Date("2026-08-01"),
      lines: [line("ITEM", 1000.4, "DR"), line("PARTY", 1000, "CR")],
      roundOffLedgerId: "L_RO",
      roundOffLedgerName: "Round Off",
    });
    const ro = v.lines.find((l) => l.role === "ROUND_OFF")!;
    // Debits exceed credits, so the balancing line is a credit.
    expect(ro.credit).toBeCloseTo(0.4, 2);
    expect(ro.debit).toBe(0);
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
  });

  it("warns when the residual is too large to be rounding", () => {
    const v = buildVoucherFromLines({
      voucherType: "PURCHASE",
      date: new Date("2026-08-01"),
      lines: [line("ITEM", 1500, "DR"), line("PARTY", 1000, "CR")],
      roundOffLedgerId: "L_RO",
    });
    expect(v.warnings.join(" ")).toMatch(/exceeds tolerance/i);
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
  });

  /**
   * The regression this refactor exists to prevent.
   *
   * A voucher whose tax ledgers resolved to nothing used to report itself fully
   * mapped, because only the party and item lines were checked. It posted, and
   * Tally answered `Ledger 'Unknown' does not exist!` — naming a ledger nobody
   * chose, because the XML writer substitutes "Unknown" for a null snapshot.
   */
  it("flags ANY line without a ledger, not just party and item", () => {
    const v = buildVoucherFromLines({
      voucherType: "PURCHASE",
      date: new Date("2026-08-01"),
      lines: [
        line("ITEM", 10000, "DR", "L_PURCH"),
        line("CGST", 900, "DR", null),
        line("SGST", 900, "DR", null),
        line("PARTY", 11800, "CR", "L_PARTY"),
      ],
      roundOffLedgerId: "L_RO",
    });
    expect(v.hasUnmapped).toBe(true);
  });

  it("drops zero and negative lines rather than posting empties", () => {
    const v = buildVoucherFromLines({
      voucherType: "PURCHASE",
      date: new Date("2026-08-01"),
      lines: [
        line("ITEM", 1000, "DR"),
        line("DISCOUNT", 0, "CR"),
        line("CESS", -5, "DR"),
        line("PARTY", 1000, "CR"),
      ],
    });
    expect(v.lines).toHaveLength(2);
    expect(v.lines.some((l) => l.role === "DISCOUNT")).toBe(false);
    expect(v.lines.some((l) => l.role === "CESS")).toBe(false);
  });

  it("preserves the order lines were given", () => {
    const v = buildVoucherFromLines({
      voucherType: "PURCHASE",
      date: new Date("2026-08-01"),
      lines: [
        line("ITEM", 100, "DR", "A"),
        line("CGST", 9, "DR", "B"),
        line("PARTY", 109, "CR", "C"),
      ],
    });
    expect(v.lines.map((l) => l.ledgerId)).toEqual(["A", "B", "C"]);
    expect(v.lines.map((l) => l.sortOrder)).toEqual([0, 1, 2]);
  });

  it("sums in paise so float error cannot fake a balance", () => {
    const v = buildVoucherFromLines({
      voucherType: "PURCHASE",
      date: new Date("2026-08-01"),
      lines: [
        line("ITEM", 0.1, "DR"),
        line("ITEM", 0.2, "DR"),
        line("PARTY", 0.3, "CR"),
      ],
    });
    // 0.1 + 0.2 !== 0.3 in binary floating point; in paise it is exact.
    expect(v.roundOff).toBe(0);
    expect(v.lines.some((l) => l.role === "ROUND_OFF")).toBe(false);
  });
});

describe("sumSides", () => {
  it("totals each side and ignores non-positive amounts", () => {
    const { debit, credit } = sumSides([
      { role: "ITEM", ledgerId: "A", ledgerName: null, amount: 500, side: "DR" },
      { role: "ITEM", ledgerId: "B", ledgerName: null, amount: 250, side: "DR" },
      { role: "BANK", ledgerId: "C", ledgerName: null, amount: 750, side: "CR" },
      { role: "ITEM", ledgerId: "D", ledgerName: null, amount: 0, side: "DR" },
    ]);
    expect(debit).toBeCloseTo(750, 2);
    expect(credit).toBeCloseTo(750, 2);
  });
});
