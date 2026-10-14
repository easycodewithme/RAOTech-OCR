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
