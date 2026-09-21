import { describe, it, expect } from "vitest";
import { buildTallyXml } from "../exportXml";

/**
 * Bill allocations: what Tally uses to age an outstanding against the document
 * that created it.
 *
 * The rule this file pins down is that the *line* decides. The emitter used to
 * decide instead — role PARTY meant `New Ref`, always — which is correct only
 * for the document that opens an outstanding. A credit note emitted that way
 * opens a second reference beside the invoice it was cancelling, and a bank
 * payment never reached the branch at all and posted with no allocation, so
 * Tally parked it On Account and left the invoice fully outstanding.
 */

// Local-date constructor, not an ISO string — tallyDate() reads getFullYear/
// getMonth/getDate, so a UTC-parsed literal would shift a day in some zones.
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

const voucher = (
  overrides: Partial<Parameters<typeof buildTallyXml>[0]["vouchers"][number]> = {}
) => ({
  id: "11111111-2222-3333-4444-555555555555",
  voucherType: "PURCHASE",
  date: D(2026, 1, 5),
  narration: null,
  partyName: "Acme Pvt Ltd",
  invoiceNumber: "INV-1",
  lines: [
    { ledgerName: "Purchase Accounts", role: "ITEM", debit: 1000, credit: 0 },
    { ledgerName: "Acme Pvt Ltd", role: "PARTY", debit: 0, credit: 1000 },
  ],
  ...overrides,
});

const xmlFor = (v: Partial<Parameters<typeof buildTallyXml>[0]["vouchers"][number]>) =>
  buildTallyXml({ companyName: "C", ledgers: [], vouchers: [voucher(v)] });

/**
 * Every ledger entry in the envelope, paired with the allocation nested inside
 * it. The first `<AMOUNT>` in an entry is the entry's own; the one inside
 * `BILLALLOCATIONS.LIST` is the allocation's. Keeping them together is what
 * makes the sign invariant checkable in one place.
 */
function ledgerEntries(xml: string) {
  const out: Array<{
    ledger: string;
    amount: string;
    alloc: { name: string; type: string; amount: string } | null;
  }> = [];

  for (const [, body] of xml.matchAll(
    /<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/g
  )) {
    const ledger = /<LEDGERNAME>([\s\S]*?)<\/LEDGERNAME>/.exec(body)?.[1] ?? "";
    const amount = /<AMOUNT>([\s\S]*?)<\/AMOUNT>/.exec(body)?.[1] ?? "";
    const allocBody = /<BILLALLOCATIONS\.LIST>([\s\S]*?)<\/BILLALLOCATIONS\.LIST>/.exec(body)?.[1];
    out.push({
      ledger,
      amount,
      alloc: allocBody
        ? {
            name: /<NAME>([\s\S]*?)<\/NAME>/.exec(allocBody)?.[1] ?? "",
            type: /<BILLTYPE>([\s\S]*?)<\/BILLTYPE>/.exec(allocBody)?.[1] ?? "",
            amount: /<AMOUNT>([\s\S]*?)<\/AMOUNT>/.exec(allocBody)?.[1] ?? "",
          }
        : null,
    });
  }
  return out;
}

const partyOf = (xml: string) => ledgerEntries(xml).find((e) => e.ledger === "Acme Pvt Ltd")!;

describe("buildTallyXml — bill allocation defaults", () => {
  it("a PARTY line carrying no allocation still opens a New Ref named after the invoice", () => {
    // The behaviour every already-posted voucher relies on. A line built before
    // billRefType existed must keep posting exactly as it did.
    const alloc = partyOf(xmlFor({})).alloc!;
    expect(alloc.type).toBe("New Ref");
    expect(alloc.name).toBe("INV-1");
  });

  it("falls back to the stable RAO- reference when the document has no number", () => {
    const alloc = partyOf(xmlFor({ invoiceNumber: null })).alloc!;
    expect(alloc.type).toBe("New Ref");
    expect(alloc.name).toBe("RAO-11111111");
  });

  it("emits no allocation on a line that is neither PARTY nor asked for one", () => {
    // Tally rejects a BILLALLOCATIONS.LIST on a ledger it is not ageing, so
    // "no allocation" is the correct output here, not a missing feature.
    expect(ledgerEntries(xmlFor({})).find((e) => e.ledger === "Purchase Accounts")!.alloc).toBeNull();
  });
});

