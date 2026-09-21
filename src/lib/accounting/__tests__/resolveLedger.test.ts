import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { rankParty, rankItem, similarity, resolveLedgersForInvoice } from "../resolveLedger";
import type { PartyRankContext, ItemRankContext } from "../resolveLedger";
import type { NormalizedInvoice, VoucherType } from "../types";

const emptyCtx = (): PartyRankContext => ({
  rules: [],
  gstinMemory: {},
  nameMemory: {},
  fuzzyCandidates: [],
});

describe("rankParty — priority ladder", () => {
  it("exact GSTIN rule wins over everything", () => {
    const ctx = emptyCtx();
    ctx.rules = [
      { ruleType: "GSTIN_EQUALS", pattern: "27AABCT1234H2Z0", ledgerId: "RULE_L", ledgerName: "Rule Ledger", priority: 10 },
    ];
    ctx.gstinMemory = { "27AABCT1234H2Z0": { ledgerId: "MEM_L", ledgerName: "Mem", hitCount: 5 } };
    const r = rankParty("27AABCT1234H2Z0", "acme", ctx);
    expect(r?.id).toBe("RULE_L");
    expect(r?.via).toBe("RULE");
    expect(r?.confidence).toBe(1);
  });

  it("GSTIN memory beats name memory", () => {
    const ctx = emptyCtx();
    ctx.gstinMemory = { GSTIN1: { ledgerId: "G_L", ledgerName: "G", hitCount: 1 } };
    ctx.nameMemory = { acme: { ledgerId: "N_L", ledgerName: "N", hitCount: 9 } };
    const r = rankParty("GSTIN1", "acme", ctx);
    expect(r?.id).toBe("G_L");
    expect(r?.via).toBe("GSTIN_MEMORY");
  });

  it("name memory used when no GSTIN", () => {
    const ctx = emptyCtx();
    ctx.nameMemory = { acme: { ledgerId: "N_L", ledgerName: "N", hitCount: 1 } };
    const r = rankParty(null, "acme", ctx);
    expect(r?.via).toBe("NAME_MEMORY");
  });

  it("fuzzy match for close names above threshold", () => {
    const ctx = emptyCtx();
    ctx.fuzzyCandidates = [{ id: "F_L", name: "Acme Traders", norm: "acme traders", hitCount: 3 }];
    const r = rankParty(null, "acme trader", ctx); // near-identical
    expect(r?.via).toBe("FUZZY");
    expect(r?.id).toBe("F_L");
  });

  it("returns null (unmapped) when nothing matches", () => {
    const r = rankParty("XYZ", "totally different vendor", emptyCtx());
    expect(r).toBeNull();
  });
});

describe("rankItem", () => {
  const baseItemCtx = (): ItemRankContext => ({
    hsnRules: [],
    rateLedgers: {},
    defaultLedger: { id: "DEF", name: "Purchase Accounts" },
  });

  it("HSN rule wins", () => {
    const ctx = baseItemCtx();
    ctx.hsnRules = [{ ruleType: "HSN_EQUALS", pattern: "7225", ledgerId: "HSN_L", ledgerName: "Steel", priority: 1 }];
    const r = rankItem({ name: "Steel", qty: 1, rate: 1, price: 1, hsnCode: "7225", gstRate: 18 }, ctx);
    expect(r?.id).toBe("HSN_L");
    expect(r?.confidence).toBe(1);
  });

  it("rate-specific ledger used when gstRate matches", () => {
    const ctx = baseItemCtx();
    ctx.rateLedgers = { 18: { id: "R18", name: "Purchase - GST 18%" } };
    const r = rankItem({ name: "x", qty: 1, rate: 1, price: 1, hsnCode: null, gstRate: 18 }, ctx);
    expect(r?.id).toBe("R18");
  });

  it("falls back to generic default", () => {
    const r = rankItem({ name: "x", qty: 1, rate: 1, price: 1, hsnCode: null, gstRate: null }, baseItemCtx());
    expect(r?.id).toBe("DEF");
    expect(r?.via).toBe("DEFAULT");
  });
});

describe("similarity", () => {
  it("identical strings -> 1", () => expect(similarity("acme", "acme")).toBe(1));
  it("disjoint strings -> low", () => expect(similarity("abc", "xyz")).toBeLessThan(0.2));
  it("near matches -> high", () => expect(similarity("acme traders", "acme trader")).toBeGreaterThan(0.85));
});

// ---------------------------------------------------------------------------
// resolveLedgersForInvoice — which side of the books a voucher type belongs to
// ---------------------------------------------------------------------------

/**
 * Both halves of every system pair, so a wrong answer picks a real ledger
 * rather than falling through to null and looking like a mapping gap.
 */
