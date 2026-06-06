import { describe, it, expect } from "vitest";
import { rankParty, rankItem, similarity } from "../resolveLedger";
import type { PartyRankContext, ItemRankContext } from "../resolveLedger";

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
