import { describe, it, expect } from "vitest";
import { buildVoucher } from "../buildVoucher";
import type { NormalizedInvoice, ResolvedLedgers, VoucherType } from "../types";

/**
 * SYNC-04: a credit or debit note has to knock off the invoice it reverses.
 *
 * Every voucher used to emit `New Ref`, which is right only for the document
 * that *opens* an outstanding. A credit note posted that way opens a second
 * reference beside the invoice it was cancelling: the original still shows 100%
 * outstanding in the client's ageing, with an unapplied credit sitting next to
 * it, and Tally will never bring the two together on its own.
 */

function resolved(overrides: Partial<ResolvedLedgers> = {}): ResolvedLedgers {
  return {
    party: { id: "L_PARTY", name: "Acme Pvt Ltd", confidence: 1, via: "RULE" },
    itemLedgers: [],
    cgstLedgerId: "L_CGST",
    sgstLedgerId: "L_SGST",
    igstLedgerId: "L_IGST",
    roundOffLedgerId: "L_RO",
    cgstLedgerName: "CGST Input",
    sgstLedgerName: "SGST Input",
    igstLedgerName: "IGST Input",
    roundOffLedgerName: "Round Off",
    ...overrides,
  };
}

function inv(overrides: Partial<NormalizedInvoice> = {}): NormalizedInvoice {
  return {
    invoiceNumber: "CN-7",
    date: new Date("2026-02-01"),
    vendor: "Acme Pvt Ltd",
    vendorGstin: "27AABCT1234H2Z0",
    customerName: null,
    customerGstin: null,
    subtotal: 1000,
    cgst: 0,
    sgst: 0,
    igst: 0,
    discount: 0,
    total: 1000,
    items: [],
    ...overrides,
  };
}

const partyLine = (i: NormalizedInvoice, t: VoucherType) =>
  buildVoucher(i, resolved(), t).lines.find((l) => l.role === "PARTY")!;

describe("buildVoucher — credit and debit notes allocate against the original", () => {
  it("a credit note naming its original emits Agst Ref against it", () => {
    const line = partyLine(inv({ againstInvoiceNumber: "INV-1" }), "CREDIT_NOTE");
    expect(line.billRefType).toBe("Agst Ref");
    // The invoice being reversed, not the credit note's own number. Naming the
    // credit note here is exactly the failure: it opens a second outstanding.
    expect(line.billRefName).toBe("INV-1");
  });

  it("a debit note naming its original does the same", () => {
    const line = partyLine(inv({ againstInvoiceNumber: "INV-42" }), "DEBIT_NOTE");
    expect(line.billRefType).toBe("Agst Ref");
    expect(line.billRefName).toBe("INV-42");
  });

  it("a credit note with no original falls back to New Ref and still posts", () => {
    // A return whose original nobody recorded must not be blocked. It simply
    // cannot be allocated — that is a data gap, not a reason to refuse the
    // voucher, and inventing a reference for it would be worse than either.
    const line = partyLine(inv(), "CREDIT_NOTE");
    expect(line.billRefType).toBe("New Ref");
    expect(line.billRefName).toBe("CN-7");
  });

  it("ignores a blank or whitespace-only original", () => {
    const line = partyLine(inv({ againstInvoiceNumber: "   " }), "CREDIT_NOTE");
    expect(line.billRefType).toBe("New Ref");
  });

  it("a purchase opens a New Ref named after itself, unchanged", () => {
    const line = partyLine(inv({ invoiceNumber: "INV-1" }), "PURCHASE");
    expect(line.billRefType).toBe("New Ref");
    expect(line.billRefName).toBe("INV-1");
  });

  it("a sale opens a New Ref too, and an original on a sale is ignored", () => {
    // `againstInvoiceNumber` only means anything on a return. A stray value on
    // an ordinary invoice must not silently turn it into a settlement.
    const line = partyLine(inv({ invoiceNumber: "INV-9", againstInvoiceNumber: "INV-1" }), "SALE");
    expect(line.billRefType).toBe("New Ref");
    expect(line.billRefName).toBe("INV-9");
  });

  it("leaves the bill reference null when the document has no number at all", () => {
    // Null, not a fabricated string: `exportXml` owns the RAO- fallback, and
    // deriving it twice in two places is how the two spellings drift apart and
    // a re-import opens a duplicate reference.
    const line = partyLine(inv({ invoiceNumber: null }), "PURCHASE");
    expect(line.billRefName).toBeNull();
  });

  it("allocates only the party line, never the item or tax lines", () => {
    // Tally rejects a BILLALLOCATIONS.LIST on a ledger it is not ageing.
    const draft = buildVoucher(
      inv({ subtotal: 1000, cgst: 90, sgst: 90, total: 1180 }),
      resolved(),
      "PURCHASE"
    );
    for (const l of draft.lines.filter((x) => x.role !== "PARTY")) {
      expect(l.billRefType ?? null).toBeNull();
      expect(l.billRefName ?? null).toBeNull();
    }
    expect(draft.totalDebit).toBeCloseTo(draft.totalCredit, 2);
  });

  it("the allocated amount is the party line's own amount, on its own side", () => {
    // The sign invariant, upstream of the XML: whatever Tally is told to
    // allocate has to be the amount on that very line.
    const cn = buildVoucher(
      inv({ subtotal: 236.5, total: 236.5, againstInvoiceNumber: "INV-1" }),
      resolved(),
      "CREDIT_NOTE"
    );
    const party = cn.lines.find((l) => l.role === "PARTY")!;
    expect(party.credit + party.debit).toBeCloseTo(236.5, 2);
    expect(cn.totalDebit).toBeCloseTo(cn.totalCredit, 2);
  });
});