const SIDED_LEDGERS = [
  { id: "CGST_IN", name: "CGST Input", ledgerType: "TAX_INPUT" as const, gstRate: null },
  { id: "SGST_IN", name: "SGST Input", ledgerType: "TAX_INPUT" as const, gstRate: null },
  { id: "IGST_IN", name: "IGST Input", ledgerType: "TAX_INPUT" as const, gstRate: null },
  { id: "CGST_OUT", name: "CGST Output", ledgerType: "TAX_OUTPUT" as const, gstRate: null },
  { id: "SGST_OUT", name: "SGST Output", ledgerType: "TAX_OUTPUT" as const, gstRate: null },
  { id: "IGST_OUT", name: "IGST Output", ledgerType: "TAX_OUTPUT" as const, gstRate: null },
  { id: "DISC_RECV", name: "Discount Received", ledgerType: "INCOME" as const, gstRate: null },
  { id: "DISC_ALLOW", name: "Discount Allowed", ledgerType: "EXPENSE" as const, gstRate: null },
  { id: "PUR", name: "Purchase Accounts", ledgerType: "PURCHASE" as const, gstRate: null },
  { id: "SAL", name: "Sales Accounts", ledgerType: "SALE" as const, gstRate: null },
  { id: "RO", name: "Round Off", ledgerType: "ROUND_OFF" as const, gstRate: null },
];

/** Only the three reads `resolveLedgersForInvoice` makes. */
const fakePrisma = () =>
  ({
    ledger: { findMany: async () => SIDED_LEDGERS },
    ledgerMapping: { findMany: async () => [] },
    mappingRule: { findMany: async () => [] },
  }) as unknown as PrismaClient;

const invoice = (): NormalizedInvoice => ({
  invoiceNumber: "RET-1",
  date: new Date("2026-03-07"),
  vendor: "Acme Traders",
  vendorGstin: null,
  customerName: null,
  customerGstin: null,
  subtotal: 1000,
  cgst: 90,
  sgst: 90,
  igst: 0,
  discount: 0,
  total: 1180,
  items: [{ name: "Widget", qty: 1, rate: 1000, price: 1000, hsnCode: null, gstRate: null }],
});

const resolveFor = (voucherType: VoucherType) =>
  resolveLedgersForInvoice(fakePrisma(), "u1", invoice(), voucherType, "c1");

describe("resolveLedgersForInvoice — credit and debit notes are not mirror images", () => {
  /**
   * A DEBIT_NOTE is a purchase return: the buyer raises it against a bill they
   * received, so it unwinds Input GST on the purchase side. Resolving it as a
   * sale — which is what `voucherType === "PURCHASE"` alone did — files every
   * purchase return into the client's sales figures and their Output GST, and
   * nothing says so until GSTR-1 disagrees with the books. The sheet wizard
   * maps PURCHASE_RETURN -> DEBIT_NOTE, so this is the common case, not a
   * corner one.
   */
  it("DEBIT_NOTE (purchase return) resolves Input GST and purchase-side ledgers", async () => {
    const r = await resolveFor("DEBIT_NOTE");
    expect(r.cgstLedgerName).toBe("CGST Input");
    expect(r.sgstLedgerName).toBe("SGST Input");
    expect(r.igstLedgerName).toBe("IGST Input");
    expect(r.discountLedgerName).toBe("Discount Received");
    expect(r.itemLedgers[0].ledger?.id).toBe("PUR");
  });

  /** A CREDIT_NOTE is a sales return: the seller's own invoice, reversed. */
  it("CREDIT_NOTE (sales return) resolves Output GST and sales-side ledgers", async () => {
    const r = await resolveFor("CREDIT_NOTE");
    expect(r.cgstLedgerName).toBe("CGST Output");
    expect(r.sgstLedgerName).toBe("SGST Output");
    expect(r.igstLedgerName).toBe("IGST Output");
    expect(r.discountLedgerName).toBe("Discount Allowed");
    expect(r.itemLedgers[0].ledger?.id).toBe("SAL");
  });

  it("PURCHASE stays on the input side and SALE on the output side", async () => {
    const purchase = await resolveFor("PURCHASE");
    expect(purchase.cgstLedgerName).toBe("CGST Input");
    expect(purchase.itemLedgers[0].ledger?.id).toBe("PUR");

    const sale = await resolveFor("SALE");
    expect(sale.cgstLedgerName).toBe("CGST Output");
    expect(sale.itemLedgers[0].ledger?.id).toBe("SAL");
  });

  it("a DEBIT_NOTE and a PURCHASE resolve to the same ledgers throughout", async () => {
    // The pair that must never drift: they are the same accounting side, and
    // `buildVoucher` puts the party on opposite sides of them. That direction
    // difference is deliberate and lives there, not here.
    const dn = await resolveFor("DEBIT_NOTE");
    const pur = await resolveFor("PURCHASE");
    expect({ ...dn, itemLedgers: [] }).toEqual({ ...pur, itemLedgers: [] });
  });
});
