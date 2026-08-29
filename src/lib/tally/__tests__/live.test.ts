import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildTallyXml, buildTallyDeleteXml } from "../exportXml";
import { pushToTally, pingTally, gatewayUrl, type TallyGateway } from "../connector";
import { describeImportResult } from "../importResult";

/**
 * Live round trip against a real TallyPrime.
 *
 * Skipped unless TALLY_LIVE=1, so `npm test` stays offline and deterministic.
 * Everything else in this folder proves our XML is internally consistent. Only
 * this file can prove Tally accepts it — which nothing has ever done.
 *
 *   1. Install TallyPrime (the free educational mode is enough — see the date
 *      caveat below).
 *   2. Create a THROWAWAY company. These tests write real vouchers; never point
 *      them at books that matter.
 *   3. In Tally: F1 → Settings → Connectivity → Client/Server Configuration.
 *      Set "TallyPrime acts as" = Both, Enable ODBC = Yes, note the port.
 *   4. Leave that company open, then:
 *
 *      TALLY_LIVE=1 TALLY_COMPANY="RAO Test Co" npx vitest run live
 *
 * Optional: TALLY_HOST (default localhost), TALLY_PORT (default 9000),
 * TALLY_DATE (YYYY-MM-DD, default the 1st of the current month).
 *
 * Educational mode only accepts vouchers dated the 1st, 2nd, or last day of a
 * month — hence the default. A "date out of range" failure here is Tally's
 * licence talking, not our XML.
 */

const LIVE = process.env.TALLY_LIVE === "1";

const gateway: TallyGateway = {
  host: process.env.TALLY_HOST || "localhost",
  port: Number(process.env.TALLY_PORT || 9000),
  timeoutMs: 60_000,
};

const COMPANY = process.env.TALLY_COMPANY || "";

