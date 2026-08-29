import type { PrismaClient } from "@prisma/client";
import type { MatchKeyType, NormalizedInvoice } from "./types";
import { narrationKey, normName } from "./normalize";

async function upsertOne(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  matchType: MatchKeyType,
  matchKey: string,
  ledgerId: string
) {
  await prisma.ledgerMapping.upsert({
    where: {
      userId_clientId_matchType_matchKey: {
        userId,
        clientId,
        matchType,
        matchKey,
      },
    },
    create: { userId, clientId, matchType, matchKey, ledgerId, hitCount: 1 },
    update: { ledgerId, hitCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

export async function rememberMapping(
  prisma: PrismaClient,
  userId: string,
  inv: Pick<NormalizedInvoice, "vendor" | "vendorGstin">,
  ledgerId: string,
  clientId: string
): Promise<void> {
  if (!ledgerId || !clientId) return;
  if (inv.vendorGstin) {
    await upsertOne(prisma, userId, clientId, "GSTIN", inv.vendorGstin, ledgerId);
  }
  const nameKey = normName(inv.vendor);
  if (nameKey) {
    await upsertOne(prisma, userId, clientId, "VENDOR_NAME", nameKey, ledgerId);
  }
}

/**
 * Learn "this narration means this ledger".
 *
 * The key is `narrationKey`, not `normName`, and that is the entire fix: the
 * reader, `suggestLedgerFromNarrationMemory`, looks the memory up by
 * `narrationKey`, while this function wrote it under `normName`. Since
 * `narrationKey` additionally strips reference numbers and the UPI / NEFT /
 * IMPS / RTGS tokens, the two produce different strings for essentially every
 * real narration — so everything learned here went to a key nothing ever asked
 * for, and the feature looked like it simply never learned anything.
 */
export async function rememberNarrationMapping(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  narration: string,
  ledgerId: string
): Promise<void> {
  if (!ledgerId || !clientId) return;
  const key = narrationKey(narration);
  if (!key) return;
  await upsertOne(prisma, userId, clientId, "NARRATION", key, ledgerId);
}

/**
 * The same thing for a bulk save, deduplicated first.
 *
 * A save over a filtered selection is usually a hundred rows sharing one
 * narration shape. Upserting the same key a hundred times would multiply
 * `hitCount` — the confidence weight the suggester reads — by a hundred for
 * what was one human decision.
 */
export async function rememberNarrationMappings(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  entries: { narration: string; ledgerId: string }[]
): Promise<number> {
  if (!clientId) return 0;

  const byKey = new Map<string, string>();
  for (const e of entries) {
    if (!e.ledgerId) continue;
    const key = narrationKey(e.narration);
    if (key) byKey.set(key, e.ledgerId);
  }

  let written = 0;
  for (const [key, ledgerId] of byKey) {
    try {
      await upsertOne(prisma, userId, clientId, "NARRATION", key, ledgerId);
      written++;
    } catch {
      // Learning is a nicety. A save must not fail because of it.
    }
  }
  return written;
}
