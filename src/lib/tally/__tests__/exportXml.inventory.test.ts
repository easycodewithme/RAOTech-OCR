import { describe, it, expect } from "vitest";
import { buildTallyXml } from "../exportXml";

const voucher = (lines: Record<string, unknown>[]) => ({
  id: "v1",
  voucherType: "PURCHASE",
  date: new Date("2026-08-05"),
  narration: "test",
  invoiceNumber: "INV-1",
  partyName: "Acme Supplies",
  lines: lines as never,
});

const ITEM_LINE = {
  ledgerName: "Purchase A/c",
  role: "ITEM",
  debit: 1000,
  credit: 0,
  stockItemName: "Widget",
  quantity: 10,
  unit: "Nos",
  rate: 100,
};
const PARTY_LINE = { ledgerName: "Acme Supplies", role: "PARTY", debit: 0, credit: 1000 };

const count = (xml: string, tag: string) =>
  (xml.match(new RegExp(`<${tag}>`, "g")) ?? []).length;

describe("inventory allocations", () => {
  /**
   * The whole reason this code path exists as its own branch.
   *
   * An item line's accounting ledger belongs INSIDE its inventory entry. Emit
   * it there and also as a sibling ALLLEDGERENTRIES and Tally accepts the
   * voucher, the books still balance, and the purchase account is debited
   * twice. Nothing on our side would ever report that — the client just finds
   * their expenses doubled.
   */
  it("puts a stock line's ledger inside the inventory entry and nowhere else", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [voucher([ITEM_LINE, PARTY_LINE])],
    });

    expect(count(xml, "ALLINVENTORYENTRIES.LIST")).toBe(1);
    expect(count(xml, "ACCOUNTINGALLOCATIONS.LIST")).toBe(1);

    // The purchase ledger is named exactly once in the whole voucher.
    expect((xml.match(/Purchase A\/c/g) ?? [])).toHaveLength(1);

    // ...and that one mention is inside the inventory entry, not beside it.
    const inv = xml.slice(
      xml.indexOf("<ALLINVENTORYENTRIES.LIST>"),
      xml.indexOf("</ALLINVENTORYENTRIES.LIST>")
    );
    expect(inv).toContain("Purchase A/c");

    // The party is still an ordinary ledger entry.
    expect(count(xml, "ALLLEDGERENTRIES.LIST")).toBe(1);
  });

  it("keeps tax and round-off as ordinary ledger entries beside the stock", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [
        voucher([
          ITEM_LINE,
          { ledgerName: "CGST Input", role: "CGST", debit: 90, credit: 0 },
          { ledgerName: "SGST Input", role: "SGST", debit: 90, credit: 0 },
          { ledgerName: "Acme Supplies", role: "PARTY", debit: 0, credit: 1180 },
        ]),
      ],
    });
    expect(count(xml, "ALLINVENTORYENTRIES.LIST")).toBe(1);
    expect(count(xml, "ALLLEDGERENTRIES.LIST")).toBe(3);
  });

  /** Tally wants "10 Nos" and "100.00/Nos", not bare numbers. */
  it("writes quantity and rate the way Tally spells them", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [voucher([ITEM_LINE, PARTY_LINE])],
    });
    expect(xml).toContain("<ACTUALQTY>10 Nos</ACTUALQTY>");
    expect(xml).toContain("<BILLEDQTY>10 Nos</BILLEDQTY>");
    expect(xml).toContain("<RATE>100.00/Nos</RATE>");
  });

  it("posts a unitless item rather than blocking on a sheet that named no unit", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [
        voucher([
          { ...ITEM_LINE, unit: null, rate: null },
          PARTY_LINE,
        ]),
      ],
    });
    expect(xml).toContain("<ACTUALQTY>10</ACTUALQTY>");
    // Rate derived from the line total, so Tally does not display zero.
    expect(xml).toContain("<RATE>100.00</RATE>");
  });

  it("leaves a voucher with no stock lines byte-for-byte as it was", () => {
    const plain = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [
        voucher([
          { ledgerName: "Purchase A/c", role: "ITEM", debit: 1000, credit: 0 },
          PARTY_LINE,
        ]),
      ],
    });
    expect(plain).not.toContain("ALLINVENTORYENTRIES");
    expect(count(plain, "ALLLEDGERENTRIES.LIST")).toBe(2);
  });

  it("signs a credit-side stock line the other way", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [
        voucher([
          { ...ITEM_LINE, ledgerName: "Sales A/c", debit: 0, credit: 1000 },
          { ledgerName: "Acme Supplies", role: "PARTY", debit: 1000, credit: 0 },
        ]),
      ],
    });
    const inv = xml.slice(
      xml.indexOf("<ALLINVENTORYENTRIES.LIST>"),
      xml.indexOf("</ALLINVENTORYENTRIES.LIST>")
    );
    expect(inv).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
    expect(inv).toContain("<AMOUNT>1000.00</AMOUNT>");
  });
});

