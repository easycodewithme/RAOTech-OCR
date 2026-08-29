import { describe, it, expect } from "vitest";
import {
  mapRows,
  roundMoney,
  splitTax,
  stateCodeOf,
  isInterstateByGstin,
  parseInterstateCell,
  rateForRow,
} from "../mapRows";
import type {
  CellValue,
  FieldMapping,
  GstMapping,
  LedgerMapping,
  ParsedSheet,
  RateGroup,
  SheetMapping,
} from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MAHARASHTRA = "27AAPFU0939F1ZV";
const KARNATAKA = "29AAPFU0939F1ZV";

const sheet = (headers: string[], rows: CellValue[][]): ParsedSheet => ({
  sheetName: "Sheet1",
  headerRowIndex: 0,
  headers,
  rows,
  droppedRowIndexes: [],
  totalRowsScanned: rows.length + 1,
});

const noFields: FieldMapping = {
  invoiceNumber: null,
  date: null,
  partyName: null,
  partyGstin: null,
  narration: null,
  taxable: null,
  total: null,
  discount: null,
  roundOff: null,
  itemName: null,
  quantity: null,
  rate: null,
  amount: null,
  hsnCode: null,
  ledgerName: null,
  debit: null,
  credit: null,
};

const longGst: GstMapping = {
  source: "FROM_SHEET",
  taxLayout: "LONG",
  cgst: null,
  sgst: null,
  igst: null,
  cess: null,
  rateGroups: [],
  rateColumn: null,
  flatRate: null,
  interstateColumn: null,
};

const ledgers: LedgerMapping = {
  primaryLedgerId: "L_SALES",
  cgstLedgerId: "L_CGST",
  sgstLedgerId: "L_SGST",
  igstLedgerId: "L_IGST",
  cessLedgerId: null,
  roundOffLedgerId: "L_RO",
  discountLedgerId: "L_DISC",
  perRateLedgerIds: {},
};

const mapping = (over: {
  docType?: SheetMapping["docType"];
  itemMode?: SheetMapping["itemMode"];
  fields?: Partial<FieldMapping>;
  gst?: Partial<GstMapping>;
  ledgers?: Partial<LedgerMapping>;
} = {}): SheetMapping => ({
  docType: over.docType ?? "SALE",
  itemMode: over.itemMode ?? "WITHOUT_ITEM",
  headerRowIndex: 0,
  fields: { ...noFields, ...over.fields },
  gst: { ...longGst, ...over.gst },
  ledgers: { ...ledgers, ...over.ledgers },
});

const group = (
  rate: number,
  taxable: number | null,
  cgst: number | null,
  sgst: number | null,
  igst: number | null
): RateGroup => ({ rate, taxable, cgst, sgst, igst });

/** mapRows validates for itself; these fixtures are minimal, so silence the noise. */
const noIssues = { issues: [] };

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

