import { describe, it, expect, vi } from "vitest";
import {
  validateRows,
  hasBlockingIssues,
  blockedRows,
  groupRowIndexes,
  parseSheetDate,
  parseSheetNumber,
  isBlankCell,
  isValidGstin,
  normalizeDocumentNumber,
  statedTotalForGroup,
  duplicateKeyForGroup,
  SHEET_SCOPE,
  AMOUNT_EPSILON,
} from "../validate";
import { MAX_ROWS } from "../types";
import type {
  CellValue,
  FieldMapping,
  GstMapping,
  IssueCode,
  LedgerMapping,
  ParsedSheet,
  RowIssue,
  SheetMapping,
} from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MAHARASHTRA = "27AAPFU0939F1ZV";

const sheet = (
  headers: string[],
  rows: CellValue[][],
  droppedRowIndexes: number[] = []
): ParsedSheet => ({
  sheetName: "Sheet1",
  headerRowIndex: 0,
  headers,
  rows,
  droppedRowIndexes,
  totalRowsScanned: rows.length + 1 + droppedRowIndexes.length,
});

const noFields: FieldMapping = {
  invoiceNumber: null, date: null, partyName: null, partyGstin: null, narration: null,
  taxable: null, total: null, discount: null, roundOff: null,
  itemName: null, quantity: null, rate: null, amount: null, hsnCode: null,
  ledgerName: null, debit: null, credit: null,
};

const longGst: GstMapping = {
  source: "FROM_SHEET", taxLayout: "LONG",
  cgst: null, sgst: null, igst: null, cess: null,
  rateGroups: [], rateColumn: null, flatRate: null, interstateColumn: null,
};

const fullLedgers: LedgerMapping = {
  primaryLedgerId: "L_SALES",
  cgstLedgerId: "L_CGST",
  sgstLedgerId: "L_SGST",
  igstLedgerId: "L_IGST",
  cessLedgerId: "L_CESS",
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
  ledgers: { ...fullLedgers, ...over.ledgers },
});

/** A mapping with every required field present, so a test only sees what it aims at. */
const sane = (over: Parameters<typeof mapping>[0] = {}) =>
  mapping({
    ...over,
    fields: { invoiceNumber: 0, date: 1, partyName: 2, taxable: 3, ...over.fields },
  });

const HEADERS = ["Inv", "Date", "Party", "Taxable", "CGST", "SGST", "Total", "GSTIN", "Discount"];
const okRow: CellValue[] = ["INV-1", "05/08/2024", "Acme", 1000, 90, 90, 1180, MAHARASHTRA, 0];

