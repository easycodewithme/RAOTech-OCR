/**
 * Turn whatever ExcelJS hands us into the `CellValue` union.
 *
 * Two things here are worth more than the rest of the module put together.
 *
 * **Day-first dates.** Every Vyapar TaxOne checklist says DD/MM/YYYY ("For
 * example: 27/05/1992. That's day/month/year"), their FAQ corpus then says
 * DD-MM-YYYY and DD-MMM-YYYY in three other places, and none of them states a
 * parse order. The result is a dedicated support article for "date out of
 * range" and a Meesho guide that tells accountants to repair dates by hand with
 * Excel's Text-to-Column. An Indian sheet is day-first: `03/04/2026` is 3 April.
 * A month-first reading is used only as a rescue when a day-first reading is
 * impossible (`04/13/2026`), never as a preference.
 *
 * **Trailing whitespace.** A ledger name with a stray space is a documented
 * cause of Tally import failure, and Tally's own company name has the same bug
 * (see `src/lib/tally/preflight.ts`). Non-breaking spaces survive copy/paste out
 * of PDFs and browser tables and are invisible in Excel, so they are stripped
 * here rather than left for someone to find in a diff.
 *
 * Every date is built at UTC midnight. Local-midnight `Date`s shift a day under
 * DST and across the date line, and a voucher that silently books to the
 * previous financial year is not a bug anyone enjoys.
 */

import type { CellValue } from "./types";

/** Zero-width and byte-order marks: deleted outright, they are never separators. */
const INVISIBLE_CHARS = /[​‌‍﻿]/g;

/** Everything Unicode treats as a space, plus tabs and newlines, folded to " ". */
const SPACE_LIKE_CHARS = /[\t\n\r   -   　]/g;

/**
 * Values an accountant writes to mean "nothing here".
 *
 * Their rule 6 is "If something like GST doesn't apply, just leave the cell
 * blank. Don't write 'NA' or 'none'." That rule exists because their parser
 * takes "NA" literally and then fails on it. We take the sheet as written.
 */
const BLANK_TOKENS = new Set([
  "",
  "-",
  "--",
  "---",
  "–",
  "—",
  "na",
  "n a",
  "n/a",
  "n.a.",
  "n.a",
  "nil",
  "none",
  "null",
  "not applicable",
  "#n/a",
]);

/** Currency decoration Indian sheets carry: "Rs. 1,200", "INR 1200", the rupee sign. */
const CURRENCY_TOKENS = /(?:₹|rs\.?|inr|\$)/gi;