describe("roundMoney", () => {
  it("rounds to paise", () => {
    expect(roundMoney(1234.5678)).toBe(1234.57);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });

  it("rounds a float-noisy half-paisa up, not down", () => {
    // 1.005 is stored as 1.00499999999999989; Math.round(v * 100) gives 1.00.
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
  });

  it("rounds half away from zero on both signs", () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-2.675)).toBe(-2.68);
  });

  it("never returns -0 or a non-finite number", () => {
    expect(Object.is(roundMoney(-0.0001), 0)).toBe(true);
    expect(roundMoney(Number.NaN)).toBe(0);
    expect(roundMoney(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("leaves a value that is already clean alone", () => {
    expect(roundMoney(1180)).toBe(1180);
    expect(roundMoney(0)).toBe(0);
  });
});

describe("splitTax", () => {
  it("halves intrastate tax so the halves re-add exactly", () => {
    const { cgst, sgst, igst } = splitTax(100.01, false);
    expect(roundMoney(cgst + sgst)).toBe(100.01);
    expect(cgst).toBe(50.01);
    expect(sgst).toBe(50);
    expect(igst).toBe(0);
  });

  it("puts the whole amount in IGST when interstate", () => {
    expect(splitTax(180, true)).toEqual({ cgst: 0, sgst: 0, igst: 180 });
  });
});

// ---------------------------------------------------------------------------
// Interstate
// ---------------------------------------------------------------------------

describe("stateCodeOf", () => {
  it("takes the first two digits of a valid GSTIN", () => {
    expect(stateCodeOf(MAHARASHTRA)).toBe("27");
    expect(stateCodeOf(MAHARASHTRA.toLowerCase())).toBe("27");
    expect(stateCodeOf("29AAPFU0939F1ZV")).toBe("29");
  });

  it("accepts a bare state code", () => {
    expect(stateCodeOf("27")).toBe("27");
  });

  it("refuses a long string that is not a GSTIN", () => {
    expect(stateCodeOf("27NOTAGSTINATALL")).toBeNull();
    expect(stateCodeOf("ACME TRADERS")).toBeNull();
  });

  it("refuses empty and null", () => {
    expect(stateCodeOf(null)).toBeNull();
    expect(stateCodeOf("")).toBeNull();
    expect(stateCodeOf("2")).toBeNull();
  });
});

describe("isInterstateByGstin", () => {
  it("is interstate when the state codes differ", () => {
    expect(isInterstateByGstin(KARNATAKA, "27")).toBe(true);
  });

  it("is intrastate when they match", () => {
    expect(isInterstateByGstin(MAHARASHTRA, "27")).toBe(false);
  });

  it("accepts a full company GSTIN on the other side", () => {
    expect(isInterstateByGstin(KARNATAKA, MAHARASHTRA)).toBe(true);
  });

  it("answers null when either side is unknown, rather than guessing", () => {
    expect(isInterstateByGstin(null, "27")).toBeNull();
    expect(isInterstateByGstin(MAHARASHTRA, null)).toBeNull();
    expect(isInterstateByGstin("URP", "27")).toBeNull();
  });
});

describe("parseInterstateCell", () => {
  it("reads the tokens sheets actually use", () => {
    expect(parseInterstateCell("Yes")).toBe(true);
    expect(parseInterstateCell("INTER")).toBe(true);
    expect(parseInterstateCell(true)).toBe(true);
    expect(parseInterstateCell("no")).toBe(false);
    expect(parseInterstateCell("Intra State")).toBe(false);
  });

  it("says nothing about a blank or unrecognised cell", () => {
    expect(parseInterstateCell(null)).toBeNull();
    expect(parseInterstateCell("NA")).toBeNull();
    expect(parseInterstateCell("maybe")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LONG, WITHOUT_ITEM — the ordinary case
// ---------------------------------------------------------------------------

describe("mapRows — LONG sheet, tax from the sheet", () => {
  const m = mapping({
    fields: { invoiceNumber: 0, date: 1, partyName: 2, taxable: 3, total: 6 },
    gst: { cgst: 4, sgst: 5 },
  });
  const parsed = sheet(
    ["Invoice No", "Date", "Party", "Taxable", "CGST", "SGST", "Total"],
    [["INV-1", "05/08/2024", "Acme Traders", 1000, 90, 90, 1180]]
  );

  it("produces one invoice per row", () => {
    const result = mapRows(parsed, m, noIssues);
    expect(result.rows).toHaveLength(1);
    const inv = result.rows[0].invoice!;
    expect(inv.invoiceNumber).toBe("INV-1");
    expect(inv.subtotal).toBe(1000);
    expect(inv.cgst).toBe(90);
    expect(inv.sgst).toBe(90);
    expect(inv.igst).toBe(0);
    expect(inv.total).toBe(1180);
  });

  it("reads the date day-first", () => {
    const inv = mapRows(parsed, m, noIssues).rows[0].invoice!;
    expect(inv.date.toISOString().slice(0, 10)).toBe("2024-08-05");
  });

  it("puts the party in the vendor slot, which is what resolveLedger reads", () => {
    const inv = mapRows(parsed, m, noIssues).rows[0].invoice!;
    expect(inv.vendor).toBe("Acme Traders");
    expect(inv.customerName).toBe("Acme Traders");
  });

  it("derives the total when the sheet has no total column", () => {
    const noTotal = mapping({
      fields: { invoiceNumber: 0, date: 1, partyName: 2, taxable: 3 },
      gst: { cgst: 4, sgst: 5 },
    });
    const inv = mapRows(parsed, noTotal, noIssues).rows[0].invoice!;
    expect(inv.total).toBe(1180);
  });

  it("subtracts a discount from the derived total", () => {
    const withDiscount = mapping({
      fields: { invoiceNumber: 0, date: 1, partyName: 2, taxable: 3, discount: 6 },
      gst: { cgst: 4, sgst: 5 },
    });
    const inv = mapRows(
      sheet(["a", "b", "c", "d", "e", "f", "g"], [["INV-1", "05/08/2024", "Acme", 1000, 90, 90, 100]]),
      withDiscount,
      noIssues
    ).rows[0].invoice!;
    expect(inv.discount).toBe(100);
    expect(inv.total).toBe(1080);
  });
});

// ---------------------------------------------------------------------------
// WIDE — the mechanic the competitor cannot do
// ---------------------------------------------------------------------------

describe("mapRows — WIDE multi-rate fan-out", () => {
  const m = mapping({
    fields: { invoiceNumber: 0, date: 1, partyName: 2, total: 9 },
    gst: {
      taxLayout: "WIDE",
      rateGroups: [group(5, 3, 4, 5, null), group(18, 6, 7, 8, null)],
    },
  });
  const parsed = sheet(
    [
      "Invoice",
      "Date",
      "Party",
      "5% Taxable",
      "5% CGST",
      "5% SGST",
      "18% Taxable",
      "18% CGST",
      "18% SGST",
      "Total",
    ],
    [["INV-1", "05/08/2024", "Acme", 1000, 25, 25, 2000, 180, 180, 3410]]
  );

  it("makes one item line per populated rate block, carrying the rate", () => {
    const inv = mapRows(parsed, m, noIssues).rows[0].invoice!;
    expect(inv.items).toHaveLength(2);
    expect(inv.items.map((i) => i.gstRate)).toEqual([5, 18]);
    expect(inv.items.map((i) => i.price)).toEqual([1000, 2000]);
  });

  it("sums the tax across every rate block", () => {
    const inv = mapRows(parsed, m, noIssues).rows[0].invoice!;
    expect(inv.cgst).toBe(205);
    expect(inv.sgst).toBe(205);
    expect(inv.subtotal).toBe(3000);
    expect(inv.total).toBe(3410);
  });

  it("skips a rate block with no taxable value rather than emitting a zero line", () => {
    const oneRate = sheet(parsed.headers, [
      ["INV-2", "05/08/2024", "Acme", 0, 0, 0, 2000, 180, 180, 2360],
    ]);
    const inv = mapRows(oneRate, m, noIssues).rows[0].invoice!;
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].gstRate).toBe(18);
  });

  it("routes an interstate wide row through IGST", () => {
    const igstMapping = mapping({
      fields: { invoiceNumber: 0, date: 1, partyName: 2, total: 9 },
      gst: {
        taxLayout: "WIDE",
        rateGroups: [group(5, 3, null, null, 4), group(18, 6, null, null, 7)],
      },
    });
    const interstateSheet = sheet(
      ["Invoice", "Date", "Party", "5% Taxable", "5% IGST", "x", "18% Taxable", "18% IGST", "y", "Total"],
      [["INV-3", "05/08/2024", "Acme", 1000, 50, null, 2000, 360, null, 3410]]
    );
    const inv = mapRows(interstateSheet, igstMapping, noIssues).rows[0].invoice!;
    expect(inv.igst).toBe(410);
    expect(inv.cgst).toBe(0);
    expect(inv.sgst).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WITH_ITEM fan-in
// ---------------------------------------------------------------------------

describe("mapRows — WITH_ITEM row grouping", () => {
  const m = mapping({
    itemMode: "WITH_ITEM",
    fields: {
      invoiceNumber: 0,
      date: 1,
      partyName: 2,
      itemName: 3,
      quantity: 4,
      rate: 5,
      amount: 6,
      total: 7,
    },
  });

  it("fans several rows into one invoice, even when they are not adjacent", () => {
    // Deliberately unsorted. Every one of their checklists tells the user to
    // sort by invoice number A-Z first; we do not need them to.
    const parsed = sheet(
      ["Inv", "Date", "Party", "Item", "Qty", "Rate", "Amount", "Total"],
      [
        ["INV-1", "05/08/2024", "Acme", "Widget", 2, 100, 200, 500],
        ["INV-2", "06/08/2024", "Beta", "Gizmo", 1, 90, 90, 90],
        ["INV-1", "05/08/2024", "Acme", "Bolt", 3, 100, 300, 500],
      ]
    );
    const result = mapRows(parsed, m, noIssues);
    expect(result.rows).toHaveLength(2);

    const first = result.rows[0];
    expect(first.row).toBe(0);
    expect(first.invoice!.items.map((i) => i.name)).toEqual(["Widget", "Bolt"]);
    expect(first.invoice!.subtotal).toBe(500);

    expect(result.rows[1].invoice!.items).toHaveLength(1);
  });

  it("folds a document number that differs only in spacing and case", () => {
    const parsed = sheet(
      ["Inv", "Date", "Party", "Item", "Qty", "Rate", "Amount", "Total"],
      [
        ["INV 1", "05/08/2024", "Acme", "Widget", 1, 100, 100, 200],
        ["inv1", "05/08/2024", "Acme", "Bolt", 1, 100, 100, 200],
      ]
    );
    expect(mapRows(parsed, m, noIssues).rows).toHaveLength(1);
  });

  it("takes a repeated invoice total once instead of multiplying it", () => {
    // Both lines carry the document total 1180, not a line total.
    const parsed = sheet(
      ["Inv", "Date", "Party", "Item", "Qty", "Rate", "Amount", "Total"],
      [
        ["INV-1", "05/08/2024", "Acme", "A", 1, 500, 500, 1180],
        ["INV-1", "05/08/2024", "Acme", "B", 1, 500, 500, 1180],
      ]
    );
    const withTax = mapping({
      itemMode: "WITH_ITEM",
      fields: {
        invoiceNumber: 0, date: 1, partyName: 2, itemName: 3, quantity: 4, rate: 5, amount: 6, total: 7,
      },
      gst: { cgst: 8, sgst: 9 },
    });
    const parsedWithTax = sheet(
      [...parsed.headers, "CGST", "SGST"],
      [
        ["INV-1", "05/08/2024", "Acme", "A", 1, 500, 500, 1180, 45, 45],
        ["INV-1", "05/08/2024", "Acme", "B", 1, 500, 500, 1180, 45, 45],
      ]
    );
    const inv = mapRows(parsedWithTax, withTax, noIssues).rows[0].invoice!;
    expect(inv.subtotal).toBe(1000);
    expect(inv.total).toBe(1180);
  });

  it("sums line totals when they are line totals", () => {
    const withTax = mapping({
      itemMode: "WITH_ITEM",
      fields: {
        invoiceNumber: 0, date: 1, partyName: 2, itemName: 3, quantity: 4, rate: 5, amount: 6, total: 7,
      },
      gst: { cgst: 8, sgst: 9 },
    });
    const parsed = sheet(
      ["Inv", "Date", "Party", "Item", "Qty", "Rate", "Amount", "Total", "CGST", "SGST"],
      [
        ["INV-1", "05/08/2024", "Acme", "A", 1, 500, 500, 590, 45, 45],
        ["INV-1", "05/08/2024", "Acme", "B", 1, 500, 500, 590, 45, 45],
      ]
    );
    const inv = mapRows(parsed, withTax, noIssues).rows[0].invoice!;
    expect(inv.total).toBe(1180);
  });

  it("carries HSN through to the item so an HSN rule can fire", () => {
    const withHsn = mapping({
      itemMode: "WITH_ITEM",
      fields: { invoiceNumber: 0, date: 1, partyName: 2, itemName: 3, amount: 6, hsnCode: 4 },
    });
    const parsed = sheet(
      ["Inv", "Date", "Party", "Item", "HSN", "x", "Amount"],
      [["INV-1", "05/08/2024", "Acme", "Widget", "0801", null, 500]]
    );
    expect(mapRows(parsed, withHsn, noIssues).rows[0].invoice!.items[0].hsnCode).toBe("0801");
  });
});

// ---------------------------------------------------------------------------
// CALCULATE
// ---------------------------------------------------------------------------

describe("mapRows — GstSource CALCULATE", () => {
  const m = mapping({
    fields: { invoiceNumber: 0, date: 1, partyName: 2, partyGstin: 3, taxable: 4 },
    gst: { source: "CALCULATE", rateColumn: 5 },
  });
  const headers = ["Inv", "Date", "Party", "GSTIN", "Taxable", "GST Rate"];

  it("splits derived tax evenly for an intrastate party", () => {
    const parsed = sheet(headers, [["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000, 18]]);
    const inv = mapRows(parsed, m, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.cgst).toBe(90);
    expect(inv.sgst).toBe(90);
    expect(inv.igst).toBe(0);
    expect(inv.total).toBe(1180);
  });

  it("puts the whole derived tax in IGST for an out-of-state party", () => {
    const parsed = sheet(headers, [["INV-1", "05/08/2024", "Beta", KARNATAKA, 1000, 18]]);
    const inv = mapRows(parsed, m, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.igst).toBe(180);
    expect(inv.cgst).toBe(0);
  });

  it("decides interstate per row, not per sheet", () => {
    // One sheet, both kinds. This is the ordinary case, not an edge case.
    const parsed = sheet(headers, [
      ["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000, 18],
      ["INV-2", "05/08/2024", "Beta", KARNATAKA, 1000, 18],
    ]);
    const rows = mapRows(parsed, m, { ...noIssues, companyStateCode: "27" }).rows;
    expect(rows[0].invoice!.cgst).toBe(90);
    expect(rows[0].invoice!.igst).toBe(0);
    expect(rows[1].invoice!.igst).toBe(180);
    expect(rows[1].invoice!.cgst).toBe(0);
  });

  it("lets an explicit interstate column overrule the GSTIN", () => {
    const withColumn = mapping({
      fields: { invoiceNumber: 0, date: 1, partyName: 2, partyGstin: 3, taxable: 4 },
      gst: { source: "CALCULATE", rateColumn: 5, interstateColumn: 6 },
    });
    const parsed = sheet([...headers, "Interstate"], [
      ["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000, 18, "Yes"],
    ]);
    const inv = mapRows(parsed, withColumn, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.igst).toBe(180);
  });

  it("defaults to intrastate when nothing in the row can say", () => {
    const parsed = sheet(headers, [["INV-1", "05/08/2024", "Cash Sale", null, 1000, 18]]);
    const inv = mapRows(parsed, m, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.cgst).toBe(90);
    expect(inv.sgst).toBe(90);
  });

  it("reads a rate written as a fraction", () => {
    const parsed = sheet(headers, [["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000, 0.18]]);
    const inv = mapRows(parsed, m, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.cgst).toBe(90);
  });

  it("falls back to a flat rate when the sheet has no rate column", () => {
    const flat = mapping({
      fields: { invoiceNumber: 0, date: 1, partyName: 2, partyGstin: 3, taxable: 4 },
      gst: { source: "CALCULATE", flatRate: 5 },
    });
    const parsed = sheet(headers, [["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000, null]]);
    const inv = mapRows(parsed, flat, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.cgst).toBe(25);
    expect(inv.sgst).toBe(25);
    expect(inv.items[0].gstRate).toBe(5);
  });

  it("calculates per rate block on a WIDE sheet with no tax columns", () => {
    const wide = mapping({
      fields: { invoiceNumber: 0, date: 1, partyName: 2, partyGstin: 3 },
      gst: {
        source: "CALCULATE",
        taxLayout: "WIDE",
        rateGroups: [group(5, 4, null, null, null), group(18, 5, null, null, null)],
      },
    });
    const parsed = sheet(["Inv", "Date", "Party", "GSTIN", "5% Taxable", "18% Taxable"], [
      ["INV-1", "05/08/2024", "Acme", MAHARASHTRA, 1000, 2000],
    ]);
    const inv = mapRows(parsed, wide, { ...noIssues, companyStateCode: "27" }).rows[0].invoice!;
    expect(inv.cgst).toBe(205);
    expect(inv.sgst).toBe(205);
    expect(inv.items.map((i) => i.gstRate)).toEqual([5, 18]);
  });
});

describe("rateForRow", () => {
  it("prefers a rate column over the flat rate", () => {
    const m = mapping({ gst: { rateColumn: 0, flatRate: 5 } });
    expect(rateForRow([18], m)).toBe(18);
  });

  it("uses the flat rate when the cell is empty", () => {
    const m = mapping({ gst: { rateColumn: 0, flatRate: 5 } });
    expect(rateForRow([null], m)).toBe(5);
  });

  it("is null when the mapping knows no rate at all", () => {
    expect(rateForRow([null], mapping())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Party resolution and commit gating
// ---------------------------------------------------------------------------

describe("mapRows — party resolution", () => {
  const m = mapping({
    fields: { invoiceNumber: 0, date: 1, partyName: 2, partyGstin: 3, taxable: 4 },
  });
  const parsed = sheet(
    ["Inv", "Date", "Party", "GSTIN", "Taxable"],
    [
      ["INV-1", "05/08/2024", "Acme Pvt Ltd", MAHARASHTRA, 1000],
      ["INV-2", "05/08/2024", "Nobody Ltd", MAHARASHTRA, 1000],
    ]
  );

  it("matches a ledger by folded name, the way resolveLedger folds it", () => {
    const result = mapRows(parsed, m, {
      ...noIssues,
      ledgers: [{ id: "L1", name: "ACME PRIVATE LIMITED" }],
    });
    expect(result.rows[0].partyLedgerId).toBe("L1");
    expect(result.rows[0].partyState).toBe("RESOLVED");
  });

  it("keeps 'not in Tally' distinct from 'not mapped'", () => {
    const result = mapRows(parsed, m, {
      ...noIssues,
      ledgers: [{ id: "L1", name: "Acme Pvt Ltd" }],
    });
    expect(result.rows[1].partyState).toBe("NOT_IN_TALLY");
    expect(result.missingParties).toEqual(["Nobody Ltd"]);
  });

  it("reports a malformed GSTIN as INVALID rather than merely missing", () => {
    const bad = sheet(parsed.headers, [["INV-1", "05/08/2024", "Acme", "27NOPE", 1000]]);
    expect(mapRows(bad, m, noIssues).rows[0].partyState).toBe("INVALID");
  });

  it("says UNMAPPED when the row names no party at all", () => {
    const blank = sheet(parsed.headers, [["INV-1", "05/08/2024", null, null, 1000]]);
    expect(mapRows(blank, m, noIssues).rows[0].partyState).toBe("UNMAPPED");
  });
});

describe("mapRows — what a commit would write", () => {
  const m = mapping({
    fields: { invoiceNumber: 0, date: 1, partyName: 2, taxable: 3 },
  });
  const parsed = sheet(
    ["Inv", "Date", "Party", "Taxable"],
    [
      ["INV-1", "05/08/2024", "Acme", 1000],
      ["INV-2", "05/08/2024", "Beta", 2000],
    ]
  );

  it("counts every clean row", () => {
    expect(mapRows(parsed, m, noIssues).committableCount).toBe(2);
  });

  it("does not count a row carrying a blocking issue", () => {
    const result = mapRows(parsed, m, {
      issues: [{ row: 1, column: null, code: "UNPARSEABLE_DATE", severity: "error", message: "x" }],
    });
    expect(result.committableCount).toBe(1);
    expect(result.rows[1].issues).toHaveLength(1);
  });

  it("still counts a row carrying only a warning", () => {
    const result = mapRows(parsed, m, {
      issues: [{ row: 1, column: null, code: "TOTAL_MISMATCH", severity: "warning", message: "x" }],
    });
    expect(result.committableCount).toBe(2);
  });

  it("counts nothing when the sheet itself is blocked", () => {
    const result = mapRows(parsed, m, {
      issues: [
        { row: -1, column: null, code: "MISSING_REQUIRED_FIELD", severity: "error", message: "x" },
      ],
    });
    expect(result.committableCount).toBe(0);
  });

  it("attaches an issue from any row of a document to that document", () => {
    const withItems = mapping({
      itemMode: "WITH_ITEM",
      fields: { invoiceNumber: 0, date: 1, partyName: 2, itemName: 3, amount: 4 },
    });
    const grouped = sheet(
      ["Inv", "Date", "Party", "Item", "Amount"],
      [
        ["INV-1", "05/08/2024", "Acme", "A", 100],
        ["INV-1", "05/08/2024", "Acme", "B", 200],
      ]
    );
    const result = mapRows(grouped, withItems, {
      issues: [
        { row: 1, column: 4, code: "UNPARSEABLE_NUMBER", severity: "error", message: "x" },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].issues).toHaveLength(1);
    expect(result.committableCount).toBe(0);
  });

  it("validates for itself when the caller hands it no issues", () => {
    // A MappedRow with an empty issues array is a row a commit loop will post,
    // so silence is never the default.
    const unmapped = mapping({ fields: { date: 1 } });
    const result = mapRows(parsed, unmapped);
    expect(result.issues.some((i) => i.code === "MISSING_REQUIRED_FIELD")).toBe(true);
    expect(result.committableCount).toBe(0);
  });
});

describe("mapRows — journals", () => {
  it("groups journal rows but emits no invoice, because the contract has no shape for one", () => {
    const m = mapping({
      docType: "JOURNAL",
      fields: { invoiceNumber: 0, date: 1, ledgerName: 2, debit: 3, credit: 4 },
    });
    const parsed = sheet(
      ["Jrnl", "Date", "Ledger", "Debit", "Credit"],
      [
        ["J-1", "05/08/2024", "Rent", 1000, null],
        ["J-1", "05/08/2024", "Bank", null, 1000],
      ]
    );
    const result = mapRows(parsed, m, noIssues);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].invoice).toBeNull();
  });
});

describe("mapRows — row ceiling", () => {
  it("does not map past the ceiling", () => {
    const m = mapping({ fields: { invoiceNumber: 0, date: 1, partyName: 2, taxable: 3 } });
    const rows: CellValue[][] = Array.from({ length: 5 }, (_, i) => [
      `INV-${i}`,
      "05/08/2024",
      "Acme",
      100,
    ]);
    const result = mapRows(sheet(["a", "b", "c", "d"], rows), m, { ...noIssues, maxRows: 3 });
    expect(result.rows).toHaveLength(3);
  });
});