describe("stock item masters", () => {
  /**
   * Measured, and the reason there is no PARENT tag anywhere in this file: a
   * company that has never used inventory has no stock groups at all, so
   * `<PARENT>Primary</PARENT>` is rejected with "Stock Group 'Primary' does not
   * exist!" — and that rejection then poisons the item name for the rest of
   * Tally's session.
   */
  it("never names a stock group", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      stockItems: [{ name: "Widget", unit: "Nos" }],
      vouchers: [],
    });
    const item = xml.slice(xml.indexOf("<STOCKITEM"), xml.indexOf("</STOCKITEM>"));
    expect(item).not.toContain("<PARENT>");
  });

  /** Units first: an item naming a unit Tally lacks is rejected. */
  it("declares every unit before the items that use it", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      stockItems: [
        { name: "Widget", unit: "Nos" },
        { name: "Cable", unit: "Mtr" },
      ],
      vouchers: [],
    });
    expect(xml.indexOf("<UNIT ")).toBeLessThan(xml.indexOf("<STOCKITEM "));
    expect(xml).toContain(`<UNIT NAME="Nos"`);
    expect(xml).toContain(`<UNIT NAME="Mtr"`);
  });

  it("picks up units named only on a voucher line", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      vouchers: [voucher([{ ...ITEM_LINE, unit: "Kg" }, PARTY_LINE])],
    });
    expect(xml).toContain(`<UNIT NAME="Kg"`);
  });

  it("declares each unit and item once however often they are mentioned", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      stockItems: [
        { name: "Widget", unit: "Nos" },
        { name: "Widget ", unit: "Nos" },
        { name: "Gizmo", unit: "Nos" },
      ],
      vouchers: [voucher([ITEM_LINE, PARTY_LINE])],
    });
    expect((xml.match(/<UNIT NAME="Nos"/g) ?? [])).toHaveLength(1);
    expect((xml.match(/<STOCKITEM NAME="Widget"/g) ?? [])).toHaveLength(1);
  });

  it("carries HSN onto the master when GST details are on", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      stockItems: [{ name: "Widget", unit: "Nos", hsnCode: "84719000", gstRate: 18 }],
      vouchers: [],
    });
    expect(xml).toContain("<HSNCODE>84719000</HSNCODE>");
    expect(xml).toContain("<GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>");
  });

  it("omits the GST block entirely when GST details are off", () => {
    const xml = buildTallyXml({
      companyName: "TESTCO",
      ledgers: [],
      stockItems: [{ name: "Widget", unit: "Nos", hsnCode: "84719000", gstRate: 18 }],
      vouchers: [],
      includeGstDetails: false,
    });
    expect(xml).not.toContain("<HSNCODE>");
    expect(xml).not.toContain("<GSTAPPLICABLE>");
  });
});
