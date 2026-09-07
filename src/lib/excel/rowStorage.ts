import type { CellValue, ParsedSheet } from "./types";

/**
 * Round-tripping a parsed sheet through Postgres JSONB.
 *
 * JSON has no date type, so a `Date` cell silently becomes an ISO string on the
 * way in and stays a string on the way out. That matters more than it sounds:
 * the mapper distinguishes "this cell is a real date" from "this cell is text
 * that might parse as a date", and Indian sheets are day-first, so a string
 * that has already been resolved to a Date must never be re-parsed and risk
 * being read as month-first a second time.
 *
 * So dates are tagged on the way out and restored on the way in, and every
 * other cell type passes through unchanged.
 */

const DATE_TAG = "__DATE__:";

type StoredCell = string | number | boolean | null;

function encodeCell(v: CellValue): StoredCell {
  if (v instanceof Date) return DATE_TAG + v.toISOString();
  return v;
}

function decodeCell(v: StoredCell): CellValue {
  if (typeof v === "string" && v.startsWith(DATE_TAG)) {
    const d = new Date(v.slice(DATE_TAG.length));
    // A tag we wrote ourselves should always parse; if it somehow does not,
    // hand back the raw text rather than an Invalid Date that fails silently
    // three layers down.
    return Number.isNaN(d.getTime()) ? v.slice(DATE_TAG.length) : d;
  }
  return v;
}

/** Everything needed to re-run mapping without the original file. */
export interface StoredSheet {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  rows: StoredCell[][];
  droppedRowIndexes: number[];
  totalRowsScanned: number;
}

export function encodeSheet(sheet: ParsedSheet): StoredSheet {
  return {
    sheetName: sheet.sheetName,
    headerRowIndex: sheet.headerRowIndex,
    headers: sheet.headers,
    rows: sheet.rows.map((r) => r.map(encodeCell)),
    droppedRowIndexes: sheet.droppedRowIndexes,
    totalRowsScanned: sheet.totalRowsScanned,
  };
}

export function decodeSheet(stored: unknown): ParsedSheet | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<StoredSheet>;
  if (!Array.isArray(s.rows) || !Array.isArray(s.headers)) return null;

  return {
    sheetName: s.sheetName ?? "",
    headerRowIndex: s.headerRowIndex ?? 0,
    headers: s.headers,
    rows: s.rows.map((r) => (Array.isArray(r) ? r.map(decodeCell) : [])),
    droppedRowIndexes: s.droppedRowIndexes ?? [],
    totalRowsScanned: s.totalRowsScanned ?? s.rows.length,
  };
}

/**
 * Apply sparse row edits to a decoded sheet, returning a new ParsedSheet.
 *
 * Each edit replaces the cells at its row index. Out-of-range indices are
 * silently ignored so a stale client cannot corrupt the grid.
 */
export function applyEdits(
  sheet: ParsedSheet,
  edits: { row: number; cells: CellValue[] }[]
): ParsedSheet {
  const rows = sheet.rows.map((r) => [...r]);
  for (const edit of edits) {
    if (edit.row >= 0 && edit.row < rows.length && Array.isArray(edit.cells)) {
      rows[edit.row] = edit.cells;
    }
  }
  return { ...sheet, rows };
}