const codes = (issues: RowIssue[]): IssueCode[] => issues.map((i) => i.code);
const of = (issues: RowIssue[], code: IssueCode) => issues.filter((i) => i.code === code);

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("cell primitives", () => {
  it("treats the tokens their checklist forbids as blank", () => {
    for (const token of ["", "  ", "-", "NA", "n/a", "nil", "None", "not applicable"]) {
      expect(isBlankCell(token)).toBe(true);
    }
    expect(isBlankCell(0)).toBe(false);
    expect(isBlankCell(false)).toBe(false);
  });

  it("reads the date formats their four documents disagree about", () => {
    const iso = (v: CellValue) => parseSheetDate(v)?.toISOString().slice(0, 10);
    expect(iso("27/05/1992")).toBe("1992-05-27");
    expect(iso("05-08-2024")).toBe("2024-08-05");
    expect(iso("27-MAY-2025")).toBe("2025-05-27");
    expect(iso("2024-08-05")).toBe("2024-08-05");
  });

  it("is day-first on an ambiguous date, as every sheet in the corpus is", () => {
    expect(parseSheetDate("05/08/2024")?.getUTCMonth()).toBe(7);
  });

  it("returns null rather than a guess for an unreadable date", () => {
    expect(parseSheetDate("last tuesday")).toBeNull();
    expect(parseSheetDate("31/02/2024")).toBeNull();
  });

  it("reads the money shapes Indian exports contain", () => {
    expect(parseSheetNumber("1,23,456.78")).toBe(123456.78);
    expect(parseSheetNumber("₹ 1,000")).toBe(1000);
    expect(parseSheetNumber("(1,234.00)")).toBe(-1234);
    expect(parseSheetNumber("abc")).toBeNull();
  });

  it("knows a GSTIN from a string of the right length", () => {
    expect(isValidGstin(MAHARASHTRA)).toBe(true);
    expect(isValidGstin("27AAPFU0939F1ZVX")).toBe(false);
    expect(isValidGstin("99AAPFU0939F1ZV")).toBe(false); // no state 99
  });

  it("folds a document number on spacing and case only", () => {
    expect(normalizeDocumentNumber("INV 001")).toBe("INV001");
    expect(normalizeDocumentNumber("inv001")).toBe("INV001");
    expect(normalizeDocumentNumber("INV-001")).toBe("INV-001");
    expect(normalizeDocumentNumber("  ")).toBeNull();
  });

  it("treats anything under half a paisa as zero", () => {
    expect(AMOUNT_EPSILON).toBe(0.005);
  });
});

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("groupRowIndexes", () => {
  const rows: CellValue[][] = [["A"], ["B"], ["A"]];

  it("keeps one row per document when the sheet has no line items", () => {
    expect(groupRowIndexes(sheet(["Inv"], rows), mapping({ fields: { invoiceNumber: 0 } }))).toEqual(
      [[0], [1], [2]]
    );
  });

  it("pools non-adjacent rows of one bill", () => {
    const m = mapping({ itemMode: "WITH_ITEM", fields: { invoiceNumber: 0 } });
    expect(groupRowIndexes(sheet(["Inv"], rows), m)).toEqual([[0, 2], [1]]);
  });

  it("leaves a row with no document number on its own", () => {
    const m = mapping({ itemMode: "WITH_ITEM", fields: { invoiceNumber: 0 } });
    const parsed = sheet(["Inv"], [["A"], [null], [null]]);
    expect(groupRowIndexes(parsed, m)).toEqual([[0], [1], [2]]);
  });
});

// ---------------------------------------------------------------------------
// Every IssueCode
// ---------------------------------------------------------------------------

describe("a clean sheet", () => {
  it("raises nothing", () => {
    const m = sane({ fields: { total: 6, partyGstin: 7 }, gst: { cgst: 4, sgst: 5 } });
    expect(validateRows(sheet(HEADERS, [okRow]), m)).toEqual([]);
  });
});

describe("MISSING_REQUIRED_FIELD", () => {
  it("fires at sheet scope for a field with no column", () => {
    const issues = validateRows(sheet(HEADERS, [okRow]), mapping({ fields: { date: 1 } }));
    const missing = of(issues, "MISSING_REQUIRED_FIELD");
    expect(missing.every((i) => i.row === SHEET_SCOPE)).toBe(true);
    expect(missing.length).toBeGreaterThanOrEqual(2); // invoiceNumber, partyName
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("fires at row scope for a mapped column that is blank", () => {
    const parsed = sheet(HEADERS, [[null, "05/08/2024", "Acme", 1000, 0, 0, 1000, null, 0]]);
    const issues = validateRows(parsed, sane());
    expect(of(issues, "MISSING_REQUIRED_FIELD").map((i) => i.row)).toEqual([0]);
  });

  it("insists on a Debit or Credit column for a journal", () => {
    const m = mapping({ docType: "JOURNAL", fields: { invoiceNumber: 0, date: 1, ledgerName: 2 } });
    const issues = validateRows(sheet(HEADERS, [okRow]), m);
    expect(codes(issues)).toContain("MISSING_REQUIRED_FIELD");
  });

  it("insists that something carries the value of the document", () => {
    const m = mapping({ fields: { invoiceNumber: 0, date: 1, partyName: 2 } });
    const issues = validateRows(sheet(HEADERS, [okRow]), m);
    expect(
      of(issues, "MISSING_REQUIRED_FIELD").some((i) => i.message.includes("value of the document"))
    ).toBe(true);
  });
});

describe("MISSING_PARTY", () => {
  it("is its own code, distinct from an unmapped column", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", null, 1000, 0, 0, 1000, null, 0]]);
    const issues = validateRows(parsed, sane());
    expect(codes(issues)).toContain("MISSING_PARTY");
    expect(codes(issues)).not.toContain("MISSING_REQUIRED_FIELD");
  });
});

describe("UNPARSEABLE_DATE", () => {
  it("blocks a date nothing can read", () => {
    const parsed = sheet(HEADERS, [["INV-1", "sometime", "Acme", 1000, 0, 0, 1000, null, 0]]);
    const issues = of(validateRows(parsed, sane()), "UNPARSEABLE_DATE");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].column).toBe(1);
  });
});

