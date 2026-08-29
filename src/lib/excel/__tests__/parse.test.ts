import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { MAX_ROWS } from "../types";
import {
  ExcelParseError,
  listSheets,
  parseSheet,
  pickDefaultSheet,
  scanSheets,
} from "../parse";
import { detectLayout } from "../detectLayout";
import { ensureFixtures, fixture } from "./parse.fixtures";

beforeAll(async () => {
  await ensureFixtures();
});

const iso = (value: unknown) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);

async function bytes(name: string): Promise<Buffer> {
  return readFile(fixture(name));
}

describe("parseSheet — a clean LONG sheet", () => {
  it("reads the header row and every data row", async () => {
    const parsed = await parseSheet({ path: fixture("long-clean.xlsx") });
    expect(parsed.sheetName).toBe("Purchase Register");
    expect(parsed.headerRowIndex).toBe(0);
    expect(parsed.headers).toEqual([
      "Invoice No.",
      "Invoice Date",
      "Party Name",
      "GSTIN",
      "Taxable Value",
      "CGST",
      "SGST",
      "IGST",
      "Invoice Total",
    ]);
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.droppedRowIndexes).toEqual([]);
    expect(parsed.totalRowsScanned).toBe(4);
  });

  it("types the cells on the way out", async () => {
    const parsed = await parseSheet({ path: fixture("long-clean.xlsx") });
    const [invoiceNo, date, party, gstin, taxable] = parsed.rows[0];
    expect(invoiceNo).toBe("INV-001");
    expect(iso(date)).toBe("2026-04-03");
    expect(party).toBe("Acme Traders");
    expect(gstin).toBe("27AABCU9603R1ZM");
    expect(taxable).toBe(10000);
  });

  it("works from a buffer as well as a path", async () => {
    const parsed = await parseSheet(await bytes("long-clean.xlsx"), {
      fileName: "long-clean.xlsx",
    });
    expect(parsed.rows).toHaveLength(3);
  });

  it("feeds detectLayout a header list it reads as LONG", async () => {
    const parsed = await parseSheet({ path: fixture("long-clean.xlsx") });
    const layout = detectLayout(parsed.headers);
    expect(layout.taxLayout).toBe("LONG");
    expect(layout.confidence).toBeGreaterThan(0.7);
  });
});

describe("parseSheet — a WIDE sheet with non-contiguous rate groups", () => {
  it("parses and then resolves into three rate groups", async () => {
    const parsed = await parseSheet({ path: fixture("wide-multirate.xlsx") });
    expect(parsed.sheetName).toBe("Sales");
    expect(parsed.rows).toHaveLength(3);

    const layout = detectLayout(parsed.headers);
    expect(layout.taxLayout).toBe("WIDE");
    expect(layout.rateGroups).toEqual([
      { rate: 5, taxable: 4, cgst: 6, sgst: 8, igst: null },
      { rate: 12, taxable: 9, cgst: 10, sgst: 11, igst: null },
      { rate: 18, taxable: 3, cgst: 5, sgst: 7, igst: null },
    ]);
    expect(layout.confidence).toBeGreaterThan(0.7);
  });

  it("puts the right numbers behind each group's columns", async () => {
    const parsed = await parseSheet({ path: fixture("wide-multirate.xlsx") });
    const layout = detectLayout(parsed.headers);
    const row = parsed.rows[0];
    const group18 = layout.rateGroups.find((g) => g.rate === 18);
    expect(row[group18?.taxable as number]).toBe(10000);
    expect(row[group18?.cgst as number]).toBe(900);
    expect(row[group18?.sgst as number]).toBe(900);
  });
});

describe("parseSheet — junk above the header", () => {
  it("finds the header under a title, a blank line and a period line", async () => {
    const parsed = await parseSheet({ path: fixture("junk-above-header.xlsx") });
    expect(parsed.headerRowIndex).toBe(3);
    expect(parsed.headers[0]).toBe("Invoice No.");
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0][0]).toBe("INV-001");
  });

  it("can be overridden when the user corrects the wizard", async () => {
    const parsed = await parseSheet({ path: fixture("junk-above-header.xlsx") }, {
      headerRowIndex: 0,
    });
    expect(parsed.headerRowIndex).toBe(0);
    expect(parsed.headers[0]).toBe("ACME TRADING COMPANY PRIVATE LIMITED");
  });
});

