import { prisma } from "@/lib/prisma";
import { traceAsync } from "@/lib/trace";

/**
 * Every client at once, ranked by what needs attention.
 *
 * The rest of the app is scoped to whichever client is in the switcher, which
 * is right for doing the work and wrong for deciding what work to do. A firm
 * with forty clients had no way to answer the question they actually open the
 * app with on a Monday: *where is something stuck?* They would have to switch
 * client, read the dashboard, switch, read, forty times — so in practice they
 * would not, and a rejected push would sit until someone noticed at filing
 * time.
 *
 * One round trip for the whole portfolio, for the reason described in
 * `dashboardStats.ts`: on the Supabase pooler a Promise.all of per-client
 * queries does not overlap, so forty clients would be forty serial round trips
 * of ~160ms each.
 */

export interface PortfolioRow {
  clientId: string;
  clientName: string;
  gstin: string | null;
  /** The Tally company this client posts into, if one is bound. */
  tallyCompany: string | null;

  /** Waiting for a human: drafts, and drafts that need review specifically. */
  draftCount: number;
  needsReviewCount: number;
  /** Approved and waiting for a push. */
  readyCount: number;

  /** Tally said no. */
  failedCount: number;
  /** A connector took it and never reported back. See DashboardStats. */
  stuckCount: number;
  postedCount: number;

  /** Most recent voucher we know reached Tally. */
  lastSyncedAt: Date | null;
  /** Masters created here that Tally has not been given yet. */
  unsyncedMasters: number;
}

/**
 * How loudly a row should be shouting.
 *
 * Ordered by consequence, not by count. A rejected voucher is wrong books
 * right now; a voucher stuck sending may be wrong books and we cannot tell,
 * which is worse than knowing; work merely waiting is not a problem at all,
 * it is the job. Sorting on a total would let forty harmless drafts outrank
 * one rejection, which is exactly backwards.
 */
export function attentionRank(r: PortfolioRow): number {
  if (r.failedCount > 0) return 0;
  if (r.stuckCount > 0) return 1;
  if (r.unsyncedMasters > 0 && r.readyCount > 0) return 2;
  if (r.readyCount > 0) return 3;
  if (r.needsReviewCount > 0) return 4;
  return 5;
}

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
