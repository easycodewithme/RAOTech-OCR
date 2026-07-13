import type { PrismaClient } from "@prisma/client";
import type { MatchKeyType, NormalizedInvoice } from "./types";
import { normName } from "./normalize";

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

export async function rememberNarrationMapping(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  narration: string,
  ledgerId: string
): Promise<void> {
  if (!ledgerId || !clientId) return;
  const key = normName(narration);
  if (!key) return;
  await upsertOne(prisma, userId, clientId, "NARRATION", key, ledgerId);
}