describe("DATE_BEFORE_BOOKS", () => {
  const parsed = sheet(HEADERS, [["INV-1", "05/08/2023", "Acme", 1000, 0, 0, 1000, null, 0]]);

  it("blocks, because Tally answers it with 'The date is out of range'", () => {
    const issues = of(validateRows(parsed, sane(), { booksFrom: new Date("2024-04-01") }), "DATE_BEFORE_BOOKS");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("is silent when the date is on or after the books beginning", () => {
    const onTime = sheet(HEADERS, [["INV-1", "01/04/2024", "Acme", 1000, 0, 0, 1000, null, 0]]);
    expect(codes(validateRows(onTime, sane(), { booksFrom: new Date("2024-04-01") }))).not.toContain(
      "DATE_BEFORE_BOOKS"
    );
  });

  it("is silent when the caller does not know the books period", () => {
    expect(codes(validateRows(parsed, sane()))).not.toContain("DATE_BEFORE_BOOKS");
  });

  it("has no upper bound — a voucher two financial years out posts cleanly", () => {
    const future = sheet(HEADERS, [["INV-1", "05/08/2029", "Acme", 1000, 0, 0, 1000, null, 0]]);
    const issues = validateRows(future, sane(), { booksFrom: new Date("2024-04-01") });
    expect(issues).toEqual([]);
  });
});

describe("UNPARSEABLE_NUMBER", () => {
  it("blocks a numeric column that holds words", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", "one thousand", 0, 0, 1000, null, 0]]);
    const issues = of(validateRows(parsed, sane()), "UNPARSEABLE_NUMBER");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("says nothing about a cell left blank the way their checklist asks", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, "NA", "NA", 1000, null, 0]]);
    const m = sane({ fields: { total: 6 }, gst: { cgst: 4, sgst: 5 } });
    expect(codes(validateRows(parsed, m))).not.toContain("UNPARSEABLE_NUMBER");
  });
});

describe("NEGATIVE_AMOUNT", () => {
  it("blocks a negative total, because buildVoucher drops non-positive lines", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", -1000, 0, 0, -1000, null, 0]]);
    const issues = of(validateRows(parsed, sane({ fields: { total: 6 } })), "NEGATIVE_AMOUNT");
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.severity === "error")).toBe(true);
  });

  it("only warns about a negative discount", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 0, 0, 1000, null, -50]]);
    const issues = of(validateRows(parsed, sane({ fields: { discount: 8 } })), "NEGATIVE_AMOUNT");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });
});

describe("TOTAL_MISMATCH", () => {
  const m = sane({ fields: { total: 6 }, gst: { cgst: 4, sgst: 5 } });

  it("warns, never blocks", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 90, 90, 1500, null, 0]]);
    const issues = of(validateRows(parsed, m), "TOTAL_MISMATCH");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(hasBlockingIssues(validateRows(parsed, m))).toBe(false);
  });

  it("tolerates the paise that real sheets round away", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 90, 90, 1180.02, null, 0]]);
    expect(codes(validateRows(parsed, m))).not.toContain("TOTAL_MISMATCH");
  });

  it("counts a round-off column towards the total", () => {
    const withRoundOff = sane({ fields: { total: 6, roundOff: 8 }, gst: { cgst: 4, sgst: 5 } });
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 90, 90, 1180.4, null, 0.4]]);
    expect(codes(validateRows(parsed, withRoundOff))).not.toContain("TOTAL_MISMATCH");
  });
});

