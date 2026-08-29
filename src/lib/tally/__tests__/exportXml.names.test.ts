import { describe, it, expect } from "vitest";
import { buildTallyXml } from "../exportXml";

/**
 * Tally matches ledgers and companies by exact string, and the Vyapar TaxOne
 * docs list "Extra space in the name of ledgers or company name" as a leading
 * cause of failed imports. Whitespace is invisible in the UI, so these lock in
 * that the exporter never emits a padded identifier.
 */

const ledger = (name: string, group = "SUNDRY_CREDITORS") => ({ name, group });

const voucher = (overrides: Record<string, unknown> = {}) => ({
  id: "v1",
  voucherType: "PURCHASE",
  date: new Date("2026-03-07"),
  invoiceNumber: "INV-1",
  lines: [
    { ledgerName: "Purchase - GST 18%", role: "ITEM", debit: 1000, credit: 0 },
    { ledgerName: "Acme Pvt Ltd", role: "PARTY", debit: 0, credit: 1000 },
  ],
  ...overrides,
});

describe("buildTallyXml — whitespace in identifiers", () => {
  it("trims a padded ledger master name", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [ledger("  Acme Pvt Ltd  ")],
      vouchers: [],
    });
    expect(xml).toContain('<LEDGER NAME="Acme Pvt Ltd"');
    expect(xml).toContain("<NAME>Acme Pvt Ltd</NAME>");
    expect(xml).not.toContain("Acme Pvt Ltd  <");
  });

  it("trims the ledger name on a voucher line", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [
        voucher({
          lines: [
            { ledgerName: " Purchase ", role: "ITEM", debit: 100, credit: 0 },
            { ledgerName: "Acme", role: "PARTY", debit: 0, credit: 100 },
          ],
        }),
      ],
    });
    expect(xml).toContain("<LEDGERNAME>Purchase</LEDGERNAME>");
  });

  it("trims the company name", () => {
    const xml = buildTallyXml({
      companyName: "  Tata Steel Ltd ",
      ledgers: [],
      vouchers: [],
    });
    expect(xml).toContain("<SVCURRENTCOMPANY>Tata Steel Ltd</SVCURRENTCOMPANY>");
  });

  it("collapses a padded and unpadded ledger into a single master", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [ledger("Acme Pvt Ltd"), ledger("Acme Pvt Ltd  ")],
      vouchers: [],
    });
    expect(xml.match(/<LEDGER NAME="Acme Pvt Ltd"/g)).toHaveLength(1);
  });

  it("falls back to the voucher id when the invoice number is only whitespace", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [voucher({ id: "abcdef12-3456", invoiceNumber: "   " })],
    });
    // Blank voucher numbers are rejected by Tally outright.
    expect(xml).toContain("<VOUCHERNUMBER>RAO-abcdef12</VOUCHERNUMBER>");
    expect(xml).not.toContain("<VOUCHERNUMBER></VOUCHERNUMBER>");
  });
});

describe("buildTallyXml — bill-wise allocation", () => {
  it("turns bill-wise on for party groups and off elsewhere", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [ledger("Acme", "SUNDRY_CREDITORS"), ledger("Rent", "INDIRECT_EXPENSES")],
      vouchers: [],
    });
    const acme = xml.slice(xml.indexOf('<LEDGER NAME="Acme"'));
    const rent = xml.slice(xml.indexOf('<LEDGER NAME="Rent"'));
    expect(acme.slice(0, 400)).toContain("<ISBILLWISEON>Yes</ISBILLWISEON>");
    expect(rent.slice(0, 400)).toContain("<ISBILLWISEON>No</ISBILLWISEON>");
  });

  it("allocates the party line against the invoice number", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [voucher({ invoiceNumber: "INV-42" })],
    });
    expect(xml).toContain("<BILLALLOCATIONS.LIST>");
    expect(xml).toContain("<NAME>INV-42</NAME>");
    expect(xml).toContain("<BILLTYPE>New Ref</BILLTYPE>");
  });

  it("matches the allocation amount to the ledger entry amount, sign included", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [
        voucher({
          lines: [
            { ledgerName: "Purchase", role: "ITEM", debit: 1180, credit: 0 },
            { ledgerName: "Acme", role: "PARTY", debit: 0, credit: 1180 },
          ],
        }),
      ],
    });
    const alloc = xml.slice(xml.indexOf("<BILLALLOCATIONS.LIST>"));
    // Credit entries carry a positive amount; the allocation must agree or
    // Tally rejects the voucher.
    expect(alloc).toContain("<AMOUNT>1180.00</AMOUNT>");
  });

  it("does not allocate non-party lines", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [
        voucher({
          lines: [{ ledgerName: "Purchase", role: "ITEM", debit: 100, credit: 0 }],
        }),
      ],
    });
    expect(xml).not.toContain("<BILLALLOCATIONS.LIST>");
  });
});

describe("buildTallyXml — GST details", () => {
  it("splits a combined rate across Central and State, full on Integrated", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [
        { name: "Purchase - GST 18%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 18 },
      ],
      vouchers: [],
    });
    expect(xml).toContain("<GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD>");
    expect(xml).toMatch(/Central Tax<\/GSTRATEDUTYHEAD>[\s\S]*?<GSTRATE>9<\/GSTRATE>/);
    expect(xml).toMatch(/Integrated Tax<\/GSTRATEDUTYHEAD>[\s\S]*?<GSTRATE>18<\/GSTRATE>/);
  });

  it("tags tax ledgers with the right GST duty head", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [
        { name: "CGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT" },
        { name: "IGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT" },
      ],
      vouchers: [],
    });
    expect(xml).toContain("<GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>");
    expect(xml).toContain("<GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>");
    expect(xml).toContain("<TAXTYPE>GST</TAXTYPE>");
  });

  it("omits GST blocks entirely when the flag is off", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [
        { name: "Purchase - GST 18%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 18 },
      ],
      vouchers: [],
      includeGstDetails: false,
    });
    expect(xml).not.toContain("GSTDETAILS.LIST");
  });
});
