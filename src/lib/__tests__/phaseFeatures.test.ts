import { describe, it, expect } from "vitest";
import { parseGst2bPayload, reconcileGst2b } from "../gst/reconcile";
import { classifyBankTxn, narrationKey } from "../bank/classify";
import { validateInvoiceGstExtended, detectDuplicateKey } from "../gst/validate";
import { detectDocumentType } from "../docs/detectType";

describe("GSTR-2B reconcile", () => {
  it("matches invoice number + GSTIN", () => {
    const rows = parseGst2bPayload({
      docdata: {
        b2b: [
          {
            ctin: "27AABCT1234H1Z0",
            trdnm: "Acme",
            inv: [{ inum: "INV-1", idt: "01/06/2026", txval: 1000, camt: 90, samt: 90, iamt: 0 }],
          },
        ],
      },
    });
    expect(rows).toHaveLength(1);

    const results = reconcileGst2b(rows, [
      {
        id: "i1",
        vendor: "Acme",
        vendorGstin: "27AABCT1234H1Z0",
        invoiceNumber: "INV-1",
        date: new Date(),
        subtotal: 1000,
        taxAmount: 180,
        cgst: 90,
        sgst: 90,
        igst: 0,
        totalAmount: 1180,
      },
    ]);
    expect(results.some((r) => r.status === "MATCHED")).toBe(true);
  });

  it("flags missing in books", () => {
    const rows = parseGst2bPayload([
      { ctin: "27AABCT1234H1Z0", inum: "X-1", txval: 100, camt: 9, samt: 9, iamt: 0 },
    ]);
    const results = reconcileGst2b(rows, []);
    expect(results[0].status).toBe("MISSING_IN_BOOKS");
  });
});

describe("bank classify", () => {
  it("classifies withdrawal as PAYMENT", () => {
    expect(classifyBankTxn({ description: "UPI to vendor", withdrawal: 500, deposit: 0 }).classification).toBe(
      "PAYMENT"
    );
  });
  it("classifies deposit as RECEIPT", () => {
    expect(classifyBankTxn({ description: "NEFT from customer", withdrawal: 0, deposit: 1000 }).classification).toBe(
      "RECEIPT"
    );
  });
  it("detects CONTRA", () => {
    expect(classifyBankTxn({ description: "ATM WDL SELF", withdrawal: 2000, deposit: 0 }).classification).toBe(
      "CONTRA"
    );
  });
  it("builds narration key", () => {
    expect(narrationKey("UPI/1234567890/ACME TRADERS")).toContain("acme");
  });
});

describe("gst validate + duplicates", () => {
  it("flags IGST on intra-state", () => {
    const v = validateInvoiceGstExtended({
      vendorGstin: "27AABCT1234H1Z0",
      customerGstin: "27AAAAA0000A1Z5",
      igst: 100,
      cgst: 0,
      sgst: 0,
    });
    expect(v.issues.some((i) => i.code === "IGST_ON_INTRASTATE")).toBe(true);
    expect(v.checkCount).toBeGreaterThan(0);
  });

  it("builds duplicate key", () => {
    const a = detectDuplicateKey({ invoiceNumber: "INV 1", vendorGstin: "27X", totalAmount: 10.5 });
    const b = detectDuplicateKey({ invoiceNumber: "INV1", vendorGstin: "27X", totalAmount: 10.5 });
    expect(a).toBe(b);
  });

  it("flags invalid GSTIN checksum", () => {
    const v = validateInvoiceGstExtended({
      vendorGstin: "99AABCT1234H1Z0",
      customerGstin: "27AAAAA0000A1Z5",
    });
    expect(v.issues.some((i) => i.code === "VENDOR_GSTIN_INVALID")).toBe(true);
  });
});

describe("doc type detect", () => {
  it("detects bank from filename", () => {
    expect(detectDocumentType({ fileName: "hdfc-bank-statement.pdf" })).toBe("bank");
  });
  it("detects credit note", () => {
    expect(detectDocumentType({ fileName: "vendor_credit_note.pdf" })).toBe("credit_note");
  });
});
