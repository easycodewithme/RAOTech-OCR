import { describe, it, expect } from "vitest";
import {
  buildTallyXml,
  buildTallyDeleteXml,
  remoteIdFor,
} from "../exportXml";

/**
 * Deleting from Tally.
 *
 * The behaviour asserted here was measured against a live TallyPrime 7.1 on
 * 2026-08-25, not inferred: a body-less `ACTION="Delete"` carrying nothing but
 * the REMOTEID returned `deleted=1`, and the same envelope aimed at a REMOTEID
 * that was never posted returned `errors=1` with `Voucher does not exist!`.
 */
describe("remoteIdFor", () => {
  it("prefixes the voucher id", () => {
    expect(remoteIdFor("abc-123")).toBe("RAO-abc-123");
  });

  /**
   * The create path and the delete path must agree on the id, or a delete
   * silently misses and a re-post duplicates instead of altering. This is the
   * test that catches a prefix added in one place and not the other.
   */
  it("produces the same id the create envelope stamps", () => {
    const id = "11112222-3333-4444-5555-666677778888";
    const created = buildTallyXml({
      companyName: "RAOTECH",
      ledgers: [],
      vouchers: [
        {
          id,
          voucherType: "PURCHASE",
          date: new Date("2026-08-01T00:00:00"),
          invoiceNumber: "INV-1",
          partyName: "Acme",
          lines: [
            { ledgerName: "Purchase", role: "ITEM", debit: 100, credit: 0 },
            { ledgerName: "Acme", role: "PARTY", debit: 0, credit: 100 },
          ],
        },
      ],
    });
    const deleted = buildTallyDeleteXml({
      companyName: "RAOTECH",
      vouchers: [{ id, voucherType: "PURCHASE" }],
    });

    const idOf = (xml: string) => xml.match(/REMOTEID="([^"]+)"/)?.[1];
    expect(idOf(created)).toBe(remoteIdFor(id));
    expect(idOf(deleted)).toBe(idOf(created));
  });
});

describe("buildTallyDeleteXml", () => {
  const xml = buildTallyDeleteXml({
    companyName: "RAOTECH",
    vouchers: [
      { id: "aaa", voucherType: "PURCHASE" },
      { id: "bbb", voucherType: "SALE" },
    ],
  });

  it("targets the company it was given", () => {
    expect(xml).toContain("<SVCURRENTCOMPANY>RAOTECH</SVCURRENTCOMPANY>");
  });

  it('marks every voucher ACTION="Delete"', () => {
    expect(xml.match(/ACTION="Delete"/g)).toHaveLength(2);
    expect(xml).not.toContain('ACTION="Create"');
  });

  it("maps voucher types to Tally's own names", () => {
    expect(xml).toContain('VCHTYPE="Purchase"');
    expect(xml).toContain('VCHTYPE="Sales"');
  });

  /**
   * The point of the delete envelope. Tally resolves the target by REMOTEID
   * alone, so carrying no ledger entries is what lets a voucher be un-posted
   * after it has been edited here — a delete rebuilt from current data would
   * no longer describe what is actually sitting in Tally.
   */
  it("carries no ledger entries, dates or amounts", () => {
    expect(xml).not.toContain("ALLLEDGERENTRIES.LIST");
    expect(xml).not.toContain("<AMOUNT>");
    expect(xml).not.toContain("<DATE>");
  });

  it("escapes ids rather than interpolating them raw", () => {
    const hostile = buildTallyDeleteXml({
      companyName: 'Acme & Co "Ltd"',
      vouchers: [{ id: 'x"><FOO/>', voucherType: "PURCHASE" }],
    });
    expect(hostile).toContain("Acme &amp; Co &quot;Ltd&quot;");
    expect(hostile).not.toContain("<FOO/>");
  });

  it("produces a well-formed envelope for an empty selection", () => {
    const empty = buildTallyDeleteXml({ companyName: "RAOTECH", vouchers: [] });
    expect(empty).toContain("<REQUESTDATA>");
    expect(empty).not.toContain("<VOUCHER");
  });
});
