import { prisma } from "@/lib/prisma";
import { traceAsync } from "@/lib/trace";
import { PortfolioRow, attentionRank } from "./portfolioTypes";

export type { PortfolioRow };
export { attentionRank };

export async function getPortfolio(userId: string): Promise<PortfolioRow[]> {
  const rows = await traceAsync("portfolio", "query", () => prisma.$queryRaw<PortfolioRow[]>`
    SELECT
      c.id                                          AS "clientId",
      c.name                                        AS "clientName",
      c.gstin                                       AS "gstin",
      tc."companyName"                              AS "tallyCompany",

      (SELECT COUNT(*)::int FROM "Voucher" v
        WHERE v."clientId" = c.id AND v.status = 'DRAFT')          AS "draftCount",

      (SELECT COUNT(*)::int FROM "Voucher" v
        WHERE v."clientId" = c.id AND v.status = 'DRAFT'
          AND (v."avgConfidence" < 0.7 OR EXISTS (
            SELECT 1 FROM "VoucherLine" l
            WHERE l."voucherId" = v.id AND l."ledgerId" IS NULL
          )))                                                      AS "needsReviewCount",

      (SELECT COUNT(*)::int FROM "Voucher" v
        WHERE v."clientId" = c.id AND v.status = 'APPROVED')       AS "readyCount",

      (SELECT COUNT(*)::int FROM "VoucherSync" vs
        JOIN "Voucher" v ON v.id = vs."voucherId"
        WHERE v."clientId" = c.id AND vs.state = 'FAILED')         AS "failedCount",

      (SELECT COUNT(*)::int FROM "VoucherSync" vs
        JOIN "Voucher" v ON v.id = vs."voucherId"
        WHERE v."clientId" = c.id AND vs.state = 'SENDING'
          AND vs."lastAttemptAt" < NOW() - INTERVAL '10 minutes')  AS "stuckCount",

      (SELECT COUNT(*)::int FROM "VoucherSync" vs
        JOIN "Voucher" v ON v.id = vs."voucherId"
        WHERE v."clientId" = c.id AND vs.state = 'POSTED')         AS "postedCount",

      (SELECT MAX(vs."syncedAt") FROM "VoucherSync" vs
        JOIN "Voucher" v ON v.id = vs."voucherId"
        WHERE v."clientId" = c.id AND vs.state = 'POSTED')         AS "lastSyncedAt",

      (
        (SELECT COUNT(*)::int FROM "Ledger" l
          WHERE l."clientId" = c.id AND l."tallyGuid" IS NULL
            AND l."tallyReserved" = false)
        +
        (SELECT COUNT(*)::int FROM "StockItem" si
          WHERE si."clientId" = c.id AND si."tallySyncedAt" IS NULL)
      )                                                            AS "unsyncedMasters"

    FROM "Client" c
    LEFT JOIN "TallyCompany" tc ON tc."clientId" = c.id
    WHERE c."userId" = ${userId}
    ORDER BY c.name ASC
  `, { userId });

  // Ranked here rather than in SQL: the ordering is a product judgement about
  // which problem matters most, and it belongs somewhere a person can read it.
  return rows.sort(
    (a, b) => attentionRank(a) - attentionRank(b) || a.clientName.localeCompare(b.clientName)
  );
}