/** Western `1,234,567.89` and Indian `1,23,456.78` in one pattern. */
const GROUPED_NUMBER = /^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$/;
const PLAIN_NUMBER = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * Excel's day zero: 1899-12-30, not 1900-01-01, because Excel believes 1900 was
 * a leap year. Serials below 61 are therefore off by one day, and `toDate`
 * refuses them rather than converting them wrongly.
 */
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
const MIN_PLAUSIBLE_SERIAL = 61; // 1900-03-01, the first serial Excel gets right
const MAX_PLAUSIBLE_SERIAL = 2958465; // 9999-12-31

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export interface NormalizeCellOptions {
  /**
   * The cell's number format, when the caller has it. Used for one thing: a
   * percent-formatted cell holds 0.18, not 18, and the mapper should not have
   * to know which of the two it is looking at.
   */
  numFmt?: string;
  /** Coerce numeric-looking text to `number`. Default true. */
  coerceNumbers?: boolean;
  /** Coerce date-looking text to `Date`. Default true. */
  coerceDates?: boolean;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function normalizeWhitespace(value: string): string {
  return value
    .replace(INVISIBLE_CHARS, "")
    .replace(SPACE_LIKE_CHARS, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

export function isBlankToken(value: string): boolean {
  return BLANK_TOKENS.has(normalizeWhitespace(value).toLowerCase());
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

export interface ParsedAmount {
  value: number;
  /**
   * A trailing Dr/Cr marker, preserved rather than applied. In a trial balance
   * Cr is the opposite sign to Dr; in a column literally headed "Credit" it is
   * not. Only the mapper knows which column it is reading.
   */
  drCr: "DR" | "CR" | null;
  /** The text carried a `%`, so 18 means the rate 18 and not the fraction 0.18. */
  percent: boolean;
}

export function parseAmountText(raw: string): ParsedAmount | null {
  let text = normalizeWhitespace(raw);
  if (isBlankToken(text)) return null;

  let drCr: "DR" | "CR" | null = null;
  const drCrMatch = text.match(/\s*\b(dr|cr)\.?$/i);
  if (drCrMatch) {
    drCr = drCrMatch[1].toUpperCase() as "DR" | "CR";
    text = text.slice(0, text.length - drCrMatch[0].length);
  }

  // Accounting negatives are parenthesised far more often than signed.
  let negative = false;
  const parenMatch = text.match(/^\(\s*(.*?)\s*\)$/);
  if (parenMatch) {
    negative = true;
    text = parenMatch[1];
  }

  text = text.replace(CURRENCY_TOKENS, "").trim();

  let percent = false;
  if (/%$/.test(text)) {
    percent = true;
    text = text.slice(0, -1).trim();
  }

  const signMatch = text.match(/^([+-])\s*([\s\S]*)$/);
  if (signMatch) {
    if (signMatch[1] === "-") negative = !negative;
    text = signMatch[2];
  }

  text = text.replace(/ /g, "");
  if (text === "") return null;

  let digits: string;
  if (GROUPED_NUMBER.test(text)) {
    digits = text.replace(/,/g, "");
  } else if (PLAIN_NUMBER.test(text)) {
    digits = text;
  } else {
    return null;
  }

  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return { value: negative ? -value : value, drCr, percent };
}

export function parseNumericText(raw: string): number | null {
  const parsed = parseAmountText(raw);
  return parsed ? parsed.value : null;
}

/**
 * Would coercing this text to a number destroy information?
 *
 * HSN codes are the case that bites: 0801 is edible nuts, and `Number("0801")`
 * is 801. Reference numbers past 2^53 lose their last digits the same way. Both
 * stay strings; a caller that wants the number can still ask `toNumber` for one.
 */
function numericTextIsLossy(raw: string): boolean {
  const bare = normalizeWhitespace(raw).replace(/[,\s+]/g, "");
  const unsigned = bare.replace(/^-/, "");
  if (/^0\d/.test(unsigned)) return true;
  const significant = unsigned.replace(/[.]/g, "").replace(/^0+/, "");
  return significant.length > 15;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function makeUtcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 9999) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Two-digit years: 70-99 are last century, 00-69 this one. */
function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length > 2) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  if (serial < 1 || serial > MAX_PLAUSIBLE_SERIAL) return null;
  // Round to the second: serial * 86400000 accumulates float noise that turns a
  // clean midnight into 23:59:59.999 on the day before.
  const seconds = Math.round(serial * 86400);
  return new Date(EXCEL_EPOCH_UTC_MS + seconds * 1000);
}

export function parseDateText(raw: string): Date | null {
  let text = normalizeWhitespace(raw);
  if (isBlankToken(text)) return null;

  // Drop an ISO or clock-time tail; the books only ever care about the day.
  const timeSplit = text.match(
    /^([\s\S]*?)[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:am|pm)?\s*(?:Z|[+-]\d{2}:?\d{2})?$/i
  );
  if (timeSplit) text = timeSplit[1].trim();

  // YYYY-MM-DD (and YYYY/MM/DD, YYYY.MM.DD) - unambiguous, so it goes first.
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) return makeUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // DD-MMM-YYYY ("27-MAY-2025"), which their AJIO guide asks users to produce.
  const alphaDay = text.match(/^(\d{1,2})[-/. ]([A-Za-z]{3,9})\.?[-/. ](\d{2,4})$/);
  if (alphaDay) {
    const month = MONTH_NAMES[alphaDay[2].toLowerCase()];
    return month ? makeUtcDate(expandYear(alphaDay[3]), month, Number(alphaDay[1])) : null;
  }

  // MMM-DD-YYYY ("May 27, 2025") - the month is named, so nothing is ambiguous.
  const alphaMonth = text.match(/^([A-Za-z]{3,9})\.?[-/. ](\d{1,2}),?[-/. ](\d{2,4})$/);
  if (alphaMonth) {
    const month = MONTH_NAMES[alphaMonth[1].toLowerCase()];
    return month ? makeUtcDate(expandYear(alphaMonth[3]), month, Number(alphaMonth[2])) : null;
  }

  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY and their two-digit-year variants.
  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const year = expandYear(numeric[3]);
    const dayFirst = makeUtcDate(year, Number(numeric[2]), Number(numeric[1]));
    if (dayFirst) return dayFirst;
    // Rescue only: 04/13/2026 cannot be day-first, so it came from a US export.
    // This never overrides a valid day-first reading - 03/04/2026 stays 3 April.
    return makeUtcDate(year, Number(numeric[1]), Number(numeric[2]));
  }

  return null;
}