function defaultDate(): Date {
  if (process.env.TALLY_DATE) return new Date(process.env.TALLY_DATE);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

const DATE = defaultDate();

/** Ledgers the voucher tests post against, created in the same payload. */
const LEDGERS = [
  { name: "RAO Test Party", group: "SUNDRY_CREDITORS", ledgerType: "PARTY" },
  {
    name: "RAO Test Purchase",
    group: "PURCHASE_ACCOUNTS",
    ledgerType: "PURCHASE",
    gstRate: 18,
  },
];

/**
 * Every voucher this suite posts, so afterAll can take them out again.
 *
 * These tests write real entries into a real company. Left behind they
 * accumulate one set per run, and worse, they quietly change what a later run
 * is testing against — "altered" vs "created" counts stop meaning what the
 * assertions assume. Cleaning up is what keeps the suite repeatable.
 */
const posted: Array<{ id: string; voucherType: string }> = [];

function track(id: string): string {
  posted.push({ id, voucherType: "PURCHASE" });
  return id;
}

function voucher(id: string, invoiceNumber: string, amount = 1000) {
  return {
    id,
    voucherType: "PURCHASE",
    date: DATE,
    narration: "RAO AI live integration test",
    partyName: "RAO Test Party",
    invoiceNumber,
    lines: [
      { ledgerName: "RAO Test Purchase", role: "ITEM", debit: amount, credit: 0 },
      { ledgerName: "RAO Test Party", role: "PARTY", debit: 0, credit: amount },
    ],
  };
}

describe.skipIf(!LIVE)("LIVE: Tally round trip", () => {
  beforeAll(async () => {
    if (!COMPANY) {
      throw new Error(
        "TALLY_COMPANY must be set to the exact name of the open company in Tally."
      );
    }

    const ping = await pingTally(gateway);
    if (!ping.reachable) throw new Error(ping.message);

    // Tally answers happily with no company loaded, so reachability alone is
    // not enough — every import would then fail for a reason that looks like
    // ours. Probing for a loaded company is fiddlier than it sounds:
    //
    //   - "List of Companies" returns companies on *disk*, open or not.
    //   - CMPINFO's counters are not content counts. Measured against this very
    //     instance they read zero for a company that is open and has ledgers,
    //     and elsewhere reported 56 ledgers for a company holding 2. Anything
    //     built on them is a coin toss; an earlier version of this guard used
    //     the CMPINFO ledger count and blocked the whole suite with a false
    //     "no company is open".
    //
    // What is reliable is asking for the thing we actually need: a Ledger
    // collection scoped to the company. Masters come back only when that
    // company is loaded and addressable by the name we were given, which is
    // exactly the precondition every test below depends on.
    const probe = await fetch(gatewayUrl(gateway), {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body:
        "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>" +
        "<TYPE>Collection</TYPE><ID>RaoLiveProbe</ID></HEADER><BODY><DESC>" +
        `<STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY></STATICVARIABLES>` +
        '<TDL><TDLMESSAGE><COLLECTION NAME="RaoLiveProbe" ISMODIFY="No">' +
        "<TYPE>Ledger</TYPE><NATIVEMETHOD>Name</NATIVEMETHOD>" +
        "</COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>",
    }).then((r) => r.text());

    // Every Tally company has system masters (Cash, Profit & Loss A/c), so a
    // loaded company can never legitimately answer with none.
    if (!/<LEDGER[ >]/.test(probe)) {
      throw new Error(
        `Tally is reachable but company "${COMPANY}" is not open, or is open ` +
          "under a different name. Tally matches SVCURRENTCOMPANY exactly. " +
          "Open it in Tally (tally.exe itself, not just the gateway service) " +
          "and re-run."
      );
    }
  });

  it("is reachable on the configured host and port", async () => {
    const ping = await pingTally(gateway);
    // Fail loudly with the diagnostic rather than letting later tests time out.
    expect(ping.message).toBeTruthy();
    expect(ping.reachable).toBe(true);
  });

  it("accepts our ledger masters", async () => {
    const xml = buildTallyXml({
      companyName: COMPANY,
      ledgers: LEDGERS,
      vouchers: [],
    });
    const result = await pushToTally(xml, gateway);
    // Masters that already exist come back as altered or ignored, not created,
    // so this asserts the absence of rejection rather than a specific count.
    expect(result.lineErrors, describeImportResult(result)).toEqual([]);
    expect(result.errors).toBe(0);
    expect(result.exceptions).toBe(0);
  });

  it("accepts a balanced purchase voucher", async () => {
    const id = track(`live-${Date.now()}`);
    const xml = buildTallyXml({
      companyName: COMPANY,
      ledgers: LEDGERS,
      vouchers: [voucher(id, `LIVE-${id.slice(-6)}`)],
    });
    const result = await pushToTally(xml, gateway);
    expect(result.lineErrors, describeImportResult(result)).toEqual([]);
    expect(result.created + result.altered).toBeGreaterThan(0);
  });

  /**
   * The one that matters most.
   *
   * REMOTEID is how Tally recognises a re-import as the same voucher. Until
   * recently ours was derived from the voucher's position in the batch, so
   * exporting a different selection renumbered everything and Tally created
   * duplicates instead of updating. That bug is still live in production; this
   * is the test that proves the fix against a real instance.
   */
  it("alters an existing voucher on re-import instead of duplicating it", async () => {
    const id = track(`live-stable-${Date.now()}`);
    const build = (amount: number) =>
      buildTallyXml({
        companyName: COMPANY,
        ledgers: LEDGERS,
        vouchers: [voucher(id, `LIVE-STABLE`, amount)],
      });

    const first = await pushToTally(build(1000), gateway);
    expect(first.lineErrors, describeImportResult(first)).toEqual([]);
    expect(first.created).toBeGreaterThan(0);

    // Same voucher id, different amount, and crucially sent alongside a second
    // voucher so its position in the batch changes.
    const withNeighbour = buildTallyXml({
      companyName: COMPANY,
      ledgers: LEDGERS,
      vouchers: [
        voucher(track(`live-neighbour-${Date.now()}`), "LIVE-NEIGHBOUR", 500),
        voucher(id, "LIVE-STABLE", 2000),
      ],
    });

    const second = await pushToTally(withNeighbour, gateway);
    expect(second.lineErrors, describeImportResult(second)).toEqual([]);
    // The original must be updated, not created a second time.
    expect(second.altered).toBeGreaterThan(0);
  });

  it("reports a missing ledger as a line error we can read", async () => {
    const xml = buildTallyXml({
      companyName: COMPANY,
      ledgers: [], // deliberately omit the masters
      vouchers: [
        {
          id: track(`live-missing-${Date.now()}`),
          voucherType: "PURCHASE",
          date: DATE,
          invoiceNumber: "LIVE-MISSING",
          partyName: "RAO Nonexistent Ledger ZZZ",
          lines: [
            { ledgerName: "RAO Nonexistent Ledger ZZZ", role: "PARTY", debit: 0, credit: 100 },
            { ledgerName: "RAO Also Missing YYY", role: "ITEM", debit: 100, credit: 0 },
          ],
        },
      ],
    });
    const result = await pushToTally(xml, gateway);
    // Guard first: an unreachable Tally also produces ok:false plus a synthetic
    // line error, which would let this pass with no Tally at all.
    expect(result.raw, "Tally did not respond — this test proves nothing").not.toBe("");
    // Proves our parser reads Tally's real rejection text, not just fixtures.
    expect(result.ok).toBe(false);
    expect(
      result.lineErrors.length > 0 || result.errors > 0 || result.exceptions > 0
    ).toBe(true);
  });

  /**
   * Settles the open question recorded in tally-dev-docs/xml-interface.md:
   * our envelope uses the IMPORTDATA / REQUESTDESC variant, while Tally's
   * developer reference documents a TALLYREQUEST=Import + TYPE/ID header. If
   * this fails while the earlier tests pass, our variant is the problem.
   */
  afterAll(async () => {
    if (!posted.length) return;
    // Resolves purely by REMOTEID, so this can only reach vouchers this suite
    // created — never anything an accountant keyed in by hand. Vouchers that
    // were rejected rather than posted simply report "Voucher does not exist!",
    // which is the state we wanted anyway.
    const result = await pushToTally(
      buildTallyDeleteXml({ companyName: COMPANY, vouchers: posted }),
      gateway
    );
    console.log(
      `[live cleanup] removed ${result.deleted} of ${posted.length} test vouchers from ${COMPANY}`
    );
  });

  it("accepts our envelope variant at all", async () => {
    const xml = buildTallyXml({ companyName: COMPANY, ledgers: LEDGERS, vouchers: [] });
    expect(xml).toContain("<IMPORTDATA>");
    const result = await pushToTally(xml, gateway);
    expect(result.raw, "Tally did not respond — this test proves nothing").not.toBe("");
    expect(
      result.lineErrors.join(" "),
      "Tally rejected the envelope itself — try the documented TALLYREQUEST=Import variant"
    ).not.toMatch(/unrecognised response/i);
  });
});

describe.skipIf(LIVE)("LIVE suite is opt-in", () => {
  it("is skipped unless TALLY_LIVE=1", () => {
    expect(LIVE).toBe(false);
  });
});
