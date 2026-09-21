import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  BALANCE_EPSILON,
  preflightVouchers,
  hasBlockingIssues,
  groupByVoucher,
  type PreflightVoucher,
} from "../preflight";

const voucher = (overrides: Partial<PreflightVoucher> = {}): PreflightVoucher => ({
  id: "v1",
  date: new Date("2026-03-07"),
  invoiceNumber: "INV-1",
  lines: [
    { ledgerName: "Purchase - GST 18%", debit: 1000, credit: 0 },
    { ledgerName: "IGST Input", debit: 180, credit: 0 },
    { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1180 },
  ],
  ...overrides,
});

const codes = (v: PreflightVoucher[], opts = {}) =>
  preflightVouchers(v, opts).map((i) => i.code);

describe("preflight — a clean voucher", () => {
  it("raises nothing for a balanced, fully mapped voucher", () => {
    expect(preflightVouchers([voucher()])).toEqual([]);
  });

  it("does not block when there are no issues", () => {
    expect(hasBlockingIssues(preflightVouchers([voucher()]))).toBe(false);
  });
});

describe("preflight — 'Ledger name not found'", () => {
  it("flags a line with no ledger assigned", () => {
    const v = voucher({
      lines: [
        { ledgerName: null, debit: 1000, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1000 },
      ],
    });
    expect(codes([v])).toContain("UNMAPPED_LEDGER");
    expect(hasBlockingIssues(preflightVouchers([v]))).toBe(true);
  });

  it("treats a whitespace-only ledger name as unmapped", () => {
    const v = voucher({
      lines: [
        { ledgerName: "   ", debit: 1000, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1000 },
      ],
    });
    expect(codes([v])).toContain("UNMAPPED_LEDGER");
  });
});

describe("preflight — 'Extra space in the name of ledgers'", () => {
  it("warns about a padded ledger name without blocking the export", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Purchase - GST 18% ", debit: 1000, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1000 },
      ],
    });
    const issues = preflightVouchers([v]);
    expect(issues.map((i) => i.code)).toContain("PADDED_NAME");
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("warns about an internal double space", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Acme  Pvt Ltd", debit: 1000, credit: 0 },
        { ledgerName: "Cash", debit: 0, credit: 1000 },
      ],
    });
    expect(codes([v])).toContain("DOUBLE_SPACED_NAME");
  });
});

describe("preflight — 'No accounting allocation'", () => {
  it("flags a voucher whose lines are all zero", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Purchase", debit: 0, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 0 },
      ],
    });
    expect(codes([v])).toContain("NO_ALLOCATION");
  });

  it("does not also call an all-zero voucher unbalanced", () => {
    const v = voucher({
      lines: [{ ledgerName: "Purchase", debit: 0, credit: 0 }],
    });
    expect(codes([v])).not.toContain("UNBALANCED");
  });
});

describe("preflight — balance", () => {
  it("flags debits that do not agree with credits", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Purchase", debit: 1000, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 900 },
      ],
    });
    expect(codes([v])).toContain("UNBALANCED");
  });

  it("tolerates sub-paisa float drift", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Purchase", debit: 1000.001, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1000 },
      ],
    });
    expect(codes([v])).not.toContain("UNBALANCED");
  });
});

describe("preflight — 'The date is out of range'", () => {
  const period = {
    bookBeginning: new Date("2026-04-01"),
    bookEnding: new Date("2027-03-31"),
  };

  it("flags a voucher dated before the book period", () => {
    const v = voucher({ date: new Date("2026-03-31") });
    expect(codes([v], period)).toContain("DATE_OUT_OF_RANGE");
  });

  it("flags a voucher dated after the book period", () => {
    const v = voucher({ date: new Date("2027-04-01") });
    expect(codes([v], period)).toContain("DATE_OUT_OF_RANGE");
  });

  it("accepts a voucher inside the book period", () => {
    const v = voucher({ date: new Date("2026-09-15") });
    expect(codes([v], period)).not.toContain("DATE_OUT_OF_RANGE");
  });

  it("skips the range check when the book period is unknown", () => {
    const v = voucher({ date: new Date("1999-01-01") });
    expect(codes([v])).not.toContain("DATE_OUT_OF_RANGE");
  });

  it("flags an invalid date", () => {
    const v = voucher({ date: new Date("not a date") });
    expect(codes([v])).toContain("DATE_OUT_OF_RANGE");
  });
});

describe("preflight — reporting", () => {
  it("groups issues by voucher so they can be shown per row", () => {
    const bad = voucher({
      id: "v-bad",
      lines: [{ ledgerName: null, debit: 0, credit: 0 }],
    });
    const grouped = groupByVoucher(preflightVouchers([voucher(), bad]));
    expect(grouped.has("v1")).toBe(false);
    expect(grouped.get("v-bad")!.length).toBeGreaterThan(0);
  });
});

describe("preflight — the balance tolerance approval has to share", () => {
  it("is half a paisa", () => {
    expect(BALANCE_EPSILON).toBe(0.005);
  });

  /**
   * The gap that stranded vouchers: the approve routes allowed ₹0.01 of drift
   * while this file rejects anything over ₹0.005. Everything in between
   * approved and then failed pre-flight forever — PATCH requires DRAFT and no
   * route un-approves, so there was no way back.
   */
  it("rejects the drift approval used to let through", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Purchase - GST 18%", debit: 1000.008, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1000 },
      ],
    });
    expect(codes([v])).toContain("UNBALANCED");
  });

  it("accepts drift at the tolerance itself", () => {
    const v = voucher({
      lines: [
        { ledgerName: "Purchase - GST 18%", debit: 1000.005, credit: 0 },
        { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1000 },
      ],
    });
    expect(codes([v])).not.toContain("UNBALANCED");
  });

  /**
   * A source-level guard, deliberately.
   *
   * The routes themselves sit behind a Clerk session a test cannot forge, so
   * the only thing that can hold approval and pre-flight to one number is a
   * check that they still read it from the same place. A literal creeping back
   * into any of the three is exactly how this defect happened the first time.
   */
  it("is the only tolerance the three approve routes compare against", () => {
    const routes = [
      "../../../app/api/vouchers/[voucherId]/approve/route.ts",
      "../../../app/api/vouchers/bulk-approve/route.ts",
      "../../../app/api/vouchers/auto-approve-high/route.ts",
    ];
    for (const rel of routes) {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src, `${rel} must import the shared tolerance`).toContain(
        'BALANCE_EPSILON } from "@/lib/tally/preflight"'
      );
      expect(src, `${rel} compares the balance against a literal`).not.toMatch(
        /totalCredit\)\s*>\s*[\d.]/
      );
    }
  });
});