describe("UNBALANCED_JOURNAL", () => {
  const journal = (rows: CellValue[][]) =>
    validateRows(
      sheet(["Jrnl", "Date", "Ledger", "Debit", "Credit"], rows),
      mapping({
        docType: "JOURNAL",
        fields: { invoiceNumber: 0, date: 1, ledgerName: 2, debit: 3, credit: 4 },
        ledgers: { primaryLedgerId: null },
      })
    );

  it("blocks a journal whose sides do not agree", () => {
    const issues = of(
      journal([
        ["J-1", "05/08/2024", "Rent", 1000, null],
        ["J-1", "05/08/2024", "Bank", null, 900],
      ]),
      "UNBALANCED_JOURNAL"
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });

  it("is silent on a balanced journal spread over several rows", () => {
    expect(
      codes(
        journal([
          ["J-1", "05/08/2024", "Rent", 600, null],
          ["J-1", "05/08/2024", "Rates", 400, null],
          ["J-1", "05/08/2024", "Bank", null, 1000],
        ])
      )
    ).not.toContain("UNBALANCED_JOURNAL");
  });

  it("never fires on a sales or purchase sheet", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 0, 0, 9999, null, 0]]);
    expect(codes(validateRows(parsed, sane({ fields: { total: 6 } })))).not.toContain(
      "UNBALANCED_JOURNAL"
    );
  });
});

describe("INVALID_GSTIN", () => {
  it("warns without blocking a month of posting over one bad cell", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 0, 0, 1000, "27NOPE", 0]]);
    const issues = of(validateRows(parsed, sane({ fields: { partyGstin: 7 } })), "INVALID_GSTIN");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("accepts a blank GSTIN — an unregistered party has none", () => {
    const parsed = sheet(HEADERS, [["INV-1", "05/08/2024", "Acme", 1000, 0, 0, 1000, null, 0]]);
    expect(codes(validateRows(parsed, sane({ fields: { partyGstin: 7 } })))).not.toContain(
      "INVALID_GSTIN"
    );
  });
});

describe("DUPLICATE_INVOICE", () => {
  const m = sane({ fields: { total: 6, partyGstin: 7 } });

  it("catches the same document twice in one sheet", () => {
    const parsed = sheet(HEADERS, [okRow, [...okRow]]);
    const issues = of(validateRows(parsed, m), "DUPLICATE_INVOICE");
    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(1);
    expect(issues[0].severity).toBe("error");
  });

  it("does not mistake several lines of one bill for a duplicate", () => {
    const withItems = mapping({
      itemMode: "WITH_ITEM",
      fields: { invoiceNumber: 0, date: 1, partyName: 2, itemName: 3, amount: 3, total: 6 },
    });
    const parsed = sheet(HEADERS, [okRow, [...okRow]]);
    expect(codes(validateRows(parsed, withItems))).not.toContain("DUPLICATE_INVOICE");
  });

  it("asks the caller about invoices already in the books", () => {
    const hook = vi.fn().mockReturnValue(true);
    const issues = of(
      validateRows(sheet(HEADERS, [okRow]), m, { isExistingInvoice: hook }),
      "DUPLICATE_INVOICE"
    );
    expect(hook).toHaveBeenCalledTimes(1);
    expect(issues).toHaveLength(1);
  });

  it("hands the hook the same key the OCR path uses", () => {
    const key = duplicateKeyForGroup([okRow], m, [0]);
    expect(key).toBe(`INV-1|${MAHARASHTRA}|118000`);
  });
});

describe("UNMAPPED_LEDGER", () => {
  it("blocks when no sales or purchase ledger is chosen", () => {
    const m = sane({ ledgers: { primaryLedgerId: null } });
    const issues = of(validateRows(sheet(HEADERS, [okRow]), m), "UNMAPPED_LEDGER");
    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(SHEET_SCOPE);
    expect(issues[0].severity).toBe("error");
  });

  it("insists on all three tax ledgers, because interstate is decided per row", () => {
    const m = sane({ gst: { cgst: 4, sgst: 5 }, ledgers: { igstLedgerId: null } });
    const issues = of(validateRows(sheet(HEADERS, [okRow]), m), "UNMAPPED_LEDGER");
    expect(issues[0].message).toContain("IGST");
  });

  it("only warns about a discount column with no discount ledger", () => {
    const m = sane({ fields: { discount: 8 }, ledgers: { discountLedgerId: null } });
    const issues = of(validateRows(sheet(HEADERS, [okRow]), m), "UNMAPPED_LEDGER");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
  });

  it("can be switched off for a caller that resolves ledgers at post time", () => {
    const m = sane({ ledgers: { primaryLedgerId: null, cgstLedgerId: null } });
    const issues = validateRows(sheet(HEADERS, [okRow]), m, { requireLedgerMapping: false });
    expect(codes(issues)).not.toContain("UNMAPPED_LEDGER");
  });
});

