import { prisma } from "@/lib/prisma";
import { traceAsync } from "@/lib/trace";

/**
 * The dashboard's headline numbers, fetched in a single round trip.
 *
 * The previous version issued eight Prisma calls inside one Promise.all. On the
 * Supabase pooler those do not actually overlap — measured 1345ms for the batch
 * versus 162ms for the equivalent hand-written SQL. With ~160ms of network
 * latency per round trip, collapsing the batch is worth more than any amount of
 * query tuning.
 *
 * Counts are cast to int and sums to float8 so Prisma hands back numbers rather
 * than BigInt/Decimal.
 */
export interface DashboardStats {
  invoiceCount: number;
  draftCount: number;
  approvedCount: number;
  exportedCount: number;
  /**
   * Vouchers Tally refused. The number this whole product exists to keep at
   * zero, and until now the only way to find it was to open Transactions and
   * tick a filter you would only think to tick if you already suspected
   * something was wrong.
   */
  syncFailedCount: number;
  /**
   * Vouchers a connector took and never reported back on.
   *
   * Not the same as failed, and more dangerous: SENDING means a device claimed
   * the job and we do not know what happened next. The voucher may be sitting
   * in the client's books already. It is also the state that strands a voucher
   * permanently if someone deletes the row while it is stuck, so it is worth a
   * number of its own rather than being folded into "failed".
   *
   * Only counted after a grace period — a push in flight is not a problem.
   */
  syncStuckCount: number;
  pendingReviewCount: number;
  unmappedParties: number;
  gstInput: number;
  gstOutput: number;
  itcAtRisk: number | null;
  reconMatched: number | null;
  reconMismatched: number | null;
}

export interface DashboardDraftRow {
  id: string;
  voucherType: string;
  totalDebit: number;
  avgConfidence: number | null;
  vendor: string | null;
  invoiceNumber: string | null;
  hasUnmapped: boolean;
}

interface RawResult {
  stats: DashboardStats;
  rows: DashboardDraftRow[];
}

export async function getDashboardData(
  userId: string,
  clientId: string
): Promise<RawResult> {
  const [result] = await traceAsync("dashboardStats", "query", () => prisma.$queryRaw<RawResult[]>`
    SELECT
      row_to_json(s) AS stats,
      (SELECT COALESCE(json_agg(r), '[]'::json) FROM (
        SELECT
          v.id,
          v."voucherType"                          AS "voucherType",
          v."totalDebit"                           AS "totalDebit",
          v."avgConfidence"                        AS "avgConfidence",
          i.vendor                                 AS vendor,
          i."invoiceNumber"                        AS "invoiceNumber",
          EXISTS (
            SELECT 1 FROM "VoucherLine" l
            WHERE l."voucherId" = v.id AND l."ledgerId" IS NULL
          )                                        AS "hasUnmapped"
        FROM "Voucher" v
        LEFT JOIN "Invoice" i ON i.id = v."invoiceId"
        WHERE v."userId" = ${userId} AND v."clientId" = ${clientId} AND v.status = 'DRAFT'
        ORDER BY v."createdAt" DESC
        LIMIT 20
      ) r) AS rows
    FROM (
      SELECT
        (SELECT COUNT(*)::int FROM "Invoice"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId}) AS "invoiceCount",
        (SELECT COUNT(*)::int FROM "Voucher"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId} AND status = 'DRAFT') AS "draftCount",
        (SELECT COUNT(*)::int FROM "Voucher"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId} AND status = 'APPROVED') AS "approvedCount",
        (SELECT COUNT(*)::int FROM "Voucher"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId}
            AND status IN ('EXPORTED_DEMO', 'POSTED')) AS "exportedCount",
        (SELECT COUNT(*)::int FROM "VoucherSync" vs
          JOIN "Voucher" v ON v.id = vs."voucherId"
          WHERE v."userId" = ${userId} AND v."clientId" = ${clientId}
            AND vs.state = 'FAILED') AS "syncFailedCount",
        (SELECT COUNT(*)::int FROM "VoucherSync" vs
          JOIN "Voucher" v ON v.id = vs."voucherId"
          WHERE v."userId" = ${userId} AND v."clientId" = ${clientId}
            AND vs.state = 'SENDING'
            AND vs."lastAttemptAt" < NOW() - INTERVAL '10 minutes') AS "syncStuckCount",
        (SELECT COUNT(*)::int FROM "Voucher" v
          WHERE v."userId" = ${userId} AND v."clientId" = ${clientId} AND v.status = 'DRAFT'
            AND (v."avgConfidence" < 0.7 OR EXISTS (
              SELECT 1 FROM "VoucherLine" l
              WHERE l."voucherId" = v.id AND l."ledgerId" IS NULL
            ))) AS "pendingReviewCount",
        (SELECT COUNT(*)::int FROM "VoucherLine" l
          JOIN "Voucher" v ON v.id = l."voucherId"
          WHERE l."ledgerId" IS NULL AND l.role = 'PARTY'
            AND v."userId" = ${userId} AND v."clientId" = ${clientId}
            AND v.status = 'DRAFT') AS "unmappedParties",
        (SELECT COALESCE(SUM(i."taxAmount"), 0)::float8 FROM "Invoice" i
          JOIN "Voucher" v ON v."invoiceId" = i.id
          WHERE v."userId" = ${userId} AND v."clientId" = ${clientId}
            AND v."voucherType" = 'PURCHASE') AS "gstInput",
        (SELECT COALESCE(SUM(i."taxAmount"), 0)::float8 FROM "Invoice" i
          JOIN "Voucher" v ON v."invoiceId" = i.id
          WHERE v."userId" = ${userId} AND v."clientId" = ${clientId}
            AND v."voucherType" = 'SALE') AS "gstOutput",
        (SELECT "itcAtRisk"::float8 FROM "Gst2bUpload"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId}
          ORDER BY "createdAt" DESC LIMIT 1) AS "itcAtRisk",
        (SELECT matched FROM "Gst2bUpload"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId}
          ORDER BY "createdAt" DESC LIMIT 1) AS "reconMatched",
        (SELECT mismatched FROM "Gst2bUpload"
          WHERE "userId" = ${userId} AND "clientId" = ${clientId}
          ORDER BY "createdAt" DESC LIMIT 1) AS "reconMismatched"
    ) s
  `, { userId, clientId });

  return result;
}
