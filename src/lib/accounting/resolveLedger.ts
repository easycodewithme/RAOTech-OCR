import type { PrismaClient } from "@prisma/client";
import type {
  LedgerRef,
  LedgerType,
  NormalizedInvoice,
  NormalizedItem,
  ResolvedLedgers,
  VoucherType,
} from "./types";
import { normGstin, normKeyword, normName } from "./normalize";

// ---------------------------------------------------------------------------
// Pure similarity + rankers (no IO — unit-tested directly)
// ---------------------------------------------------------------------------

/** Sørensen–Dice coefficient over character bigrams. Returns 0..1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigrams(a);
  const mb = bigrams(b);
  let overlap = 0;
  for (const [g, count] of ma) {
    const other = mb.get(g) ?? 0;
    overlap += Math.min(count, other);
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

export interface RankRule {
  ruleType: "GSTIN_EQUALS" | "VENDOR_NAME_CONTAINS" | "VENDOR_NAME_EQUALS" | "HSN_EQUALS";
  pattern: string;
  ledgerId: string;
  ledgerName: string;
  priority: number;
}

export interface MemoryEntry {
  ledgerId: string;
  ledgerName: string;
  hitCount: number;
}

export interface FuzzyCandidate {
  id: string;
  name: string;
  norm: string;
  hitCount: number;
}

export interface PartyRankContext {
  rules: RankRule[]; // enabled rules (any type; only party-relevant ones used)
  gstinMemory: Record<string, MemoryEntry>;
  nameMemory: Record<string, MemoryEntry>;
  fuzzyCandidates: FuzzyCandidate[];
}

const ref = (
  id: string,
  name: string,
  confidence: number,
  via: LedgerRef["via"],
  needsReview = false
): LedgerRef => ({ id, name, confidence, via, needsReview });

/**
 * Resolve the party ledger by priority:
 * RULE → GSTIN memory → name memory → fuzzy → unmapped(null).
 * Pure: callers supply the candidate context.
 */
export function rankParty(
  keyGstin: string | null,
  keyName: string | null,
  ctx: PartyRankContext
): LedgerRef | null {
  // 1) Explicit rules, lowest priority number first
  const rules = [...ctx.rules].sort((a, b) => a.priority - b.priority);
  for (const r of rules) {
    if (r.ruleType === "GSTIN_EQUALS" && keyGstin && normGstin(r.pattern) === keyGstin) {
      return ref(r.ledgerId, r.ledgerName, 1.0, "RULE");
    }
    if (r.ruleType === "VENDOR_NAME_EQUALS" && keyName && normName(r.pattern) === keyName) {
      return ref(r.ledgerId, r.ledgerName, 0.98, "RULE");
    }
    if (
      r.ruleType === "VENDOR_NAME_CONTAINS" &&
      keyName &&
      r.pattern &&
      keyName.includes(normKeyword(r.pattern))
    ) {
      return ref(r.ledgerId, r.ledgerName, 0.95, "RULE");
    }
  }

  // 2) GSTIN memory (strong identity)
  if (keyGstin) {
    const m = ctx.gstinMemory[keyGstin];
    if (m) return ref(m.ledgerId, m.ledgerName, 0.92, "GSTIN_MEMORY");
  }

  // 3) Vendor-name memory (exact normalized)
  if (keyName) {
    const m = ctx.nameMemory[keyName];
    if (m) return ref(m.ledgerId, m.ledgerName, 0.85, "NAME_MEMORY");
  }

  // 4) Fuzzy name fallback
  if (keyName && ctx.fuzzyCandidates.length) {
    let best: FuzzyCandidate | null = null;
    let bestScore = 0;
    for (const c of ctx.fuzzyCandidates) {
      const score = similarity(keyName, c.norm);
      if (score > bestScore || (score === bestScore && best && c.hitCount > best.hitCount)) {
        best = c;
        bestScore = score;
      }
    }
    if (best && bestScore >= 0.86) {
      return ref(best.id, best.name, 0.6 + 0.3 * bestScore, "FUZZY");
    }
    if (best && bestScore >= 0.72) {
      return ref(best.id, best.name, 0.4 + 0.2 * (bestScore - 0.72) / 0.14, "FUZZY", true);
    }
  }

  // 5) Unmapped
  return null;
}

export interface ItemRankContext {
  hsnRules: RankRule[]; // HSN_EQUALS rules
  rateLedgers: Record<number, { id: string; name: string }>; // gstRate -> ledger
  defaultLedger: { id: string; name: string } | null;
}

/**
 * Resolve an item/expense ledger:
 * HSN rule → rate-specific seeded ledger → generic default. Items default to a
 * seeded ledger so they rarely block approval.
 */
export function rankItem(item: NormalizedItem, ctx: ItemRankContext): LedgerRef | null {
  // 1) HSN rule
  if (item.hsnCode) {
    const hsn = item.hsnCode.replace(/\s+/g, "");
    for (const r of [...ctx.hsnRules].sort((a, b) => a.priority - b.priority)) {
      if (r.ruleType === "HSN_EQUALS" && r.pattern.replace(/\s+/g, "") === hsn) {
        return ref(r.ledgerId, r.ledgerName, 1.0, "RULE");
      }
    }
  }
  // 2) Rate-specific seeded ledger
  if (item.gstRate != null && ctx.rateLedgers[item.gstRate]) {
    const l = ctx.rateLedgers[item.gstRate];
    return ref(l.id, l.name, 0.6, "DEFAULT");
  }
  // 3) Generic default
  if (ctx.defaultLedger) {
    return ref(ctx.defaultLedger.id, ctx.defaultLedger.name, 0.5, "DEFAULT");
  }
  return null;
}

