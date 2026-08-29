/**
 * Find the header row, name its columns, and spot the rows that are not data.
 *
 * Their checklist opens with "The first row should have column names" and
 * "Don't write anything above the column names", which is a spec written as an
 * apology: their parser reads row 1 or fails. Real exports do not look like
 * that. A Tally sales register, a bank statement, a Meesho payout file and
 * anything produced by a report writer all lead with a title, a blank line and
 * a date range before the headers arrive.
 *
 * Their rule 8 - "Delete rows with Grand Total or any notes not needed for
 * Tally" - is the same apology. A totals row that survives their parser becomes
 * a voucher with no party and a five-lakh amount. Detecting one is a dozen lines
 * of code, so we detect it and say so rather than making a human delete it.
 *
 * Nothing here reads the file; it works on `CellValue[][]` so the heuristics can
 * be tested without a spreadsheet in the loop.
 */

import type { CellValue } from "./types";
import { normalizeWhitespace, parseNumericText, toText } from "./normalizeCell";

/**
 * How far down to look for headers.
 *
 * Twenty rows covers every preamble we have seen (title, blank, company name,
 * GSTIN, period, blank). Scanning further starts finding the second header of a
 * sheet that stacks two reports on top of each other, which is worse than
 * missing it.
 */
export const HEADER_SCAN_ROWS = 20;

/** Rows below a candidate that vote on whether it looks like a header. */
const LOOKAHEAD_ROWS = 5;

/** A header row with a single label is a title, not a header. */
const MIN_HEADER_CELLS = 2;

const TOTAL_LABEL =
  /^(?:g\s*)?(?:grand|sub|net|running)?\s*totals?$|^sum$|^total\s+(?:amount|value|rs)$/;

/** Headers that all but guarantee a numeric column, used to classify columns. */
const NUMERIC_HEADER_HINT =
  /\b(?:amount|amt|value|total|taxable|tax|gst|cgst|sgst|igst|utgst|cess|qty|quantity|rate|price|debit|credit|discount|freight|round\s*off|net|gross)\b/;

// ---------------------------------------------------------------------------
// Header text
// ---------------------------------------------------------------------------

/**
 * Collapse a header to its comparison key.
 *
 * "Invoice No.", "invoice no" and "INVOICE_NO" are the same column; a template
 * saved against one must match the other two. Punctuation goes, case goes,
 * runs of whitespace collapse. `%` survives because it distinguishes "5% CGST"
 * from "12% CGST", and a decimal point between digits survives because "2.5%"
 * and "25%" are not the same rate.
 */