describe("buildTallyXml — the line decides", () => {
  it("emits Agst Ref against the named bill instead of opening a new one", () => {
    const xml = xmlFor({
      voucherType: "CREDIT_NOTE",
      invoiceNumber: "CN-7",
      lines: [
        { ledgerName: "Purchase Accounts", role: "ITEM", debit: 1000, credit: 0 },
        {
          ledgerName: "Acme Pvt Ltd",
          role: "PARTY",
          debit: 0,
          credit: 1000,
          billRefType: "Agst Ref",
          billRefName: "INV-1",
        },
      ],
    });

    const alloc = partyOf(xml).alloc!;
    expect(alloc.type).toBe("Agst Ref");
    // Named after the invoice being reversed, NOT after the credit note itself
    // — that is the difference between settling the bill and opening a second.
    expect(alloc.name).toBe("INV-1");
    expect(xml).not.toContain("<BILLTYPE>New Ref</BILLTYPE>");
  });

  it("On Account names no bill, because there is none", () => {
    const xml = xmlFor({
      voucherType: "PAYMENT",
      invoiceNumber: null,
      lines: [
        {
          ledgerName: "Acme Pvt Ltd",
          role: "PARTY",
          debit: 5000,
          credit: 0,
          billRefType: "On Account",
        },
        { ledgerName: "HDFC Current A/c", role: "BANK", debit: 0, credit: 5000 },
      ],
    });

    const alloc = partyOf(xml).alloc!;
    expect(alloc.type).toBe("On Account");
    // Emphatically not the RAO- fallback: putting a reference here would open a
    // brand new outstanding, which is the bug this whole change removes.
    expect(alloc.name).toBe("");
    expect(xml).not.toContain("RAO-11111111</NAME>");
  });

  it("an explicit reference beats the voucher's own number", () => {
    const alloc = partyOf(
      xmlFor({
        invoiceNumber: "CN-7",
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 0,
            credit: 1000,
            billRefType: "Agst Ref",
            billRefName: "INV-99",
          },
        ],
      })
    ).alloc!;
    expect(alloc.name).toBe("INV-99");
  });

  it("carries Advance through unchanged — the vocabulary is Tally's, not ours", () => {
    const alloc = partyOf(
      xmlFor({
        voucherType: "RECEIPT",
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 0,
            credit: 2500,
            billRefType: "Advance",
            billRefName: "ADV-1",
          },
        ],
      })
    ).alloc!;
    expect(alloc.type).toBe("Advance");
    expect(alloc.name).toBe("ADV-1");
  });

  it("escapes a bill reference containing XML metacharacters", () => {
    const alloc = partyOf(
      xmlFor({
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 0,
            credit: 1000,
            billRefType: "Agst Ref",
            billRefName: "INV/A&B<1>",
          },
        ],
      })
    ).alloc!;
    expect(alloc.name).toBe("INV/A&amp;B&lt;1&gt;");
  });
});

/**
 * The invariant the whole file hangs on: **the allocation amount must equal the
 * ledger entry amount exactly, sign included, or Tally rejects the voucher.**
 * It is asserted in every allocation shape rather than once, because the shapes
 * are the thing that changed.
 */
describe("buildTallyXml — allocation amount matches the ledger entry exactly", () => {
  const shapes: Array<[string, Parameters<typeof xmlFor>[0]]> = [
    ["default New Ref on a credited party (purchase)", {}],
    [
      "New Ref on a debited party (sale)",
      {
        voucherType: "SALE",
        lines: [
          { ledgerName: "Acme Pvt Ltd", role: "PARTY", debit: 1180, credit: 0 },
          { ledgerName: "Sales Accounts", role: "ITEM", debit: 0, credit: 1180 },
        ],
      },
    ],
    [
      "Agst Ref on a credit note",
      {
        voucherType: "CREDIT_NOTE",
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 0,
            credit: 236.5,
            billRefType: "Agst Ref",
            billRefName: "INV-1",
          },
        ],
      },
    ],
    [
      "Agst Ref on a debited party (supplier payment against a bill)",
      {
        voucherType: "PAYMENT",
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 5000,
            credit: 0,
            billRefType: "Agst Ref",
            billRefName: "INV-1",
          },
          { ledgerName: "HDFC Current A/c", role: "BANK", debit: 0, credit: 5000 },
        ],
      },
    ],
    [
      "On Account on a debited party (supplier payment, bill unknown)",
      {
        voucherType: "PAYMENT",
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 1234.56,
            credit: 0,
            billRefType: "On Account",
          },
          { ledgerName: "HDFC Current A/c", role: "BANK", debit: 0, credit: 1234.56 },
        ],
      },
    ],
    [
      "On Account on a credited party (customer receipt, bill unknown)",
      {
        voucherType: "RECEIPT",
        lines: [
          { ledgerName: "HDFC Current A/c", role: "BANK", debit: 990.05, credit: 0 },
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 0,
            credit: 990.05,
            billRefType: "On Account",
          },
        ],
      },
    ],
  ];

  for (const [label, v] of shapes) {
    it(label, () => {
      const entries = ledgerEntries(xmlFor(v)).filter((e) => e.alloc);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.alloc!.amount).toBe(e.amount);
      }
    });
  }

  it("keeps Tally's sign convention on both sides of the allocation", () => {
    // Debit => ISDEEMEDPOSITIVE Yes and a negative amount; credit is the
    // reverse. The allocation copies the entry's string, so it inherits both.
    const dr = partyOf(
      xmlFor({
        lines: [
          {
            ledgerName: "Acme Pvt Ltd",
            role: "PARTY",
            debit: 5000,
            credit: 0,
            billRefType: "Agst Ref",
            billRefName: "INV-1",
          },
        ],
      })
    );
    expect(dr.amount).toBe("-5000.00");
    expect(dr.alloc!.amount).toBe("-5000.00");

    const cr = partyOf(xmlFor({}));
    expect(cr.amount).toBe("1000.00");
    expect(cr.alloc!.amount).toBe("1000.00");
  });
});