// ---------------------------------------------------------------------------
// DB-backed resolver (loads candidates, then calls the pure rankers)
// ---------------------------------------------------------------------------

function findSystem(
  ledgers: Array<{ id: string; name: string; ledgerType: LedgerType; gstRate: number | null }>,
  predicate: (l: { name: string; ledgerType: LedgerType }) => boolean
) {
  return ledgers.find(predicate) ?? null;
}

/**
 * Load all candidate data for a user and resolve party + item ledgers for an
 * invoice. Returns ResolvedLedgers ready for buildVoucher.
 */
export async function resolveLedgersForInvoice(
  prisma: PrismaClient,
  userId: string,
  inv: NormalizedInvoice,
  voucherType: VoucherType
): Promise<ResolvedLedgers> {
  const [ledgers, mappings, rules] = await Promise.all([
    prisma.ledger.findMany({
      where: { userId, clientId: "" },
      select: { id: true, name: true, ledgerType: true, gstRate: true },
    }),
    prisma.ledgerMapping.findMany({
      where: { userId, clientId: "" },
      select: {
        matchType: true,
        matchKey: true,
        hitCount: true,
        ledger: { select: { id: true, name: true } },
      },
    }),
    prisma.mappingRule.findMany({
      where: { userId, clientId: "", enabled: true },
      orderBy: { priority: "asc" },
      select: {
        ruleType: true,
        pattern: true,
        priority: true,
        ledger: { select: { id: true, name: true } },
      },
    }),
  ]);

  const isPurchase = voucherType === "PURCHASE";

  // System ledgers
  const cgst = findSystem(ledgers, (l) =>
    isPurchase ? l.name === "CGST Input" : l.name === "CGST Output"
  );
  const sgst = findSystem(ledgers, (l) =>
    isPurchase ? l.name === "SGST Input" : l.name === "SGST Output"
  );
  const igst = findSystem(ledgers, (l) =>
    isPurchase ? l.name === "IGST Input" : l.name === "IGST Output"
  );
  const roundOff = findSystem(ledgers, (l) => l.ledgerType === "ROUND_OFF");
  const discount = findSystem(
    ledgers,
    (l) => l.name === (isPurchase ? "Discount Received" : "Discount Allowed")
  );

  // Item default + rate ledgers (purchase or sales side)
  const sideType: LedgerType = isPurchase ? "PURCHASE" : "SALE";
  const sideLedgers = ledgers.filter((l) => l.ledgerType === sideType);
  const defaultLedger =
    sideLedgers.find((l) => l.gstRate == null) ?? sideLedgers[0] ?? null;
  const rateLedgers: Record<number, { id: string; name: string }> = {};
  for (const l of sideLedgers) {
    if (l.gstRate != null) rateLedgers[l.gstRate] = { id: l.id, name: l.name };
  }

  // Build memory maps + fuzzy candidates
  const gstinMemory: Record<string, MemoryEntry> = {};
  const nameMemory: Record<string, MemoryEntry> = {};
  const fuzzyCandidates: FuzzyCandidate[] = [];
  for (const m of mappings) {
    const entry: MemoryEntry = {
      ledgerId: m.ledger.id,
      ledgerName: m.ledger.name,
      hitCount: m.hitCount,
    };
    if (m.matchType === "GSTIN") gstinMemory[m.matchKey] = entry;
    else {
      nameMemory[m.matchKey] = entry;
      fuzzyCandidates.push({
        id: m.ledger.id,
        name: m.ledger.name,
        norm: m.matchKey,
        hitCount: m.hitCount,
      });
    }
  }
  // Also let existing PARTY ledgers participate in fuzzy matching
  for (const l of ledgers) {
    if (l.ledgerType === "PARTY") {
      const n = normName(l.name);
      if (n) fuzzyCandidates.push({ id: l.id, name: l.name, norm: n, hitCount: 0 });
    }
  }

  const ruleAdapter = (r: (typeof rules)[number]): RankRule => ({
    ruleType: r.ruleType,
    pattern: r.pattern,
    ledgerId: r.ledger.id,
    ledgerName: r.ledger.name,
    priority: r.priority,
  });

  const party = rankParty(inv.vendorGstin, normName(inv.vendor), {
    rules: rules.filter((r) => r.ruleType !== "HSN_EQUALS").map(ruleAdapter),
    gstinMemory,
    nameMemory,
    fuzzyCandidates,
  });

  const itemCtx: ItemRankContext = {
    hsnRules: rules.filter((r) => r.ruleType === "HSN_EQUALS").map(ruleAdapter),
    rateLedgers,
    defaultLedger,
  };
  const itemLedgers = inv.items.map((item) => ({
    item,
    ledger: rankItem(item, itemCtx),
  }));

  return {
    party,
    itemLedgers,
    cgstLedgerId: cgst?.id ?? "",
    sgstLedgerId: sgst?.id ?? "",
    igstLedgerId: igst?.id ?? "",
    roundOffLedgerId: roundOff?.id ?? "",
    discountLedgerId: discount?.id ?? null,
    cgstLedgerName: cgst?.name,
    sgstLedgerName: sgst?.name,
    igstLedgerName: igst?.name,
    roundOffLedgerName: roundOff?.name,
    discountLedgerName: discount?.name,
  };
}
