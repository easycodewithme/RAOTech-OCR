import { describe, it, expect } from "vitest";
import type { CellValue } from "../types";
import {
  detectGrandTotalRows,
  detectHeaderRow,
  headerFingerprint,
  headerRowToStrings,
  normalizeHeader,
} from "../detectHeader";

const HEADERS: CellValue[] = [
  "Invoice No.",
  "Invoice Date",
  "Party Name",
  "Taxable Value",
  "CGST",
  "SGST",
  "IGST",
  "Invoice Total",
];

const dataRow = (n: number): CellValue[] => [
  `INV-00${n}`,
  new Date(Date.UTC(2026, 3, n)),
  "Acme Traders",
  10000,
  900,
  900,
  0,
  11800,
];

describe("normalizeHeader", () => {
  it("collapses the three spellings of one column onto one key", () => {
    expect(normalizeHeader("Invoice No.")).toBe("invoice no");
    expect(normalizeHeader("invoice no")).toBe("invoice no");
    expect(normalizeHeader("INVOICE_NO")).toBe("invoice no");
    expect(normalizeHeader("  Invoice   No  ")).toBe("invoice no");
  });

  it("keeps the rate, because it is what tells one column group from another", () => {
    expect(normalizeHeader("5% CGST")).toBe("5% cgst");
    expect(normalizeHeader("SGST @ 2.5%")).toBe("sgst 2.5%");
    expect(normalizeHeader("CGST@9")).toBe("cgst 9");
  });

  it("does not confuse 2.5% with 25%", () => {
    expect(normalizeHeader("SGST 2.5%")).not.toBe(normalizeHeader("SGST 25%"));
  });

  it("is empty for an empty header", () => {
    expect(normalizeHeader("   ")).toBe("");
  });
});

describe("headerFingerprint", () => {
  const headers = ["Invoice No.", "Invoice Date", "Taxable Value"];

  it("is stable across runs", () => {
    expect(headerFingerprint(headers)).toBe(headerFingerprint(headers));
  });

  it("looks like a versioned hash", () => {
    expect(headerFingerprint(headers)).toMatch(/^h1-[0-9a-f]{16}$/);
  });

  it("ignores punctuation, case and spacing", () => {
    expect(headerFingerprint(["Invoice No.", "invoice date", "TAXABLE_VALUE"])).toBe(
      headerFingerprint(["INVOICE NO", "Invoice  Date", "Taxable Value"])
    );
  });

  it("preserves order, because column order changes the mapping", () => {
    expect(headerFingerprint(["A", "B"])).not.toBe(headerFingerprint(["B", "A"]));
  });

  it("cannot be collided by moving a space across the column boundary", () => {
    expect(headerFingerprint(["a b"])).not.toBe(headerFingerprint(["a", "b"]));
  });

  it("ignores trailing empty columns but not interior ones", () => {
    expect(headerFingerprint(["A", "B", "", ""])).toBe(headerFingerprint(["A", "B"]));
    expect(headerFingerprint(["A", "", "B"])).not.toBe(headerFingerprint(["A", "B"]));
  });
});

describe("detectHeaderRow", () => {
  it("finds a header on row 0", () => {
    expect(detectHeaderRow([HEADERS, dataRow(1), dataRow(2)])).toBe(0);
  });

  it("skips a title, a blank line and a period line", () => {
    const rows: CellValue[][] = [
      ["ACME TRADING COMPANY PRIVATE LIMITED"],
      [],
      ["Sales Register", null, "01/04/2025 to 31/03/2026"],
      HEADERS,
      dataRow(1),
      dataRow(2),
      dataRow(3),
    ];
    expect(detectHeaderRow(rows)).toBe(3);
  });

  it("does not mistake the first data row for the header", () => {
    const rows: CellValue[][] = [HEADERS, dataRow(1), dataRow(2), dataRow(3), dataRow(4)];
    expect(detectHeaderRow(rows)).toBe(0);
  });

  it("prefers the wider, more label-like row when two rows are both text", () => {
    const rows: CellValue[][] = [
      ["Statement of Account", "Acme Traders"],
      HEADERS,
      dataRow(1),
      dataRow(2),
    ];
    expect(detectHeaderRow(rows)).toBe(1);
  });

  it("falls back to row 0 rather than throwing on an unreadable sheet", () => {
    expect(detectHeaderRow([])).toBe(0);
    expect(detectHeaderRow([[null], [null]])).toBe(0);
  });

  it("only looks as far as it is told to", () => {
    const rows: CellValue[][] = [[], [], HEADERS, dataRow(1)];
    expect(detectHeaderRow(rows, { scanRows: 2 })).toBe(0);
    expect(detectHeaderRow(rows, { scanRows: 4 })).toBe(2);
  });
});

describe("headerRowToStrings", () => {
  it("pads to the full width so column indexes stay aligned", () => {
    expect(headerRowToStrings(["A", null, "C"], 5)).toEqual(["A", "", "C", "", ""]);
  });

  it("trims header text, because it becomes a lookup key", () => {
    expect(headerRowToStrings(["  Invoice   No.  "], 1)).toEqual(["Invoice No."]);
  });
});

describe("detectGrandTotalRows", () => {
  const headers = HEADERS.map(String);

  it("finds a labelled grand-total row at the bottom", () => {
    const rows: CellValue[][] = [
      dataRow(1),
      dataRow(2),
      ["Grand Total", null, null, 20000, 1800, 1800, 0, 23600],
    ];
    expect(detectGrandTotalRows(rows, headers)).toEqual([2]);
  });

  it.each(["Total", "TOTAL", "Grand Total", "Sub Total", "Sum", "Totals"])(
    "recognises %s as a summary label",
    (label) => {
      const rows: CellValue[][] = [
        dataRow(1),
        [label, null, null, 10000, 900, 900, 0, 11800],
      ];
      expect(detectGrandTotalRows(rows, headers)).toEqual([1]);
    }
  );

  it("finds an unlabelled totals row: numbers with every text column empty", () => {
    const rows: CellValue[][] = [
      dataRow(1),
      dataRow(2),
      [null, null, null, 20000, 1800, 1800, 0, 23600],
    ];
    expect(detectGrandTotalRows(rows, headers)).toEqual([2]);
  });

  it("does not drop a mid-sheet row that merely has no party name", () => {
    const rows: CellValue[][] = [
      dataRow(1),
      [null, null, null, 20000, 1800, 1800, 0, 23600],
      dataRow(2),
    ];
    expect(detectGrandTotalRows(rows, headers)).toEqual([]);
  });

  it("still catches a labelled subtotal in the middle, where sheets put them", () => {
    const rows: CellValue[][] = [
      dataRow(1),
      ["Total", null, null, 10000, 900, 900, 0, 11800],
      dataRow(2),
    ];
    expect(detectGrandTotalRows(rows, headers)).toEqual([1]);
  });

  it("leaves an ordinary sheet alone", () => {
    expect(detectGrandTotalRows([dataRow(1), dataRow(2)], headers)).toEqual([]);
  });

  it("does not treat a party actually called Total Solutions as a summary", () => {
    const rows: CellValue[][] = [
      ["INV-1", new Date(Date.UTC(2026, 3, 1)), "Total Solutions Pvt Ltd", 100, 9, 9, 0, 118],
    ];
    expect(detectGrandTotalRows(rows, headers)).toEqual([]);
  });

  it("handles an empty sheet", () => {
    expect(detectGrandTotalRows([], headers)).toEqual([]);
  });
});
