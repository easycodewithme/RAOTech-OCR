import { describe, it, expect } from "vitest";
import {
  suggestMapping,
  levenshtein,
  profileColumn,
  valueScore,
  scoreField,
  fieldsFor,
  FIELD_SYNONYMS,
  SUGGEST_FLOOR,
} from "../suggestMapping";
import { detectLayout } from "../detectLayout";
import type { CellValue } from "../types";

const MAHARASHTRA = "27AAPFU0939F1ZV";
const KARNATAKA = "29AABCT1234H1Z5";

const suggest = (
  headers: string[],
  rows: CellValue[][] = [],
  docType: Parameters<typeof suggestMapping>[2] = "SALE",
  itemMode: Parameters<typeof suggestMapping>[3] = "WITHOUT_ITEM"
) => suggestMapping(headers, detectLayout(headers), docType, itemMode, { sampleRows: rows });

// ---------------------------------------------------------------------------
// Header matching
// ---------------------------------------------------------------------------

describe("suggestMapping — header synonyms", () => {
  it("maps a plainly named sheet with no help at all", () => {
    const { mapping, fields } = suggest([
      "Invoice No",
      "Invoice Date",
      "Party Name",
      "GSTIN",
      "Taxable Value",
      "CGST",
      "SGST",
      "Invoice Total",
    ]);
    expect(mapping.fields.invoiceNumber).toBe(0);
    expect(mapping.fields.date).toBe(1);
    expect(mapping.fields.partyName).toBe(2);
    expect(mapping.fields.partyGstin).toBe(3);
    expect(mapping.fields.taxable).toBe(4);
    expect(mapping.fields.total).toBe(7);
    expect(fields.invoiceNumber.confidence).toBe(1);
  });

  it("does not care about case, punctuation or underscores", () => {
    const { mapping } = suggest(["INVOICE_NO.", "  invoice   date ", "Customer Name", "Grand Total"]);
    expect(mapping.fields.invoiceNumber).toBe(0);
    expect(mapping.fields.date).toBe(1);
    expect(mapping.fields.partyName).toBe(2);
    expect(mapping.fields.total).toBe(3);
  });

  it("tolerates a typo, which is the case their exact-text key cannot survive", () => {
    const { mapping, fields } = suggest(["Invioce No", "Dat", "Vendor Name", "Taxable"]);
    expect(mapping.fields.invoiceNumber).toBe(0);
    expect(fields.invoiceNumber.confidence).toBeLessThan(1);
    expect(fields.invoiceNumber.confidence).toBeGreaterThanOrEqual(SUGGEST_FLOOR);
    expect(mapping.fields.partyName).toBe(2);
  });

  it("recognises the vocabulary of the marketplace exports", () => {
    const { mapping } = suggest(
      ["order_date", "sub_order_num", "sup_name", "hsn_code", "tcs_taxable_amount", "quantity"],
      [],
      "SALE",
      "WITH_ITEM"
    );
    expect(mapping.fields.date).toBe(0);
    expect(mapping.fields.invoiceNumber).toBe(1);
    expect(mapping.fields.partyName).toBe(2);
    expect(mapping.fields.hsnCode).toBe(3);
    expect(mapping.fields.quantity).toBe(5);
  });

  it("gives one column to one field", () => {
    const { mapping } = suggest(["Particulars", "Date", "Amount"], [], "SALE", "WITH_ITEM");
    const taken = Object.values(mapping.fields).filter((v): v is number => v !== null);
    expect(new Set(taken).size).toBe(taken.length);
  });

  it("leaves a field unmapped rather than guessing badly", () => {
    const { mapping, fields } = suggest(["Col A", "Col B", "Col C"]);
    expect(mapping.fields.invoiceNumber).toBeNull();
    expect(fields.invoiceNumber.confidence).toBe(0);
    expect(fields.invoiceNumber.reason).toMatch(/No column/);
  });

  it("reports the columns it ignored", () => {
    const { unmappedColumns } = suggest(["Invoice No", "Date", "Party", "Taxable", "Salesman Code"]);
    expect(unmappedColumns).toContain(4);
  });
});

// ---------------------------------------------------------------------------
// Value shape — the part that removes "manually adjust the mapping"
// ---------------------------------------------------------------------------

