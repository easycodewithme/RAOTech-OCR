/**
 * Real spreadsheets to parse, written with ExcelJS rather than hand-built as
 * arrays.
 *
 * Arrays test the heuristics; only a file tests the reader. Everything that has
 * actually bitten during this work lives in the zip and not in the algorithm:
 * blank rows that never reach the stream, shared strings, a percent number
 * format that turns 18 into 0.18, the CSV reader's own eager coercion, and row
 * numbering that skips.
 *
 * Written to `fixtures/excel/` and regenerated when absent, so the files can be
 * committed for inspection or deleted without breaking the suite.
 */

import ExcelJS from "exceljs";
import { mkdir, access, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(here, "../../../../fixtures/excel");

export const fixture = (name: string): string => path.join(FIXTURE_DIR, name);

type Cell = string | number | Date | null;

/**
 * Place rows at explicit row numbers so a blank row stays a blank row.
 * `addRow([])` leaves ExcelJS free to omit the row entirely, which would shift
 * every index the tests assert on.
 */
function placeRows(sheet: ExcelJS.Worksheet, rows: Array<Cell[] | null>): void {
  rows.forEach((values, index) => {
    if (values === null) return;
    const row = sheet.getRow(index + 1);
    values.forEach((value, column) => {
      if (value !== null) row.getCell(column + 1).value = value;
    });
    row.commit();
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// The sheets
// ---------------------------------------------------------------------------

const LONG_HEADERS: Cell[] = [
  "Invoice No.",
  "Invoice Date",
  "Party Name",
  "GSTIN",
  "Taxable Value",
  "CGST",
  "SGST",
  "IGST",
  "Invoice Total",
];

const LONG_ROWS: Cell[][] = [
  ["INV-001", "03/04/2026", "Acme Traders", "27AABCU9603R1ZM", 10000, 900, 900, 0, 11800],
  ["INV-002", "12/04/2026", "Bharat Steel", "29AABCU9603R1ZM", 25000, 0, 0, 4500, 29500],
  ["INV-003", "28/04/2026", "Chola Mills", "33AABCU9603R1ZM", 8000, 720, 720, 0, 9440],
];

/**
 * Deliberately awkward: rates out of order, groups interleaved rather than
 * contiguous, and the 12% group's tax columns written as the 6% halves.
 */
const WIDE_HEADERS: Cell[] = [
  "Invoice No",
  "Date",
  "Party",
  "18% Taxable",
  "5% Taxable",
  "18% CGST",
  "5% CGST",
  "18% SGST",
  "5% SGST",
  "12% Taxable",
  "CGST@6",
  "SGST@6",
  "Invoice Total",
];

const WIDE_ROWS: Cell[][] = [
  ["S-1", "01/04/2026", "Acme Traders", 10000, 2000, 900, 50, 900, 50, 4000, 240, 240, 18380],
  ["S-2", "02/04/2026", "Bharat Steel", 0, 6000, 0, 150, 0, 150, 0, 0, 0, 6300],
  ["S-3", "03/04/2026", "Chola Mills", 5000, 0, 450, 0, 450, 0, 1000, 60, 60, 7020],
];

async function writeLongClean(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Purchase Register");
  placeRows(sheet, [LONG_HEADERS, ...LONG_ROWS]);
  await workbook.xlsx.writeFile(file);
}

async function writeWideMultiRate(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sales");
  placeRows(sheet, [WIDE_HEADERS, ...WIDE_ROWS]);
  await workbook.xlsx.writeFile(file);
}

/** A title, a blank line and a period line above the headers - the usual export. */
async function writeJunkAboveHeader(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  placeRows(sheet, [
    ["ACME TRADING COMPANY PRIVATE LIMITED"],
    null,
    ["Sales Register", null, "01/04/2025 to 31/03/2026"],
    LONG_HEADERS,
    ...LONG_ROWS,
  ]);
  await workbook.xlsx.writeFile(file);
}

/** A blank separator inside the body, then a grand-total line at the bottom. */
async function writeGrandTotal(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Register");
  placeRows(sheet, [
    LONG_HEADERS,
    LONG_ROWS[0],
    LONG_ROWS[1],
    null,
    LONG_ROWS[2],
    ["Grand Total", null, null, null, 43000, 1620, 1620, 4500, 50740],
  ]);
  await workbook.xlsx.writeFile(file);
}

/**
 * Indian number formatting and day-first dates, as text, alongside the typed
 * forms of the same values: a real `Date`, a bare serial, and a percent-
 * formatted number that Excel stores as 0.18.
 */
async function writeIndianFormats(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  placeRows(sheet, [
    ["Invoice No", "Date", "Party", "Taxable Value", "GST Rate", "HSN", "Note"],
    ["INV-1", "03/04/2026", "Acme Traders", "1,23,456.78", null, "0801", " padded  name "],
    ["INV-2", new Date(Date.UTC(2026, 3, 12)), "Bharat Steel", "₹ 12,000", null, "8517", "NA"],
    ["INV-3", 46129, "Chola Mills", "(1,234.50)", null, "1006", "-"],
  ]);
  sheet.getCell("E2").value = 0.18;
  sheet.getCell("E2").numFmt = "0.00%";
  sheet.getCell("E3").value = 0.05;
  sheet.getCell("E3").numFmt = "0%";
  sheet.getCell("E4").value = "12%";
  await workbook.xlsx.writeFile(file);
}

/** The real data is on the second tab; the first is a cover sheet. */
async function writeMultiSheet(file: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const cover = workbook.addWorksheet("Instructions");
  placeRows(cover, [["How to use this file"], ["Fill the Data tab and send it to your CA."]]);
  const data = workbook.addWorksheet("Sales Data");
  placeRows(data, [LONG_HEADERS, ...LONG_ROWS]);
  await workbook.xlsx.writeFile(file);
}

const CSV_TEXT = [
  "Invoice No,Invoice Date,Party Name,Taxable Value,CGST,SGST,IGST,Invoice Total",
  'INV-001,03/04/2026,Acme Traders,"1,23,456.78",900,900,0,"1,25,256.78"',
  "INV-002,12-04-2026,Bharat Steel,25000,0,0,4500,29500",
  "INV-003,28.04.2026,Chola Mills,8000,720,720,0,9440",
  "",
].join("\n");

/** OLE2's signature, which is all `detectFormat` needs to reject a .xls. */
const OLE2_HEADER = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

// ---------------------------------------------------------------------------

const BUILDERS: Array<[string, (file: string) => Promise<void>]> = [
  ["long-clean.xlsx", writeLongClean],
  ["wide-multirate.xlsx", writeWideMultiRate],
  ["junk-above-header.xlsx", writeJunkAboveHeader],
  ["grand-total.xlsx", writeGrandTotal],
  ["indian-formats.xlsx", writeIndianFormats],
  ["multi-sheet.xlsx", writeMultiSheet],
  ["long-clean.csv", async (file) => writeFile(file, CSV_TEXT, "utf8")],
  ["legacy.xls", async (file) => writeFile(file, OLE2_HEADER)],
];

let building: Promise<void> | null = null;

/** Idempotent, and safe to call from every test file's `beforeAll`. */
export function ensureFixtures(): Promise<void> {
  if (!building) {
    building = (async () => {
      await mkdir(FIXTURE_DIR, { recursive: true });
      for (const [name, build] of BUILDERS) {
        const file = fixture(name);
        if (!(await exists(file))) await build(file);
      }
    })();
  }
  return building;
}
