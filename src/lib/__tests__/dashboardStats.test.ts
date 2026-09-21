import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `getDashboardData` is one hand-written SQL statement against a live Postgres,
 * so there is nothing here to unit test except the statement itself — which is
 * exactly the thing that was wrong. "In Tally" counted `EXPORTED_DEMO`, a
 * status written the instant someone clicks Export XML, so a firm that
 * downloaded 400 vouchers and never ran the import in Tally was told all 400
 * were in their client's books.
 *
 * These assertions are therefore deliberately about the text of the query. They
 * are brittle to reformatting and that is accepted: the alternative is no guard
 * at all on the single number an accountant trusts most.
 */

const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

/** Rebuild the SQL the way Prisma's tagged template sees it: the static chunks
 *  with `$1`-style placeholders standing in for the interpolated values. */
function capturedSql(): string {
  expect(queryRaw).toHaveBeenCalledTimes(1);
  const [strings] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return strings.join("$?");
}

/** The `(SELECT …) AS "alias"` chunk, so one column can be read in isolation. */
function subqueryFor(alias: string): string {
  const sql = capturedSql();
  const end = sql.indexOf(`AS "${alias}"`);
  expect(end).toBeGreaterThan(-1);
  const start = sql.lastIndexOf("(SELECT", end);
  return sql.slice(start, end);
}

describe("getDashboardData", () => {
  beforeEach(async () => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ stats: {}, rows: [] }]);
    const { getDashboardData } = await import("@/lib/dashboardStats");
    await getDashboardData("user_1", "client_1");
  });

  it("counts 'in Tally' from VoucherSync, not from voucher status", () => {
    const posted = subqueryFor("postedCount");
    expect(posted).toContain('FROM "VoucherSync"');
    expect(posted).toContain("vs.state = 'POSTED'");
    expect(posted).not.toContain("EXPORTED_DEMO");
  });

  it("does not let a downloaded XML file count as posted", () => {
    // The regression itself: `status IN ('EXPORTED_DEMO', 'POSTED')`.
    expect(capturedSql()).not.toMatch(/IN\s*\(\s*'EXPORTED_DEMO'/);
  });

  it("keeps the merely-exported count, scoped to exported only", () => {
    const exported = subqueryFor("exportedCount");
    expect(exported).toContain("status = 'EXPORTED_DEMO'");
    expect(exported).not.toContain("POSTED");
  });

  it("reads posted the same way the rejected and stuck cards already do", () => {
    // All three are the honest source; if one ever drifts back onto Voucher
    // status the dashboard starts disagreeing with itself.
    for (const alias of ["postedCount", "syncFailedCount", "syncStuckCount"]) {
      expect(subqueryFor(alias)).toContain('FROM "VoucherSync" vs');
    }
  });

  it("still issues exactly one round trip", () => {
    // The whole file exists because a Promise.all of eight queries does not
    // overlap on the Supabase pooler. Adding a column must not become adding a
    // query.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