describe("suggestMapping — scoring the cell values", () => {
  it("finds a GSTIN column whatever the header calls it", () => {
    const { mapping, fields } = suggest(
      ["Invoice No", "Date", "Party", "Tax ID", "Taxable"],
      [
        ["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000],
        ["INV-2", "06/08/2024", "Beta", KARNATAKA, 2000],
        ["INV-3", "07/08/2024", "Gamma", MAHARASHTRA, 3000],
      ]
    );
    expect(mapping.fields.partyGstin).toBe(3);
    expect(fields.partyGstin.reason).toMatch(/values look like this field/);
  });

  it("finds a date column called something else entirely", () => {
    const { mapping } = suggest(
      ["Ref", "Posted On", "Party", "Taxable"],
      [
        ["INV-1", "05/08/2024", "Acme", 1000],
        ["INV-2", "06/08/2024", "Beta", 2000],
        ["INV-3", "07/08/2024", "Gamma", 3000],
      ]
    );
    expect(mapping.fields.date).toBe(1);
  });

  it("demotes a column headed Date that holds no dates", () => {
    const { mapping, fields } = suggest(
      ["Invoice No", "Date", "Party", "Taxable"],
      [
        ["INV-1", "widget", "Acme", 1000],
        ["INV-2", "gizmo", "Beta", 2000],
        ["INV-3", "bolt", "Gamma", 3000],
      ]
    );
    expect(fields.date.confidence).toBeLessThan(SUGGEST_FLOOR);
    expect(mapping.fields.date).toBeNull();
  });

  it("lets the values corroborate a header match", () => {
    const withData = suggest(
      ["Invoice No", "Date", "Party", "GSTIN", "Taxable"],
      [["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000]]
    );
    expect(withData.fields.partyGstin.reason).toMatch(/values agree/);
  });
});

describe("profileColumn / valueScore", () => {
  it("recognises GSTINs", () => {
    const shape = profileColumn([MAHARASHTRA, KARNATAKA, null]);
    expect(shape.nonBlank).toBe(2);
    expect(valueScore("partyGstin", shape)).toBe(1);
  });

  it("does not read a quantity column as dates", () => {
    const shape = profileColumn([1, 2, 3, 42]);
    expect(valueScore("date", shape)).toBe(0);
  });

  it("reads an Excel serial column as dates", () => {
    const shape = profileColumn([45000, 45001, 45002]);
    expect(valueScore("date", shape)).toBe(1);
  });

  it("recognises HSN codes", () => {
    const shape = profileColumn(["0801", "998314", "62031200"]);
    expect(valueScore("hsnCode", shape)).toBe(1);
  });

  it("scores nothing for an empty column", () => {
    expect(valueScore("total", profileColumn([null, "", "NA"]))).toBe(0);
  });
});

describe("scoreField", () => {
  it("gives an exact synonym the top score", () => {
    expect(scoreField("invoiceNumber", "invoice no", profileColumn([])).score).toBe(1);
  });

  it("scores nothing when neither the header nor the data says anything", () => {
    expect(scoreField("total", "widget code", profileColumn(["a", "b"])).score).toBe(0);
  });
});

describe("levenshtein", () => {
  it("counts edits", () => {
    expect(levenshtein("invoice no", "invoice no")).toBe(0);
    expect(levenshtein("invioce no", "invoice no")).toBe(2);
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("gives up early once the cap is exceeded", () => {
    expect(levenshtein("completely different", "no", 2)).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Doc type and item mode
// ---------------------------------------------------------------------------

describe("suggestMapping — fields in play", () => {
  it("offers journal fields only to a journal", () => {
    expect(fieldsFor("JOURNAL", "WITHOUT_ITEM")).toContain("debit");
    expect(fieldsFor("SALE", "WITHOUT_ITEM")).not.toContain("debit");
  });

  it("offers item fields only in WITH_ITEM mode", () => {
    expect(fieldsFor("SALE", "WITH_ITEM")).toContain("itemName");
    expect(fieldsFor("SALE", "WITHOUT_ITEM")).not.toContain("itemName");
  });

  it("maps a journal sheet to ledger, debit and credit", () => {
    const { mapping } = suggest(
      ["Journal No", "Date", "Ledger Name", "Debit", "Credit", "Narration"],
      [],
      "JOURNAL"
    );
    expect(mapping.fields.ledgerName).toBe(2);
    expect(mapping.fields.debit).toBe(3);
    expect(mapping.fields.credit).toBe(4);
    expect(mapping.fields.narration).toBe(5);
    // A journal has no GST stage at all.
    expect(mapping.gst.cgst).toBeNull();
    expect(mapping.gst.rateGroups).toHaveLength(0);
  });

  it("does not map a Particulars column to an item name on a WITHOUT_ITEM sheet", () => {
    const { mapping } = suggest(["Invoice No", "Date", "Party", "Particulars", "Taxable"]);
    expect(mapping.fields.itemName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GST stage
// ---------------------------------------------------------------------------

describe("suggestMapping — the GST stage", () => {
  it("wires a LONG sheet's fixed tax columns", () => {
    const { mapping } = suggest([
      "Invoice No", "Date", "Party", "Taxable Value", "CGST", "SGST", "IGST", "Total",
    ]);
    expect(mapping.gst.taxLayout).toBe("LONG");
    expect(mapping.gst.cgst).toBe(4);
    expect(mapping.gst.sgst).toBe(5);
    expect(mapping.gst.igst).toBe(6);
    expect(mapping.gst.source).toBe("FROM_SHEET");
  });

  it("keeps tax columns out of the ordinary field mapping", () => {
    const { mapping } = suggest([
      "Invoice No", "Date", "Party", "Taxable Value", "CGST Amount", "SGST Amount", "Total",
    ]);
    expect(mapping.fields.total).toBe(6);
    expect(mapping.fields.amount).not.toBe(4);
    expect(mapping.fields.taxable).toBe(3);
  });

  it("carries a WIDE sheet's rate groups into the mapping and claims their columns", () => {
    const headers = [
      "Invoice No", "Date", "Party",
      "5% Taxable", "5% CGST", "5% SGST",
      "18% Taxable", "18% CGST", "18% SGST",
      "Invoice Total",
    ];
    const { mapping } = suggest(headers);
    expect(mapping.gst.taxLayout).toBe("WIDE");
    expect(mapping.gst.rateGroups.map((g) => g.rate)).toEqual([5, 18]);
    // "5% Taxable" must not also be the field-level taxable column.
    expect(mapping.fields.taxable).toBeNull();
    expect(mapping.fields.total).toBe(9);
  });

  it("switches to CALCULATE when the sheet carries a rate but no tax amounts", () => {
    const { mapping } = suggest(
      ["Invoice No", "Date", "Party", "Taxable Value", "GST Rate"],
      [
        ["INV-1", "05/08/2024", "Acme", 1000, 18],
        ["INV-2", "06/08/2024", "Beta", 2000, 5],
        ["INV-3", "07/08/2024", "Gamma", 3000, 12],
      ]
    );
    expect(mapping.gst.rateColumn).toBe(4);
    expect(mapping.gst.source).toBe("CALCULATE");
  });

  it("does not mistake a unit-price column for a GST rate column", () => {
    const { mapping } = suggest(
      ["Invoice No", "Date", "Party", "Rate", "Amount"],
      [
        ["INV-1", "05/08/2024", "Acme", 249.5, 1000],
        ["INV-2", "06/08/2024", "Beta", 1875, 2000],
      ],
      "SALE",
      "WITH_ITEM"
    );
    expect(mapping.gst.rateColumn).toBeNull();
  });

  it("finds an explicit interstate column", () => {
    const { mapping } = suggest([
      "Invoice No", "Date", "Party", "Taxable Value", "Interstate", "Total",
    ]);
    expect(mapping.gst.interstateColumn).toBe(4);
  });

  it("never guesses ledger ids, which a spreadsheet cannot know", () => {
    const { mapping } = suggest(["Invoice No", "Date", "Party", "Taxable"]);
    expect(mapping.ledgers.primaryLedgerId).toBeNull();
    expect(mapping.ledgers.perRateLedgerIds).toEqual({});
  });
});

describe("the synonym dictionary", () => {
  it("covers every field in the contract", () => {
    const fields = Object.keys(FIELD_SYNONYMS);
    for (const field of [
      "invoiceNumber", "date", "partyName", "partyGstin", "narration",
      "taxable", "total", "discount", "roundOff",
      "itemName", "quantity", "rate", "amount", "hsnCode",
      "ledgerName", "debit", "credit",
    ]) {
      expect(fields).toContain(field);
    }
  });

  it("is written in the alphabet normalizeHeader produces", () => {
    for (const aliases of Object.values(FIELD_SYNONYMS)) {
      for (const alias of aliases) {
        expect(alias).toBe(alias.toLowerCase());
        expect(alias).not.toMatch(/[_,()/]/);
        expect(alias.trim()).toBe(alias);
      }
    }
  });
});