/**
 * Does this text read as a date confidently enough to replace the string?
 *
 * A bare `12/2026` or `2026` is left alone: those are invoice-number shapes, and
 * a wrong `Date` is much harder to notice downstream than a string.
 */
function looksLikeDateText(text: string): boolean {
  return (
    /^\d{1,2}[-/. ][A-Za-z]{3,9}\.?[-/. ]\d{2,4}$/.test(text) ||
    /^[A-Za-z]{3,9}\.?[-/. ]\d{1,2},?[-/. ]\d{2,4}$/.test(text) ||
    /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:[ T][\s\S]*)?$/.test(text) ||
    /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}(?:[ T][\s\S]*)?$/.test(text)
  );
}

// ---------------------------------------------------------------------------
// The cell itself
// ---------------------------------------------------------------------------

function richTextToString(parts: ReadonlyArray<{ text?: unknown }>): string {
  return parts.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
}

function normalizeString(text: string, opts: NormalizeCellOptions): CellValue {
  const cleaned = normalizeWhitespace(text);
  if (isBlankToken(cleaned)) return null;

  if (opts.coerceDates !== false && looksLikeDateText(cleaned)) {
    const date = parseDateText(cleaned);
    if (date) return date;
  }

  if (opts.coerceNumbers !== false && !numericTextIsLossy(cleaned)) {
    const amount = parseAmountText(cleaned);
    if (amount) return amount.value;
  }

  return cleaned;
}

/**
 * Coerce one ExcelJS cell value.
 *
 * ExcelJS returns six shapes worth distinguishing: primitives, `Date`, rich
 * text, formula results, hyperlinks, and error values. Anything else - a merge
 * placeholder, a shared-formula stub with no cached result - becomes null,
 * because a placeholder stringified as "[object Object]" would otherwise reach
 * Tally as a ledger name.
 */
export function normalizeCell(value: unknown, opts: NormalizeCellOptions = {}): CellValue {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") return value;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (opts.numFmt && opts.numFmt.indexOf("%") !== -1) {
      // Excel stores 18% as 0.18; round away the tail that 0.18 * 100 leaves.
      return Math.round(value * 100 * 1e6) / 1e6;
    }
    return value;
  }

  if (typeof value === "string") return normalizeString(value, opts);

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.richText)) {
      return normalizeString(richTextToString(record.richText as Array<{ text?: unknown }>), opts);
    }

    if ("error" in record) return null;

    if ("formula" in record || "sharedFormula" in record) {
      // The cached result is what the accountant saw on screen. A formula with
      // no cached result (some third-party writers omit them) has no value.
      return "result" in record ? normalizeCell(record.result, opts) : null;
    }

    if ("hyperlink" in record || "text" in record) {
      if (typeof record.text === "string") return normalizeString(record.text, opts);
      if (typeof record.hyperlink === "string") return normalizeString(record.hyperlink, opts);
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Field-aware coercion, for callers that know what a column means
// ---------------------------------------------------------------------------

export function toNumber(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseNumericText(value);
  return null;
}

/**
 * Read a cell as a date, bare Excel serials included.
 *
 * A serial is recognised here and not in `normalizeCell`, because a plain number
 * in a General-formatted cell is indistinguishable from a quantity until someone
 * maps the column as a date.
 */
export function toDate(value: CellValue): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    if (value < MIN_PLAUSIBLE_SERIAL) return null;
    return excelSerialToDate(value);
  }
  if (typeof value === "string") return parseDateText(value);
  return null;
}

/** Display text for a cell - headers, error messages, diagnostics. */
export function toText(value: CellValue): string {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return normalizeWhitespace(String(value));
}
