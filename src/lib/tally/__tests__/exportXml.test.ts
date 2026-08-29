import { describe, it, expect } from "vitest";
import { buildTallyXml } from "../exportXml";

// Local-date constructor, not an ISO string — tallyDate() reads getFullYear/
// getMonth/getDate, so a UTC-parsed literal would shift a day in some zones.
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const ledger = (name: string, group: string, gstin: string | null = null) => ({
  name,
  group,
  gstin,
});

const voucher = (overrides: Partial<Parameters<typeof buildTallyXml>[0]["vouchers"][number]> = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  voucherType: "PURCHASE",
  date: D(2026, 1, 5),
  narration: null,
  partyName: "Acme Pvt Ltd",
  invoiceNumber: "INV-1",
  lines: [
    { ledgerName: "Purchase Accounts", debit: 1000, credit: 0 },
    { ledgerName: "CGST Input", debit: 90, credit: 0 },
    { ledgerName: "SGST Input", debit: 90, credit: 0 },
    { ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1180 },
  ],
  ...overrides,
});

describe("buildTallyXml — REMOTEID stability", () => {
  it("derives REMOTEID from the voucher id, not its position in the batch", () => {
    const xml = buildTallyXml({
      companyName: "Test Co",
      ledgers: [],
      vouchers: [voucher({ id: "aaa-111" })],
    });

    expect(xml).toContain('REMOTEID="RAO-aaa-111"');
  });

  it("gives a voucher the same REMOTEID regardless of batch position", () => {
    const a = voucher({ id: "aaa-111", invoiceNumber: "INV-A" });
    const b = voucher({ id: "bbb-222", invoiceNumber: "INV-B" });

    const forward = buildTallyXml({ companyName: "C", ledgers: [], vouchers: [a, b] });
    const reversed = buildTallyXml({ companyName: "C", ledgers: [], vouchers: [b, a] });

    // This is the whole point: re-exporting a different selection must not
    // renumber REMOTEIDs, or Tally treats a re-import as a brand new voucher
    // and duplicates it.
    for (const id of ["RAO-aaa-111", "RAO-bbb-222"]) {
      expect(forward).toContain(`REMOTEID="${id}"`);
      expect(reversed).toContain(`REMOTEID="${id}"`);
    }
  });

  it("produces byte-identical output for the same input", () => {
    const args = { companyName: "Test Co", ledgers: [ledger("Acme Pvt Ltd", "SUNDRY_CREDITORS")], vouchers: [voucher()] };
    expect(buildTallyXml(args)).toBe(buildTallyXml(args));
  });
});

describe("buildTallyXml — Tally sign convention", () => {
  it("emits debits as ISDEEMEDPOSITIVE Yes with a negative amount", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [voucher({ lines: [{ ledgerName: "Purchase Accounts", debit: 1000, credit: 0 }] })],
    });

    expect(xml).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");
    expect(xml).toContain("<AMOUNT>-1000.00</AMOUNT>");
  });

  it("emits credits as ISDEEMEDPOSITIVE No with a positive amount", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [voucher({ lines: [{ ledgerName: "Acme Pvt Ltd", debit: 0, credit: 1180 }] })],
    });

    expect(xml).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
    expect(xml).toContain("<AMOUNT>1180.00</AMOUNT>");
  });

  it("drops zero-value lines entirely", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [
        voucher({
          lines: [
            { ledgerName: "Purchase Accounts", debit: 1000, credit: 0 },
            { ledgerName: "Discount Received", debit: 0, credit: 0 },
          ],
        }),
      ],
    });

    expect(xml).not.toContain("Discount Received");
  });
});

describe("buildTallyXml — masters", () => {
  it("maps our enum groups onto Tally's group names", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [
        ledger("Acme Pvt Ltd", "SUNDRY_CREDITORS"),
        ledger("CGST Input", "DUTIES_AND_TAXES"),
        ledger("Purchase Accounts", "PURCHASE_ACCOUNTS"),
      ],
      vouchers: [],
    });

    expect(xml).toContain("<PARENT>Sundry Creditors</PARENT>");
    expect(xml).toContain("<PARENT>Duties &amp; Taxes</PARENT>");
    expect(xml).toContain("<PARENT>Purchase Accounts</PARENT>");
  });

  it("deduplicates ledgers by name", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [ledger("Acme Pvt Ltd", "SUNDRY_CREDITORS"), ledger("Acme Pvt Ltd", "SUNDRY_CREDITORS")],
      vouchers: [],
    });

    expect(xml.match(/<LEDGER NAME="Acme Pvt Ltd"/g)).toHaveLength(1);
  });

  it("emits PARTYGSTIN only when a GSTIN is present", () => {
    const withGstin = buildTallyXml({
      companyName: "C",
      ledgers: [ledger("Acme Pvt Ltd", "SUNDRY_CREDITORS", "27AABCT1234H2Z0")],
      vouchers: [],
    });
    const without = buildTallyXml({
      companyName: "C",
      ledgers: [ledger("Acme Pvt Ltd", "SUNDRY_CREDITORS")],
      vouchers: [],
    });

    expect(withGstin).toContain("<PARTYGSTIN>27AABCT1234H2Z0</PARTYGSTIN>");
    expect(without).not.toContain("PARTYGSTIN");
  });
});

describe("buildTallyXml — escaping and formatting", () => {
  it("escapes XML metacharacters in names that Tally legitimately allows", () => {
    const xml = buildTallyXml({
      companyName: 'Tata & Sons <"Holdings">',
      ledgers: [ledger("R&D Expenses", "INDIRECT_EXPENSES")],
      vouchers: [
        voucher({
          partyName: "A & B Co",
          narration: 'Bill for "widgets" <urgent>',
          lines: [{ ledgerName: "R&D Expenses", debit: 100, credit: 0 }],
        }),
      ],
    });

    expect(xml).toContain("<SVCURRENTCOMPANY>Tata &amp; Sons &lt;&quot;Holdings&quot;&gt;</SVCURRENTCOMPANY>");
    expect(xml).toContain("<LEDGERNAME>R&amp;D Expenses</LEDGERNAME>");
    expect(xml).toContain("Bill for &quot;widgets&quot; &lt;urgent&gt;");
    // A raw ampersand would make the document not well-formed.
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it("formats dates as YYYYMMDD with zero padding", () => {
    const xml = buildTallyXml({
      companyName: "C",
      ledgers: [],
      vouchers: [voucher({ date: D(2026, 3, 7) })],
    });

    expect(xml).toContain("<DATE>20260307</DATE>");
  });

  it("maps voucher types to Tally's names and falls back to Journal", () => {
    const sale = buildTallyXml({ companyName: "C", ledgers: [], vouchers: [voucher({ voucherType: "SALE" })] });
    const unknown = buildTallyXml({ companyName: "C", ledgers: [], vouchers: [voucher({ voucherType: "NONSENSE" })] });

    expect(sale).toContain("<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>");
    expect(unknown).toContain("<VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>");
  });

  it("builds a well-formed import envelope", () => {
    const xml = buildTallyXml({ companyName: "Test Co", ledgers: [], vouchers: [voucher()] });

    expect(xml.trimStart()).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(xml).toContain("<REPORTNAME>All Masters</REPORTNAME>");
    expect(xml).toContain("</ENVELOPE>");
  });
});
