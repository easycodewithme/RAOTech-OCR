import { describe, it, expect } from "vitest";
import { buildVoucher } from "../buildVoucher";
import type { NormalizedInvoice, ResolvedLedgers } from "../types";

function baseResolved(overrides: Partial<ResolvedLedgers> = {}): ResolvedLedgers {
  return {
    party: { id: "L_PARTY", name: "Sundry Creditors", confidence: 1, via: "RULE" },
    itemLedgers: [],
    cgstLedgerId: "L_CGST",
    sgstLedgerId: "L_SGST",
    igstLedgerId: "L_IGST",
    roundOffLedgerId: "L_RO",
    discountLedgerId: "L_DISC",
    cgstLedgerName: "CGST Input",
    sgstLedgerName: "SGST Input",
    igstLedgerName: "IGST Input",
    roundOffLedgerName: "Round Off",
    discountLedgerName: "Discount Received",
    ...overrides,
  };
}

function inv(overrides: Partial<NormalizedInvoice> = {}): NormalizedInvoice {
  return {
    invoiceNumber: "INV-1",
    date: new Date("2026-01-01"),
    vendor: "Acme Pvt Ltd",
    vendorGstin: "27AABCT1234H2Z0",
    customerName: null,
    customerGstin: null,
    subtotal: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    discount: 0,
    total: 0,
    items: [],
    ...overrides,
  };
}

const itemLine = (price: number, gstRate: number | null = null) => ({
  item: { name: "Widget", qty: 1, rate: price, price, hsnCode: null, gstRate },
  ledger: { id: "L_PURCH", name: "Purchase Accounts", confidence: 0.9, via: "DEFAULT" as const },
});

describe("buildVoucher — balance invariant", () => {
  it("intrastate purchase (CGST+SGST) balances and uses party credit", () => {
    const v = buildVoucher(
      inv({ subtotal: 100000, cgst: 9000, sgst: 9000, total: 118000, items: [itemLine(100000).item] }),
      baseResolved({ itemLedgers: [itemLine(100000)] }),
      "PURCHASE"
    );
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
    expect(v.totalDebit).toBeCloseTo(118000, 2);
    const party = v.lines.find((l) => l.role === "PARTY")!;
    expect(party.credit).toBeCloseTo(118000, 2); // purchase: party credited
    expect(v.lines.some((l) => l.role === "CGST" && l.debit === 9000)).toBe(true);
    expect(v.lines.some((l) => l.role === "SGST" && l.debit === 9000)).toBe(true);
    expect(v.lines.some((l) => l.role === "IGST")).toBe(false);
    expect(v.hasUnmapped).toBe(false);
  });

  it("interstate purchase (IGST) emits a single IGST line, no CGST/SGST", () => {
    const v = buildVoucher(
      inv({ subtotal: 100000, igst: 18000, total: 118000, items: [itemLine(100000).item] }),
      baseResolved({ itemLedgers: [itemLine(100000)] }),
      "PURCHASE"
    );
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
    expect(v.lines.filter((l) => l.role === "IGST")).toHaveLength(1);
    expect(v.lines.some((l) => l.role === "CGST" || l.role === "SGST")).toBe(false);
  });

  it("sale voucher debits the party and credits sales+tax", () => {
    const v = buildVoucher(
      inv({ subtotal: 100000, cgst: 9000, sgst: 9000, total: 118000, items: [itemLine(100000).item] }),
      baseResolved({
        party: { id: "L_DEB", name: "Sundry Debtors", confidence: 1, via: "RULE" },
        itemLedgers: [
          { item: itemLine(100000).item, ledger: { id: "L_SALE", name: "Sales Accounts", confidence: 0.9, via: "DEFAULT" } },
        ],
      }),
      "SALE"
    );
    const party = v.lines.find((l) => l.role === "PARTY")!;
    expect(party.debit).toBeCloseTo(118000, 2); // sale: party debited
    expect(v.lines.find((l) => l.role === "CGST")!.credit).toBeCloseTo(9000, 2);
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
  });

  it("missing tax: item + party only, still balances", () => {
    const v = buildVoucher(
      inv({ subtotal: 5000, total: 5000, items: [itemLine(5000).item] }),
      baseResolved({ itemLedgers: [itemLine(5000)] }),
      "PURCHASE"
    );
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
    expect(v.lines.some((l) => ["CGST", "SGST", "IGST"].includes(l.role))).toBe(false);
  });

  it("rounding residual is absorbed by a Round Off line and balances exactly", () => {
    // items + tax sum to 117999.50 but total is 118000 -> 0.50 round off
    const v = buildVoucher(
      inv({ subtotal: 99999.5, cgst: 9000, sgst: 9000, total: 118000, items: [itemLine(99999.5).item] }),
      baseResolved({ itemLedgers: [itemLine(99999.5)] }),
      "PURCHASE"
    );
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
    const ro = v.lines.find((l) => l.role === "ROUND_OFF");
    expect(ro).toBeDefined();
    expect(Math.abs(v.roundOff)).toBeGreaterThan(0);
  });

  it("multi-rate items: per-item lines preserved, header tax consolidated, balances", () => {
    const i1 = itemLine(10000, 18);
    const i2 = { item: { name: "B", qty: 1, rate: 5000, price: 5000, hsnCode: null, gstRate: 5 }, ledger: i1.ledger };
    const v = buildVoucher(
      inv({ subtotal: 15000, cgst: 1170, sgst: 1170, total: 17340, items: [i1.item, i2.item] }),
      baseResolved({ itemLedgers: [i1, i2] }),
      "PURCHASE"
    );
    expect(v.lines.filter((l) => l.role === "ITEM")).toHaveLength(2);
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
  });

  it("unmapped party flags hasUnmapped but still balances", () => {
    const v = buildVoucher(
      inv({ subtotal: 5000, total: 5000, items: [itemLine(5000).item] }),
      baseResolved({ party: null, itemLedgers: [itemLine(5000)] }),
      "PURCHASE"
    );
    expect(v.hasUnmapped).toBe(true);
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
    const party = v.lines.find((l) => l.role === "PARTY")!;
    expect(party.ledgerId).toBeNull();
  });

  it("no line items: synthesizes a net item line from subtotal - discount", () => {
    const v = buildVoucher(
      inv({ subtotal: 1000, discount: 100, cgst: 81, sgst: 81, total: 1062, items: [] }),
      baseResolved({
        itemLedgers: [
          { item: { name: "net", qty: 1, rate: 900, price: 900, hsnCode: null, gstRate: null }, ledger: { id: "L_PURCH", name: "Purchase Accounts", confidence: 0.5, via: "DEFAULT" } },
        ],
      }),
      "PURCHASE"
    );
    expect(v.lines.some((l) => l.role === "ITEM")).toBe(true);
    expect(v.totalDebit).toBeCloseTo(v.totalCredit, 2);
  });
});
