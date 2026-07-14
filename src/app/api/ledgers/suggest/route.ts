import { NextResponse } from "next/server";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";
import { normGstin, normName } from "@/lib/accounting/normalize";
import {
  rankParty,
  similarity,
  type FuzzyCandidate,
  type MemoryEntry,
  type RankRule,
} from "@/lib/accounting/resolveLedger";

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const { vendor, vendorGstin } = (await req.json()) as {
      vendor?: string | null;
      vendorGstin?: string | null;
    };

    const keyName = normName(vendor ?? "");
    const keyGstin = normGstin(vendorGstin ?? "");
    if (!keyName && !keyGstin) {
      return NextResponse.json({ match: null });
    }

    const [ledgers, mappings, rules] = await Promise.all([
      prisma.ledger.findMany({
        where: { userId: user.id, clientId: client.id, ledgerType: "PARTY" },
        select: { id: true, name: true },
      }),
      prisma.ledgerMapping.findMany({
        where: { userId: user.id, clientId: client.id },
        select: {
          matchType: true,
          matchKey: true,
          hitCount: true,
          ledger: { select: { id: true, name: true } },
        },
      }),
      prisma.mappingRule.findMany({
        where: { userId: user.id, clientId: client.id, enabled: true },
        orderBy: { priority: "asc" },
        select: {
          ruleType: true,
          pattern: true,
          priority: true,
          ledger: { select: { id: true, name: true } },
        },
      }),
    ]);

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
      else if (m.matchType === "VENDOR_NAME") {
        nameMemory[m.matchKey] = entry;
        fuzzyCandidates.push({
          id: m.ledger.id,
          name: m.ledger.name,
          norm: m.matchKey,
          hitCount: m.hitCount,
        });
      }
    }
    for (const l of ledgers) {
      const n = normName(l.name);
      if (n) fuzzyCandidates.push({ id: l.id, name: l.name, norm: n, hitCount: 0 });
    }

    const partyRules: RankRule[] = rules
      .filter((r) => r.ruleType !== "HSN_EQUALS")
      .map((r) => ({
        ruleType: r.ruleType,
        pattern: r.pattern,
        ledgerId: r.ledger.id,
        ledgerName: r.ledger.name,
        priority: r.priority,
      }));

    const party = rankParty(keyGstin || null, keyName || null, {
      rules: partyRules,
      gstinMemory,
      nameMemory,
      fuzzyCandidates,
    });

    let match:
      | { ledgerId: string; ledgerName: string; via: string; confidence: number }
      | null = null;

    if (party && party.via !== "DEFAULT") {
      match = {
        ledgerId: party.id,
        ledgerName: party.name,
        via: party.via,
        confidence: party.confidence,
      };
    } else if (keyName) {
      // Lenient "similar party" fallback — POPUP ONLY.
      // The auto-mapper (rankParty) stays conservative (0.72 bar) so it never
      // silently mis-maps. But this popup is a human confirmation (reuse vs
      // create new), so we use a lower bar plus a token-subset heuristic to
      // catch near-duplicates like "Suhani" vs "Suhani Rao" that Dice scores
      // just under the auto-map threshold.
      const tokens = (s: string) => s.split(" ").filter(Boolean);
      const nameTokens = tokens(keyName);
      let best: { c: FuzzyCandidate; score: number } | null = null;
      for (const c of fuzzyCandidates) {
        if (c.norm === keyName) continue; // exact hit already handled by memory
        const score = similarity(keyName, c.norm);
        const cTokens = tokens(c.norm);
        const shorter = nameTokens.length <= cTokens.length ? nameTokens : cTokens;
        const longer = shorter === nameTokens ? cTokens : nameTokens;
        // one name's tokens fully contained in the other, sharing the first token
        const subset =
          shorter.length > 0 &&
          shorter[0] === longer[0] &&
          shorter.every((t) => longer.includes(t));
        const effective = subset ? Math.max(score, 0.75) : score;
        if (!best || effective > best.score) best = { c, score: effective };
      }
      if (best && best.score >= 0.7) {
        match = {
          ledgerId: best.c.id,
          ledgerName: best.c.name,
          via: "FUZZY",
          confidence: best.score,
        };
      }
    }

    if (!match) return NextResponse.json({ match: null });
    return NextResponse.json({ match });
  } catch (error) {
    console.error("[LEDGER_SUGGEST_ERROR]", error);
    return NextResponse.json({ match: null });
  }
}
