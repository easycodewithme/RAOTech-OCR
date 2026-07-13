import { NextResponse } from "next/server";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";
import { normGstin, normName } from "@/lib/accounting/normalize";
import {
  rankParty,
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

    if (!party || party.via === "DEFAULT") {
      return NextResponse.json({ match: null });
    }

    return NextResponse.json({
      match: {
        ledgerId: party.id,
        ledgerName: party.name,
        via: party.via,
        confidence: party.confidence,
      },
    });
  } catch (error) {
    console.error("[LEDGER_SUGGEST_ERROR]", error);
    return NextResponse.json({ match: null });
  }
}