describe("ROW_LIMIT_EXCEEDED", () => {
  it("fails fast on a runaway file", () => {
    const rows: CellValue[][] = Array.from({ length: 4 }, (_, i) => [
      `INV-${i}`, "05/08/2024", "Acme", 1000, 0, 0, 1000, null, 0,
    ]);
    const issues = of(validateRows(sheet(HEADERS, rows), sane(), { maxRows: 3 }), "ROW_LIMIT_EXCEEDED");
    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(SHEET_SCOPE);
    expect(issues[0].severity).toBe("error");
  });

  it("defaults to the contract's ceiling", () => {
    expect(MAX_ROWS).toBe(20_000);
    const issues = validateRows(sheet(HEADERS, [okRow]), sane());
    expect(codes(issues)).not.toContain("ROW_LIMIT_EXCEEDED");
  });
});

describe("GRAND_TOTAL_ROW", () => {
  it("reports what the parser already dropped, rather than silently losing it", () => {
    const parsed = sheet(HEADERS, [okRow], [7, 8]);
    const issues = of(validateRows(parsed, sane({ fields: { total: 6, partyGstin: 7 }, gst: { cgst: 4, sgst: 5 } })), "GRAND_TOTAL_ROW");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("warning");
    expect(issues[0].row).toBe(SHEET_SCOPE);
  });

  it("blocks a totals row that survived into the data", () => {
    const parsed = sheet(HEADERS, [
      okRow,
      ["Grand Total", null, null, 1000, 90, 90, 1180, null, 0],
    ]);
    const issues = of(validateRows(parsed, sane()), "GRAND_TOTAL_ROW");
    expect(issues).toHaveLength(1);
    expect(issues[0].row).toBe(1);
    expect(issues[0].severity).toBe("error");
  });

  it("blocks a trailing row that has money but names nothing", () => {
    const parsed = sheet(HEADERS, [okRow, [null, null, null, 1000, 90, 90, 1180, null, 0]]);
    const issues = of(validateRows(parsed, sane()), "GRAND_TOTAL_ROW");
    expect(issues.map((i) => i.row)).toEqual([1]);
  });

  it("does not mistake a party actually called 'Total Solutions' for a totals row", () => {
    const parsed = sheet(HEADERS, [
      ["INV-9", "05/08/2024", "Total Solutions Pvt Ltd", 1000, 0, 0, 1000, null, 0],
    ]);
    expect(codes(validateRows(parsed, sane()))).not.toContain("GRAND_TOTAL_ROW");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("statedTotalForGroup", () => {
  const m = sane({ fields: { total: 6 }, gst: { cgst: 4, sgst: 5 } });

  it("takes a repeated document total once", () => {
    const rows: CellValue[][] = [
      ["INV-1", "05/08/2024", "Acme", 500, 45, 45, 1180, null, 0],
      ["INV-1", "05/08/2024", "Acme", 500, 45, 45, 1180, null, 0],
    ];
    expect(statedTotalForGroup(rows, m, [0, 1])).toBe(1180);
  });

  it("sums line totals", () => {
    const rows: CellValue[][] = [
      ["INV-1", "05/08/2024", "Acme", 500, 45, 45, 590, null, 0],
      ["INV-1", "05/08/2024", "Acme", 500, 45, 45, 590, null, 0],
    ];
    expect(statedTotalForGroup(rows, m, [0, 1])).toBe(1180);
  });

  it("is null when no total column is mapped", () => {
    expect(statedTotalForGroup([okRow], sane(), [0])).toBeNull();
  });
});

describe("blockedRows", () => {
  it("lists the data rows that cannot commit, ignoring sheet-scope issues", () => {
    const issues: RowIssue[] = [
      { row: SHEET_SCOPE, column: null, code: "UNMAPPED_LEDGER", severity: "error", message: "" },
      { row: 2, column: null, code: "UNPARSEABLE_DATE", severity: "error", message: "" },
      { row: 3, column: null, code: "TOTAL_MISMATCH", severity: "warning", message: "" },
    ];
    expect([...blockedRows(issues)]).toEqual([2]);
  });
});