describe("parseSheet — rows that are not data", () => {
  it("drops the grand-total row and reports which sheet row it was", async () => {
    const parsed = await parseSheet({ path: fixture("grand-total.xlsx") });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.some((row) => row[0] === "Grand Total")).toBe(false);
    // Header 0, data 1-2, blank 3, data 4, total 5.
    expect(parsed.droppedRowIndexes).toEqual([3, 5]);
  });

  it("keeps the total row when the caller asks it to", async () => {
    const parsed = await parseSheet({ path: fixture("grand-total.xlsx") }, {
      dropGrandTotalRows: false,
    });
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows[3][0]).toBe("Grand Total");
    expect(parsed.droppedRowIndexes).toEqual([3]);
  });
});

describe("parseSheet — Indian formats", () => {
  it("reads lakh grouping, rupee signs, parenthesised negatives and blanks", async () => {
    const parsed = await parseSheet({ path: fixture("indian-formats.xlsx") });
    expect(parsed.rows.map((r) => r[3])).toEqual([123456.78, 12000, -1234.5]);
    expect(parsed.rows.map((r) => r[6])).toEqual(["padded name", null, null]);
  });

  it("reads day-first text dates, real dates and serials as the same day-first day", async () => {
    const parsed = await parseSheet({ path: fixture("indian-formats.xlsx") });
    expect(parsed.rows.map((r) => iso(r[1]))).toEqual(["2026-04-03", "2026-04-12", 46129]);
  });

  it("normalises percent-formatted cells to the rate they display", async () => {
    const parsed = await parseSheet({ path: fixture("indian-formats.xlsx") });
    expect(parsed.rows.map((r) => r[4])).toEqual([18, 5, 12]);
  });

  it("keeps an HSN code with a leading zero", async () => {
    const parsed = await parseSheet({ path: fixture("indian-formats.xlsx") });
    expect(parsed.rows[0][5]).toBe("0801");
  });
});

describe("parseSheet — CSV", () => {
  it("reads a CSV with the same coercion rules as a workbook", async () => {
    const parsed = await parseSheet({ path: fixture("long-clean.csv") }, {
      fileName: "long-clean.csv",
    });
    expect(parsed.headerRowIndex).toBe(0);
    expect(parsed.headers[0]).toBe("Invoice No");
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0][3]).toBe(123456.78);
  });

  it("reads all three separators day-first, not through ExcelJS's MM-DD-YYYY", async () => {
    const parsed = await parseSheet({ path: fixture("long-clean.csv") }, {
      fileName: "long-clean.csv",
    });
    expect(parsed.rows.map((r) => iso(r[1]))).toEqual(["2026-04-03", "2026-04-12", "2026-04-28"]);
  });

  it("reads a CSV from a buffer with no filename at all", async () => {
    const parsed = await parseSheet(await bytes("long-clean.csv"));
    expect(parsed.rows).toHaveLength(3);
  });
});

describe("listSheets", () => {
  it("returns every sheet, not just the first", async () => {
    const sheets = await listSheets({ path: fixture("multi-sheet.xlsx") });
    expect(sheets.map((s) => s.name)).toEqual(["Instructions", "Sales Data"]);
  });

  it("counts data rows and header columns per sheet", async () => {
    const sheets = await listSheets({ path: fixture("multi-sheet.xlsx") });
    const data = sheets.find((s) => s.name === "Sales Data");
    expect(data).toEqual({ name: "Sales Data", rowCount: 3, columnCount: 9 });
  });

  it("accepts the buffer-and-name call shape the upload route uses", async () => {
    const sheets = await listSheets(await bytes("multi-sheet.xlsx"), "multi-sheet.xlsx");
    expect(sheets).toHaveLength(2);
  });
});

