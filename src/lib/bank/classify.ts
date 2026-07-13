import { normName } from "../accounting/normalize";

export type BankTxnClass = "PAYMENT" | "RECEIPT" | "CONTRA";

const CONTRA_KEYWORDS = [
  "self",
  "transfer",
  "neft own",
  "own a/c",
  "own account",
  "cash dep",
  "cash deposit",
  "atm wdl",
  "atm withdrawal",
  "to cash",
  "from cash",
  "imps self",
];

export function classifyBankTxn(opts: {
  description: string;
  withdrawal: number;
  deposit: number;
}): { classification: BankTxnClass; confidence: number } {
  const desc = (opts.description || "").toLowerCase();
  const isContra = CONTRA_KEYWORDS.some((k) => desc.includes(k));

  if (isContra) {
    return { classification: "CONTRA", confidence: 0.85 };
  }
  if ((opts.withdrawal || 0) > 0 && (opts.deposit || 0) === 0) {
    return { classification: "PAYMENT", confidence: 0.9 };
  }
  if ((opts.deposit || 0) > 0 && (opts.withdrawal || 0) === 0) {
    return { classification: "RECEIPT", confidence: 0.9 };
  }
  // ambiguous both sides
  if ((opts.deposit || 0) > (opts.withdrawal || 0)) {
    return { classification: "RECEIPT", confidence: 0.55 };
  }
  return { classification: "PAYMENT", confidence: 0.55 };
}

export function narrationKey(description: string): string {
  return (
    normName(
      description
        .replace(/\b\d{6,}\b/g, " ") // strip long refs
        .replace(/\b(upi|neft|imps|rtgs|ref|txn)\b/gi, " ")
    ) || ""
  );
}

export function suggestLedgerFromNarrationMemory(
  description: string,
  memory: Record<string, { ledgerId: string; ledgerName: string; hitCount: number }>
): { ledgerId: string; ledgerName: string; confidence: number; via: "NARRATION_MEMORY" } | null {
  const key = narrationKey(description);
  if (!key) return null;

  if (memory[key]) {
    const m = memory[key];
    return {
      ledgerId: m.ledgerId,
      ledgerName: m.ledgerName,
      confidence: Math.min(0.95, 0.7 + m.hitCount * 0.02),
      via: "NARRATION_MEMORY",
    };
  }

  // soft contains match
  let best: { ledgerId: string; ledgerName: string; hitCount: number; score: number } | null = null;
  for (const [mk, m] of Object.entries(memory)) {
    if (key.includes(mk) || mk.includes(key)) {
      const score = Math.min(mk.length, key.length) / Math.max(mk.length, key.length);
      if (!best || score > best.score) {
        best = { ...m, score };
      }
    }
  }
  if (best && best.score >= 0.6) {
    return {
      ledgerId: best.ledgerId,
      ledgerName: best.ledgerName,
      confidence: 0.55 + best.score * 0.2,
      via: "NARRATION_MEMORY",
    };
  }
  return null;
}
