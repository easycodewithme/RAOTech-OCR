import type { PrismaClient } from "@prisma/client";
import type { MatchKeyType, NormalizedInvoice } from "./types";
import { normName } from "./normalize";

/** Upsert one memory row, re-pointing to the chosen ledger and bumping hitCount. */
async function upsertOne(
  prisma: PrismaClient,
  userId: string,
  matchType: MatchKeyType,
  matchKey: string,
  ledgerId: string
) {
  await prisma.ledgerMapping.upsert({
    where: {
      userId_clientId_matchType_matchKey: {
        userId,
        clientId: "",
        matchType,
        matchKey,
      },
    },
    create: { userId, clientId: "", matchType, matchKey, ledgerId, hitCount: 1 },
    update: { ledgerId, hitCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/**
 * Remember the party→ledger choice so future invoices from the same vendor
 * auto-map. Writes a GSTIN row (when a GSTIN is present) and always a
 * VENDOR_NAME row, so no-GSTIN invoices from the same vendor still resolve.
 */
export async function rememberMapping(
  prisma: PrismaClient,
  userId: string,
  inv: Pick<NormalizedInvoice, "vendor" | "vendorGstin">,
  ledgerId: string
): Promise<void> {
  if (!ledgerId) return;
  if (inv.vendorGstin) {
    await upsertOne(prisma, userId, "GSTIN", inv.vendorGstin, ledgerId);
  }
  const nameKey = normName(inv.vendor);
  if (nameKey) {
    await upsertOne(prisma, userId, "VENDOR_NAME", nameKey, ledgerId);
  }
}