describe("pickDefaultSheet", () => {
  it("picks the sheet with the most data, not the first tab", async () => {
    const scans = await scanSheets({ path: fixture("multi-sheet.xlsx") });
    expect(pickDefaultSheet(scans)?.summary.name).toBe("Sales Data");
  });

  it("is what parseSheet uses when no sheet is named", async () => {
    const parsed = await parseSheet({ path: fixture("multi-sheet.xlsx") });
    expect(parsed.sheetName).toBe("Sales Data");
  });

  it("honours an explicit sheet name", async () => {
    const parsed = await parseSheet({ path: fixture("multi-sheet.xlsx") }, {
      sheetName: "Instructions",
    });
    expect(parsed.sheetName).toBe("Instructions");
  });
});

describe("errors an accountant can act on", () => {
  it("rejects a .xls by its signature, and says how to fix it", async () => {
    await expect(parseSheet({ path: fixture("legacy.xls") })).rejects.toMatchObject({
      name: "ExcelParseError",
      code: "LEGACY_XLS",
    });
    await expect(parseSheet({ path: fixture("legacy.xls") })).rejects.toThrow(
      /Save As[\s\S]*\.xlsx/
    );
  });

  it("rejects a .xls even when it has been renamed .xlsx", async () => {
    await expect(
      parseSheet(await bytes("legacy.xls"), { fileName: "renamed.xlsx" })
    ).rejects.toMatchObject({ code: "LEGACY_XLS" });
  });

  it("rejects a format it cannot read", async () => {
    await expect(
      parseSheet(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00]), { fileName: "invoice.pdf" })
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
  });

  it("names a sheet that is not there, and lists the ones that are", async () => {
    await expect(
      parseSheet({ path: fixture("multi-sheet.xlsx") }, { sheetName: "Sheet9" })
    ).rejects.toThrow(/"Instructions", "Sales Data"/);
  });

  it("wraps a corrupt workbook instead of leaking the zip error", async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(64, 0x41),
    ]);
    const error = await parseSheet(corrupt, { fileName: "broken.xlsx" }).catch((e) => e);
    expect(error).toBeInstanceOf(ExcelParseError);
    expect(error.code).toBe("UNREADABLE_FILE");
    expect(error.message).toMatch(/could not be opened/);
    // The library's own words survive for the log, not for the user.
    expect(error.detail).toBeTruthy();
  });

  it("throws a typed error above the row ceiling", async () => {
    const error = await parseSheet({ path: fixture("long-clean.xlsx") }, { maxRows: 2 }).catch(
      (e) => e
    );
    expect(error).toBeInstanceOf(ExcelParseError);
    expect(error.code).toBe("ROW_LIMIT_EXCEEDED");
    expect(error.message).toMatch(/3 rows of data/);
    expect(error.message).toMatch(/Split it into several files/);
  });

  it("defaults the ceiling to MAX_ROWS", () => {
    expect(MAX_ROWS).toBe(20_000);
  });
});

/**
 * ExcelJS 4.4.0's streaming reader fails roughly four times in five on these
 * files - see the note above `readXlsx`. It fails intermittently, which is the
 * dangerous kind: a single green run proves nothing. Ten reads of the same file
 * must all agree.
 */
describe("the ExcelJS streaming defect stays covered", () => {
  it("returns the same rows on ten consecutive reads", async () => {
    const first = await parseSheet({ path: fixture("long-clean.xlsx") });
    for (let i = 0; i < 9; i += 1) {
      const again = await parseSheet({ path: fixture("long-clean.xlsx") });
      expect(again.rows).toEqual(first.rows);
      expect(again.headers).toEqual(first.headers);
      expect(again.sheetName).toBe(first.sheetName);
    }
  });

  it("never emits a row twice when it falls back mid-read", async () => {
    for (let i = 0; i < 10; i += 1) {
      const parsed = await parseSheet({ path: fixture("multi-sheet.xlsx") });
      expect(parsed.rows).toHaveLength(3);
      expect(parsed.rows.map((r) => r[0])).toEqual(["INV-001", "INV-002", "INV-003"]);
    }
  });

  it("lists both sheets on every read", async () => {
    for (let i = 0; i < 10; i += 1) {
      const sheets = await listSheets({ path: fixture("multi-sheet.xlsx") });
      expect(sheets.map((s) => s.name)).toEqual(["Instructions", "Sales Data"]);
    }
  });
});
