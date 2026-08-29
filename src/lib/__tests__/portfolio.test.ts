import { describe, it, expect } from "vitest";
import { attentionRank, type PortfolioRow } from "../portfolio";

const row = (o: Partial<PortfolioRow> = {}): PortfolioRow => ({
  clientId: "c1",
  clientName: "Acme",
  gstin: null,
  tallyCompany: "ACME",
  draftCount: 0,
  needsReviewCount: 0,
  readyCount: 0,
  failedCount: 0,
  stuckCount: 0,
  postedCount: 0,
  lastSyncedAt: null,
  unsyncedMasters: 0,
  ...o,
});

/**
 * The ordering is a product judgement, so it is worth pinning rather than
 * leaving to whoever next edits the function.
 *
 * Ranked by consequence, not by volume: a rejected voucher is wrong books
 * right now, a stuck one may be wrong books and we cannot tell, and work
 * merely waiting is not a problem at all — it is the job.
 */
describe("attentionRank", () => {
  it("puts a rejection above everything else", () => {
    expect(attentionRank(row({ failedCount: 1 }))).toBeLessThan(
      attentionRank(row({ stuckCount: 99 }))
    );
  });

  it("puts stuck above merely waiting, because we cannot tell what happened", () => {
    expect(attentionRank(row({ stuckCount: 1 }))).toBeLessThan(
      attentionRank(row({ readyCount: 500 }))
    );
  });

  /**
   * The case that would otherwise fail silently at push time: vouchers approved
   * and ready, but masters they name are not in Tally yet. Ranked above plain
   * "ready" so it is dealt with before someone presses push and collects a
   * `Ledger 'X' does not exist!` for every one of them.
   */
  it("flags ready-but-missing-masters above plain ready", () => {
    expect(attentionRank(row({ readyCount: 5, unsyncedMasters: 3 }))).toBeLessThan(
      attentionRank(row({ readyCount: 5 }))
    );
  });

  it("does not flag missing masters when there is nothing to push", () => {
    expect(attentionRank(row({ unsyncedMasters: 3 }))).toBe(attentionRank(row()));
  });

  it("ranks review work above nothing, and a quiet client last", () => {
    expect(attentionRank(row({ needsReviewCount: 1 }))).toBeLessThan(attentionRank(row()));
    expect(attentionRank(row())).toBe(5);
  });

  /** Volume must never outrank consequence. */
  it("a thousand drafts do not outrank one rejection", () => {
    expect(attentionRank(row({ failedCount: 1 }))).toBeLessThan(
      attentionRank(row({ draftCount: 1000, needsReviewCount: 1000 }))
    );
  });
});