export function normalizeHeader(value: string): string {
  const lowered = normalizeWhitespace(value).toLowerCase();
  const cleaned = lowered.replace(/[^a-z0-9%.]+/g, " ");
  // Drop the dots that are not decimal points, so "Invoice No." loses its dot
  // while "SGST @ 2.5%" keeps the rate that tells one column group from another.
  return cleaned
    .replace(/\.(?!\d)/g, " ")
    .replace(/(^|[^0-9])\./g, "$1 ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * FNV-1a, 32-bit, over UTF-16 code units low byte first.
 *
 * Spelled out rather than imported so the algorithm is pinned: templates are
 * looked up by this value, and a hash that changes silently orphans every saved
 * mapping in the database.
 */
function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    hash = Math.imul(hash ^ (code & 0xff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ ((code >>> 8) & 0xff), 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function toHex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * The template lookup key.
 *
 * Algorithm, in full, because another module stores this and must be able to
 * reproduce it:
 *
 *   1. `normalizeHeader` every header, in sheet order. Order is part of the
 *      identity: two sheets with the same column names in a different order map
 *      differently, so they must not share a template.
 *   2. Drop trailing empties only. An empty column in the middle is a real
 *      column and shifts every index after it.
 *   3. Join with U+001F (unit separator), a character `normalizeHeader` can
 *      never emit, so `["a b"]` and `["a", "b"]` cannot collide.
 *   4. FNV-1a/32 twice, with offset bases 0x811c9dc5 and 0x9dc5811c, and
 *      concatenate as 16 lowercase hex digits.
 *
 * Prefixed `h1-` so a future change to any of the above can be told apart from
 * this one instead of silently matching the wrong template.
 */
export function headerFingerprint(headers: string[]): string {
  const normalized = headers.map(normalizeHeader);
  while (normalized.length > 0 && normalized[normalized.length - 1] === "") {
    normalized.pop();
  }
  const joined = normalized.join("\u001F");
  return `h1-${toHex8(fnv1a32(joined, 0x811c9dc5))}${toHex8(fnv1a32(joined, 0x9dc5811c))}`;
}

// ---------------------------------------------------------------------------
// Header row detection
// ---------------------------------------------------------------------------

function isBlank(value: CellValue): boolean {
  return value === null || value === undefined || value === "";
}

function isNumericish(value: CellValue): boolean {
  if (typeof value === "number") return true;
  if (typeof value === "string") return parseNumericText(value) !== null;
  return false;
}

/** Column positions that hold something on this row. */
function filledColumns(row: CellValue[] | undefined): number[] {
  if (!row) return [];
  const out: number[] = [];
  for (let i = 0; i < row.length; i += 1) {
    if (!isBlank(row[i])) out.push(i);
  }
  return out;
}

/**
 * How much do the rows underneath behave like data for these columns?
 *
 * This is the component that separates a header from a date-range line: both
 * are short text, but only a header has a rectangle of populated, differently
 * typed values under it.
 */
function dataLikelihoodBelow(rows: CellValue[][], index: number, columns: number[]): number {
  if (columns.length === 0) return 0;

  let seen = 0;
  let overlapTotal = 0;
  let typedRows = 0;

  for (let i = index + 1; i < rows.length && seen < LOOKAHEAD_ROWS; i += 1) {
    const row = rows[i];
    const filled = filledColumns(row);
    if (filled.length === 0) continue;
    seen += 1;

    const covered = columns.filter((c) => !isBlank(row[c])).length;
    overlapTotal += covered / columns.length;
    if (row.some((v) => isNumericish(v) || v instanceof Date)) typedRows += 1;
  }

  // Nothing below is neither evidence for nor against; a sheet can legitimately
  // end one row after its header. Score it neutrally rather than at zero.
  if (seen === 0) return 0.35;
  return 0.6 * (overlapTotal / seen) + 0.4 * (typedRows / seen);
}

/**
 * 0-1, higher is more header-like. The weights are ordinal, not measured: the
 * only property that matters is that a real header beats a title, a blank, a
 * date range and the first data row on every sheet shape we have.
 */
export function scoreHeaderRow(rows: CellValue[][], index: number, width: number): number {
  const row = rows[index];
  const columns = filledColumns(row);
  if (columns.length < MIN_HEADER_CELLS) return 0;

  const values = columns.map((c) => (row as CellValue[])[c]);
  const strings = values.filter((v) => typeof v === "string") as string[];
  const typed = values.filter((v) => isNumericish(v) || v instanceof Date || typeof v === "boolean");

  const fill = width > 0 ? columns.length / width : 0;
  const textRatio = strings.length / values.length;
  const typedRatio = typed.length / values.length;

  const distinct = new Set(strings.map(normalizeHeader));
  const unique = strings.length > 0 ? distinct.size / strings.length : 0;

  // Headers are labels, not sentences. A row of narrations scores badly here.
  const labelish =
    strings.length > 0
      ? strings.filter((s) => s.length <= 60 && s.split(" ").length <= 8).length / strings.length
      : 0;

  const below = dataLikelihoodBelow(rows, index, columns);

  return (
    0.3 * fill +
    0.22 * textRatio +
    0.16 * unique +
    0.1 * labelish +
    0.22 * below -
    0.25 * typedRatio
  );
}

export interface DetectHeaderOptions {
  /** Rows to consider. Defaults to `HEADER_SCAN_ROWS`. */
  scanRows?: number;
}

/**
 * Zero-based index of the header row, or 0 when the sheet gives us nothing to
 * go on. Ties go to the earlier row: a sheet with a repeated header block wants
 * the first one, because everything below it is the data.
 */
export function detectHeaderRow(rows: CellValue[][], opts: DetectHeaderOptions = {}): number {
  if (rows.length === 0) return 0;

  const limit = Math.min(rows.length, opts.scanRows ?? HEADER_SCAN_ROWS);

  let width = 0;
  for (let i = 0; i < limit; i += 1) {
    const columns = filledColumns(rows[i]);
    if (columns.length > 0) width = Math.max(width, columns[columns.length - 1] + 1);
  }

  let bestIndex = 0;
  let bestScore = 0;
  for (let i = 0; i < limit; i += 1) {
    const score = scoreHeaderRow(rows, i, width);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestScore > 0 ? bestIndex : 0;
}

/** Header strings for a row, padded to `width` so indexes stay aligned. */
export function headerRowToStrings(row: CellValue[] | undefined, width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < width; i += 1) {
    out.push(toText(row ? row[i] ?? null : null));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grand-total rows
// ---------------------------------------------------------------------------

function looksLikeTotalLabel(value: CellValue): boolean {
  if (typeof value !== "string") return false;
  const key = normalizeHeader(value);
  if (key === "") return false;
  return TOTAL_LABEL.test(key) || /^(?:grand\s+total|total)\b/.test(key);
}

/**
 * Which columns hold numbers, by majority vote over the data.
 *
 * Done by sampling rather than by header text alone, because a column headed
 * "Particulars" in one client's sheet is the ledger name and in another's is
 * the amount. Header text only breaks ties.
 */
function classifyColumns(
  rows: CellValue[][],
  headers: string[]
): { numeric: number[]; textual: number[] } {
  const width = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  const numeric: number[] = [];
  const textual: number[] = [];

  for (let c = 0; c < width; c += 1) {
    let populated = 0;
    let numbers = 0;
    let texts = 0;
    for (const row of rows) {
      const value = row[c];
      if (isBlank(value)) continue;
      populated += 1;
      if (isNumericish(value)) numbers += 1;
      else if (typeof value === "string") texts += 1;
    }

    if (populated === 0) {
      if (NUMERIC_HEADER_HINT.test(normalizeHeader(headers[c] ?? ""))) numeric.push(c);
      continue;
    }
    if (numbers / populated >= 0.6) numeric.push(c);
    else if (texts > 0) textual.push(c);
  }

  return { numeric, textual };
}

/**
 * Indexes into `rows` of the rows that are summaries rather than transactions.
 *
 * Two shapes, because sheets produce both:
 *
 *   labelled - some cell says "Total" / "Grand Total" / "Sum" and at least one
 *              numeric column is populated. Caught anywhere in the sheet, since
 *              rate-wise subtotals appear mid-body.
 *
 *   unlabelled - every text column is empty while two or more numeric columns
 *                are populated. Only trusted in the trailing block, walking up
 *                from the last row, because in the middle of a sheet that is
 *                far more likely to be a row with a missing party name than a
 *                subtotal, and dropping a real transaction is the worse error.
 */
export function detectGrandTotalRows(rows: CellValue[][], headers: string[]): number[] {
  if (rows.length === 0) return [];

  const { numeric, textual } = classifyColumns(rows, headers);
  const dropped = new Set<number>();

  const populatedNumericCount = (row: CellValue[]) =>
    numeric.filter((c) => !isBlank(row[c])).length;

  const populatedTextCount = (row: CellValue[]) => textual.filter((c) => !isBlank(row[c])).length;

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row.some(looksLikeTotalLabel)) continue;
    if (populatedNumericCount(row) < 1) continue;
    // A summary row carries its label and nothing else in text. Without this a
    // party genuinely called "Total Solutions Pvt Ltd" loses its invoice.
    if (populatedTextCount(row) > 1) continue;
    dropped.add(i);
  }

  if (textual.length > 0 && numeric.length >= 2) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (dropped.has(i)) continue;
      const textEmpty = textual.every((c) => isBlank(row[c]));
      if (textEmpty && populatedNumericCount(row) >= 2) dropped.add(i);
      else break;
    }
  }

  return Array.from(dropped).sort((a, b) => a - b);
}
