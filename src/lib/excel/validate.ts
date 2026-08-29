/**
 * Row validation for a mapped sheet.
 *
 * This is the module that replaces the competitor's checklist. Their
 * "Mandatory things to check before using the Sales/Sales Return module"
 * article is fourteen rules the accountant must satisfy by hand before the
 * parser will cooperate; every rule below is one of those rules performed *for*
 * the user instead of demanded of them.
 *
 * Severity is the whole design here. "error" means Tally would reject the
 * voucher or we would post something wrong, so the row does not commit.
 * "warning" means a human should look but the row still posts — because a
 * blocking rule that fires on ordinary, correct sheets is worse than no rule.
 *
 * This module is the leaf of the excel mapping layer: it owns cell coercion,
 * GSTIN shape, the amount tolerance and document grouping, and imports nothing
 * from `mapRows.ts` (which imports *from* here). Keeping the arrow pointing one
 * way is deliberate — the two were circular in the first cut.
 */

import type {
  CellValue,
  ColumnIndex,
  FieldMapping,
  ParsedSheet,
  RowIssue,
  SheetMapping,
} from "./types";
import { MAX_ROWS } from "./types";
import { detectDuplicateKey } from "../gst/validate";
import { isBlankToken, toDate, toNumber, toText } from "./normalizeCell";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Issues that belong to the sheet rather than any one row.
 *
 * `RowIssue.row` is documented as an index into `ParsedSheet.rows`, and the
 * contract has no separate sheet-level issue type — but `MappingResult` does
 * keep a sheet-level `issues` bucket, so a sentinel row index is the honest way
 * to say "this is about the mapping, not about row 0".
 */
export const SHEET_SCOPE = -1;

/**
 * Amounts are floats; treat anything under half a paisa as zero.
 * Same constant and same reasoning as `EPSILON` in `src/lib/tally/preflight.ts`.
 */
export const AMOUNT_EPSILON = 0.005;

/**
 * How far taxable + tax may drift from the stated total before we say so.
 *
 * Five paise, not one: real registers round line tax to the rupee and let a
 * round-off column absorb the rest, and a rule that fires on every row of a
 * correct sheet trains the user to ignore it.
 */
export const DEFAULT_TOTAL_TOLERANCE = 0.05;

/**
 * Cell coercion is `normalizeCell.ts`'s job, not ours.
 *
 * These are one-line adapters over it so that this module and `mapRows.ts` speak
 * one vocabulary — `null` from a parse means "present but unreadable", which is
 * exactly the UNPARSEABLE_* distinction, and blankness is asked separately.
 * Their `isBlankToken` is what lets a sheet say "NA" where their own checklist
 * rule 6 has to tell users "leave the cell blank. Don't write 'NA' or 'none'".
 */

export function isBlankCell(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (value instanceof Date) return false;
  if (typeof value === "number" || typeof value === "boolean") return false;
  return isBlankToken(String(value));
}

/** Trimmed cell text, or null when the cell is blank-ish. */
export function cellText(value: CellValue): string | null {
  if (isBlankCell(value)) return null;
  const text = toText(value);
  return text.length ? text : null;
}

/** Read a cell by column index, tolerating short rows and unmapped columns. */
export function cellAt(row: CellValue[], column: ColumnIndex | null): CellValue {
  if (column === null || column === undefined) return null;
  if (column < 0 || column >= row.length) return null;
  return row[column] ?? null;
}

/**
 * Parse a money-ish cell. `null` means "present but not a number" — the
 * UNPARSEABLE_NUMBER case. A blank cell is not unparseable; callers test
 * `isBlankCell` first.
 */
export function parseSheetNumber(value: CellValue): number | null {
  if (isBlankCell(value)) return null;
  return toNumber(value);
}

/**
 * Parse a date cell. `null` means unreadable, so the caller can raise
 * UNPARSEABLE_DATE rather than silently posting today's date — which is what
 * `cleanDate` in the OCR path does, and the wrong behaviour for a bulk upload
 * where nobody is looking at the individual row.
 */
export function parseSheetDate(value: CellValue): Date | null {
  if (isBlankCell(value)) return null;
  return toDate(value);
}

/** Structural GSTIN test: 15 chars, and a state code that actually exists. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * The 2-digit GST state codes.
 *
 * Duplicated from the (unexported) table in `src/lib/gst/validate.ts`; that file
 * belongs to another module and exports only the check functions built on top of
 * it. If it ever exports the table, import it instead of this.
 */
export const GST_STATE_CODES: ReadonlySet<string> = new Set([
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10",
  "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "21", "22", "23", "24", "26", "27", "29", "30", "32", "33",
  "34", "36", "37", "38", "97",
]);

export function normalizeGstinCell(value: CellValue): string | null {
  const text = cellText(value);
  if (!text) return null;
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length ? cleaned : null;
}

export function isValidGstin(gstin: string | null): boolean {
  if (!gstin) return false;
  if (!GSTIN_RE.test(gstin)) return false;
  return GST_STATE_CODES.has(gstin.slice(0, 2));
}

/** Two amounts agree to within half a paisa. */
export function nearlyEqual(a: number, b: number, tolerance = AMOUNT_EPSILON): boolean {
  return Math.abs(a - b) <= tolerance + AMOUNT_EPSILON;
}

/**
 * Fold a document number for matching: upper-cased, whitespace removed.
 * "INV 001" and "inv001" are one invoice; "INV-001" is deliberately not, because
 * punctuation inside a voucher number is meaningful in Tally.
 */
export function normalizeDocumentNumber(value: CellValue): string | null {
  const text = cellText(value);
  if (!text) return null;
  return text.toUpperCase().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Document grouping
// ---------------------------------------------------------------------------

/**
 * Group data rows into documents.
 *
 * WITH_ITEM (and JOURNAL) sheets put one line per row and repeat the invoice
 * number, so several rows are one bill. We group by hashing the number, which
 * means the rows do **not** have to be contiguous. Every one of the competitor's
 * three checklists says "If one invoice has many items, sort by Invoice Number
 * A-Z to keep them in one place" and repeats it as a "Pro Tip for Accountants" —
 * a strong tell that they group by scanning for runs. Requiring the user to sort
 * their file is not a feature.
 *
 * Returns groups in first-appearance order; each group is a list of indexes into
 * `ParsedSheet.rows`.
 */
export function groupRowIndexes(parsed: ParsedSheet, mapping: SheetMapping): number[][] {
  const fansIn = mapping.itemMode === "WITH_ITEM" || mapping.docType === "JOURNAL";
  const numberColumn = mapping.fields.invoiceNumber;
  if (!fansIn || numberColumn === null) {
    return parsed.rows.map((_, i) => [i]);
  }
  const groups: number[][] = [];
  const byKey = new Map<string, number[]>();
  parsed.rows.forEach((row, index) => {
    const key = normalizeDocumentNumber(cellAt(row, numberColumn));
    if (!key) {
      // A row with no document number cannot be pooled with anything; it stands
      // alone and MISSING_REQUIRED_FIELD will speak for it.
      groups.push([index]);
      return;
    }
    const existing = byKey.get(key);
    if (existing) {
      existing.push(index);
      return;
    }
    const fresh = [index];
    byKey.set(key, fresh);
    groups.push(fresh);
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /**
   * The company's books-beginning date in Tally.
   *
   * Blocking, because Tally answers a voucher dated before it with "The date is
   * out of range! Can't import!" and then silently drops the voucher.
   */
  booksFrom?: Date | null;
  /** Row ceiling; defaults to `MAX_ROWS`. */
  maxRows?: number;
  /** Allowed drift between taxable + tax and the stated total, in rupees. */
  totalTolerance?: number;
  /**
   * Whether Stage-3 ledger choices must be present.
   *
   * Default true. Set false when the caller will resolve ledgers itself through
   * `resolveLedgersForInvoice` instead of pinning ids at mapping time.
   */
  requireLedgerMapping?: boolean;
  /**
   * Hook for duplicate detection against invoices already in the books.
   *
   * Called once per document with the same key `detectDuplicateKey` produces for
   * the OCR path, so both ingestion routes agree on what "the same invoice"
   * means. Returning true raises DUPLICATE_INVOICE on that document's first row.
   */
  isExistingInvoice?: (duplicateKey: string, rowIndex: number) => boolean;
}

/** Fields without which we cannot produce a postable voucher. */
function requiredFieldsFor(mapping: SheetMapping): Array<keyof FieldMapping> {
  const required: Array<keyof FieldMapping> = ["date", "invoiceNumber"];
  if (mapping.docType === "JOURNAL") {
    required.push("ledgerName");
    return required;
  }
  required.push("partyName");
  if (mapping.itemMode === "WITH_ITEM") required.push("itemName");
  return required;
}

/** Any column that could carry the value of the document. */
function hasAmountSource(mapping: SheetMapping): boolean {
  const f = mapping.fields;
  if (f.taxable !== null || f.total !== null || f.amount !== null) return true;
  if (mapping.gst.taxLayout === "WIDE") {
    return mapping.gst.rateGroups.some((g) => g.taxable !== null);
  }
  return false;
}

/**
 * A cell that *is* a totals label, not one that merely begins with the word.
 * "Grand Total :" ends a register; "Total Solutions Pvt Ltd" is a customer, and
 * refusing to post their invoices would be a worse bug than the one this catches.
 */
const TOTAL_ROW_RE =
  /^(?:g\.?\s*total|grand\s*total|sub\s*total|subtotal|total|totals|net\s*total|gross\s*total|closing\s*balance|sum)$/i;

function isTotalsLabel(text: string): boolean {
  // Summary cells carry trailing punctuation more often than not.
  return TOTAL_ROW_RE.test(text.replace(/[\s:.\-–—]+$/, "").trim());
}

export function validateRows(
  parsed: ParsedSheet,
  mapping: SheetMapping,
  opts: ValidateOptions = {}
): RowIssue[] {
  const issues: RowIssue[] = [];
  const f = mapping.fields;
  const isJournal = mapping.docType === "JOURNAL";
  const tolerance = opts.totalTolerance ?? DEFAULT_TOTAL_TOLERANCE;
  const maxRows = opts.maxRows ?? MAX_ROWS;

  const push = (
    row: number,
    column: ColumnIndex | null,
    code: RowIssue["code"],
    severity: RowIssue["severity"],
    message: string
  ) => {
    issues.push({ row, column, code, severity, message });
  };

  // --- sheet-level: row ceiling ------------------------------------------
  if (parsed.rows.length > maxRows) {
    push(
      SHEET_SCOPE,
      null,
      "ROW_LIMIT_EXCEEDED",
      "error",
      `This sheet has ${parsed.rows.length} data rows; the limit is ${maxRows}. Split the file and upload the parts — there is no limit on how many files you upload.`
    );
  }

  // --- sheet-level: rows the parser already threw away --------------------
  if (parsed.droppedRowIndexes.length > 0) {
    push(
      SHEET_SCOPE,
      null,
      "GRAND_TOTAL_ROW",
      "warning",
      `${parsed.droppedRowIndexes.length} row(s) were dropped as totals or separator lines (sheet rows ${parsed.droppedRowIndexes
        .slice(0, 10)
        .map((i) => i + 1)
        .join(", ")}${parsed.droppedRowIndexes.length > 10 ? ", …" : ""}). Nothing was posted for them.`
    );
  }

  // --- sheet-level: unmapped required columns -----------------------------
  for (const field of requiredFieldsFor(mapping)) {
    if (f[field] === null) {
      push(
        SHEET_SCOPE,
        null,
        "MISSING_REQUIRED_FIELD",
        "error",
        `No column is mapped to "${field}". Pick one on the mapping screen, or the rows cannot be posted.`
      );
    }
  }
  if (isJournal) {
    if (f.debit === null && f.credit === null) {
      push(
        SHEET_SCOPE,
        null,
        "MISSING_REQUIRED_FIELD",
        "error",
        "A journal needs a Debit column, a Credit column, or both."
      );
    }
  } else if (!hasAmountSource(mapping)) {
    push(
      SHEET_SCOPE,
      null,
      "MISSING_REQUIRED_FIELD",
      "error",
      "No column carries the value of the document — map Taxable, Total, or a line Amount."
    );
  }

  // --- sheet-level: ledger choices ----------------------------------------
  if (opts.requireLedgerMapping ?? true) {
    validateLedgerMapping(mapping, push);
  }

  // --- per-row -------------------------------------------------------------
  const groups = groupRowIndexes(parsed, mapping);
  const seenDuplicateKeys = new Map<string, number>();

  parsed.rows.forEach((row, index) => {
    // Totals lines that survived the parser. Left alone they would post as a
    // voucher for the whole month — the failure their checklist rule 8 exists
    // to prevent by asking the user to delete them first.
    if (looksLikeTotalsRow(row, mapping)) {
      push(
        index,
        null,
        "GRAND_TOTAL_ROW",
        "error",
        "This row looks like a totals or summary line, not a transaction. It will not be posted."
      );
      return;
    }

    for (const field of requiredFieldsFor(mapping)) {
      const column = f[field];
      if (column === null) continue;
      if (!isBlankCell(cellAt(row, column))) continue;
      if (field === "partyName") {
        push(
          index,
          column,
          "MISSING_PARTY",
          "error",
          "No party name on this row — there is nothing to post the other side of the entry to."
        );
      } else {
        push(
          index,
          column,
          "MISSING_REQUIRED_FIELD",
          "error",
          `"${field}" is blank on this row.`
        );
      }
    }

    // Dates
    if (f.date !== null) {
      const raw = cellAt(row, f.date);
      if (!isBlankCell(raw)) {
        const parsed_ = parseSheetDate(raw);
        if (!parsed_) {
          push(
            index,
            f.date,
            "UNPARSEABLE_DATE",
            "error",
            `"${String(raw)}" is not a date we can read. Use DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY or YYYY-MM-DD.`
          );
        } else if (opts.booksFrom && parsed_.getTime() < startOfDay(opts.booksFrom).getTime()) {
          // Blocking. Tally answers this with "The date is out of range! Can't
          // import!" and the voucher simply never appears.
          push(
            index,
            f.date,
            "DATE_BEFORE_BOOKS",
            "error",
            `${parsed_.toISOString().slice(0, 10)} is before this company's books begin (${startOfDay(
              opts.booksFrom
            )
              .toISOString()
              .slice(0, 10)}). Tally rejects it on import.`
          );
        }
        // There is deliberately no upper bound here: measured against a live
        // Tally, a voucher dated two financial years ahead posts cleanly. The
        // far-future *warning* lives in src/lib/tally/syncJobs.ts, where the
        // push actually happens.
      }
    }

    // Numbers
    for (const [field, column] of numericColumns(mapping)) {
      if (column === null) continue;
      const raw = cellAt(row, column);
      if (isBlankCell(raw)) continue;
      const value = parseSheetNumber(raw);
      if (value === null) {
        push(
          index,
          column,
          "UNPARSEABLE_NUMBER",
          "error",
          `"${String(raw)}" in "${field}" is not a number.`
        );
        continue;
      }
      if (value < -AMOUNT_EPSILON) {
        // buildVoucher drops any line whose amount is not positive
        // (`push()` returns early when amountPaise <= 0), so a negative value
        // here does not post small — it vanishes.
        const blocking = field === "taxable" || field === "total" || field === "amount";
        push(
          index,
          column,
          "NEGATIVE_AMOUNT",
          blocking ? "error" : "warning",
          blocking
            ? `"${field}" is negative (${value}). A return belongs in a SALE_RETURN or PURCHASE_RETURN upload, not as a negative row.`
            : `"${field}" is negative (${value}). Check the sign.`
        );
      }
    }

    // GSTIN shape
    if (f.partyGstin !== null) {
      const raw = cellAt(row, f.partyGstin);
      if (!isBlankCell(raw)) {
        const gstin = normalizeGstinCell(raw);
        if (!isValidGstin(gstin)) {
          // Warning, not error: Tally imports a voucher with a malformed party
          // GSTIN quite happily. It is GSTR filing that will bounce it, and by
          // then it is the accountant's problem — so say so now, loudly, but do
          // not stop a month's posting over one bad cell.
          push(
            index,
            f.partyGstin,
            "INVALID_GSTIN",
            "warning",
            `"${String(raw)}" is not a valid GSTIN. Interstate/intrastate will fall back to the sheet's tax columns for this row.`
          );
        }
      }
    }
  });

  // --- per-document --------------------------------------------------------
  for (const group of groups) {
    const anchor = group[0];
    if (isJournal) {
      validateJournalBalance(parsed.rows, mapping, group, push);
    } else {
      validateDocumentTotal(parsed.rows, mapping, group, tolerance, push);
    }

    const key = duplicateKeyForGroup(parsed.rows, mapping, group);
    if (!key) continue;
    const firstSeen = seenDuplicateKeys.get(key);
    if (firstSeen !== undefined) {
      push(
        anchor,
        f.invoiceNumber,
        "DUPLICATE_INVOICE",
        "error",
        `Same document number, party and amount as row ${firstSeen + 1} of this sheet. Posting both would double the entry.`
      );
      continue;
    }
    seenDuplicateKeys.set(key, anchor);
    if (opts.isExistingInvoice?.(key, anchor)) {
      push(
        anchor,
        f.invoiceNumber,
        "DUPLICATE_INVOICE",
        "error",
        "An invoice with this number, party and amount is already in the books."
      );
    }
  }

  return issues;
}

/** True when any issue in the list blocks the commit. Mirrors preflight's helper. */
export function hasBlockingIssues(issues: RowIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** The row indexes that carry at least one blocking issue. */
export function blockedRows(issues: RowIssue[]): Set<number> {
  const blocked = new Set<number>();
  for (const issue of issues) {
    if (issue.severity === "error" && issue.row !== SHEET_SCOPE) blocked.add(issue.row);
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type PushFn = (
  row: number,
  column: ColumnIndex | null,
  code: RowIssue["code"],
  severity: RowIssue["severity"],
  message: string
) => void;

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function numericColumns(mapping: SheetMapping): Array<[string, ColumnIndex | null]> {
  const f = mapping.fields;
  const g = mapping.gst;
  const cols: Array<[string, ColumnIndex | null]> = [
    ["taxable", f.taxable],
    ["total", f.total],
    ["discount", f.discount],
    ["roundOff", f.roundOff],
    ["quantity", f.quantity],
    ["rate", f.rate],
    ["amount", f.amount],
    ["debit", f.debit],
    ["credit", f.credit],
  ];
  if (g.taxLayout === "LONG") {
    cols.push(["cgst", g.cgst], ["sgst", g.sgst], ["igst", g.igst], ["cess", g.cess]);
  } else {
    for (const group of g.rateGroups) {
      cols.push(
        [`${group.rate}% taxable`, group.taxable],
        [`${group.rate}% cgst`, group.cgst],
        [`${group.rate}% sgst`, group.sgst],
        [`${group.rate}% igst`, group.igst]
      );
    }
  }
  if (g.rateColumn !== null) cols.push(["gst rate", g.rateColumn]);
  return cols;
}

function looksLikeTotalsRow(row: CellValue[], mapping: SheetMapping): boolean {
  const f = mapping.fields;
  const identityColumns = [f.invoiceNumber, f.partyName, f.ledgerName, f.itemName, f.narration];
  let sawIdentity = false;
  for (const column of identityColumns) {
    if (column === null) continue;
    const text = cellText(cellAt(row, column));
    if (!text) continue;
    sawIdentity = true;
    if (isTotalsLabel(text)) return true;
  }
  if (sawIdentity) return false;

  // No identity at all, but money in the row: the shape of a trailing summary
  // line. Their parser ingests these as vouchers, which is why every checklist
  // begins by telling the user to delete them.
  const moneyColumns = [f.total, f.taxable, f.amount, f.debit, f.credit];
  return moneyColumns.some((column) => {
    if (column === null) return false;
    const value = parseSheetNumber(cellAt(row, column));
    return value !== null && Math.abs(value) > AMOUNT_EPSILON;
  });
}

function sumColumn(
  rows: CellValue[][],
  group: number[],
  column: ColumnIndex | null
): number {
  if (column === null) return 0;
  let total = 0;
  for (const index of group) {
    const value = parseSheetNumber(cellAt(rows[index], column));
    if (value !== null) total += value;
  }
  return total;
}

function validateJournalBalance(
  rows: CellValue[][],
  mapping: SheetMapping,
  group: number[],
  push: PushFn
): void {
  const f = mapping.fields;
  if (f.debit === null && f.credit === null) return;
  const debit = sumColumn(rows, group, f.debit);
  const credit = sumColumn(rows, group, f.credit);
  if (Math.abs(debit) < AMOUNT_EPSILON && Math.abs(credit) < AMOUNT_EPSILON) return;
  if (nearlyEqual(debit, credit)) return;
  // Blocking. Their own Journal checklist states it as rule J10 ("Your total
  // Debit amount and Credit amount must be the same") and then does not enforce
  // it; an unbalanced journal is not an entry, it is a mistake.
  push(
    group[0],
    f.debit ?? f.credit,
    "UNBALANCED_JOURNAL",
    "error",
    `Debit ${debit.toFixed(2)} does not equal credit ${credit.toFixed(2)} for this journal (${group.length} row(s)).`
  );
}

function validateDocumentTotal(
  rows: CellValue[][],
  mapping: SheetMapping,
  group: number[],
  tolerance: number,
  push: PushFn
): void {
  const f = mapping.fields;
  const g = mapping.gst;
  if (f.total === null) return;

  const stated = statedTotalForGroup(rows, mapping, group);
  if (stated === null || Math.abs(stated) < AMOUNT_EPSILON) return;

  let taxable = 0;
  if (g.taxLayout === "WIDE") {
    for (const rateGroup of g.rateGroups) taxable += sumColumn(rows, group, rateGroup.taxable);
  }
  if (Math.abs(taxable) < AMOUNT_EPSILON) {
    taxable = sumColumn(rows, group, f.taxable) || sumColumn(rows, group, f.amount);
  }
  if (Math.abs(taxable) < AMOUNT_EPSILON) return;

  let tax = 0;
  if (g.taxLayout === "WIDE") {
    for (const rateGroup of g.rateGroups) {
      tax +=
        sumColumn(rows, group, rateGroup.cgst) +
        sumColumn(rows, group, rateGroup.sgst) +
        sumColumn(rows, group, rateGroup.igst);
    }
  } else {
    tax =
      sumColumn(rows, group, g.cgst) +
      sumColumn(rows, group, g.sgst) +
      sumColumn(rows, group, g.igst) +
      sumColumn(rows, group, g.cess);
  }

  const discount = sumColumn(rows, group, f.discount);
  const roundOff = sumColumn(rows, group, f.roundOff);
  const expected = taxable - discount + tax + roundOff;
  if (nearlyEqual(expected, stated, tolerance)) return;

  // Warning, never an error. Real registers round line tax to the rupee, and a
  // gap of a few paise is the round-off line doing its job, not a bad sheet.
  push(
    group[0],
    f.total,
    "TOTAL_MISMATCH",
    "warning",
    `Taxable ${taxable.toFixed(2)} − discount ${discount.toFixed(2)} + tax ${tax.toFixed(
      2
    )} + round off ${roundOff.toFixed(2)} = ${expected.toFixed(2)}, but the sheet says ${stated.toFixed(
      2
    )}. The difference will be posted to Round Off.`
  );
}

/**
 * The document's stated total.
 *
 * A multi-row invoice either repeats the invoice total on every line (the
 * marketplace shape) or carries a line total per row. Summing the first shape
 * multiplies the invoice; taking one of the second shape loses most of it. We
 * pick whichever reading lands closer to taxable + tax.
 */
export function statedTotalForGroup(
  rows: CellValue[][],
  mapping: SheetMapping,
  group: number[]
): number | null {
  const column = mapping.fields.total;
  if (column === null) return null;
  const values: number[] = [];
  for (const index of group) {
    const value = parseSheetNumber(cellAt(rows[index], column));
    if (value !== null) values.push(value);
  }
  if (values.length === 0) return null;
  if (values.length === 1) return values[0];

  const summed = values.reduce((a, b) => a + b, 0);
  const allEqual = values.every((v) => nearlyEqual(v, values[0]));
  if (!allEqual) return summed;

  const expected = expectedNetForGroup(rows, mapping, group);
  if (expected === null) return summed;
  return Math.abs(values[0] - expected) <= Math.abs(summed - expected) ? values[0] : summed;
}

function expectedNetForGroup(
  rows: CellValue[][],
  mapping: SheetMapping,
  group: number[]
): number | null {
  const f = mapping.fields;
  const g = mapping.gst;
  let taxable = 0;
  let tax = 0;
  if (g.taxLayout === "WIDE") {
    for (const rateGroup of g.rateGroups) {
      taxable += sumColumn(rows, group, rateGroup.taxable);
      tax +=
        sumColumn(rows, group, rateGroup.cgst) +
        sumColumn(rows, group, rateGroup.sgst) +
        sumColumn(rows, group, rateGroup.igst);
    }
  } else {
    tax =
      sumColumn(rows, group, g.cgst) +
      sumColumn(rows, group, g.sgst) +
      sumColumn(rows, group, g.igst) +
      sumColumn(rows, group, g.cess);
  }
  if (Math.abs(taxable) < AMOUNT_EPSILON) {
    taxable = sumColumn(rows, group, f.taxable) || sumColumn(rows, group, f.amount);
  }
  if (Math.abs(taxable) < AMOUNT_EPSILON) return null;
  return taxable - sumColumn(rows, group, f.discount) + tax + sumColumn(rows, group, f.roundOff);
}

/**
 * The key a document is considered "the same invoice" by.
 *
 * Reuses `detectDuplicateKey` from the OCR path so a sheet upload and a scanned
 * bill of the same invoice collide rather than both posting.
 */
export function duplicateKeyForGroup(
  rows: CellValue[][],
  mapping: SheetMapping,
  group: number[]
): string | null {
  const f = mapping.fields;
  if (f.invoiceNumber === null) return null;
  const head = rows[group[0]];
  const invoiceNumber = normalizeDocumentNumber(cellAt(head, f.invoiceNumber));
  if (!invoiceNumber) return null;
  const total = statedTotalForGroup(rows, mapping, group) ?? sumColumn(rows, group, f.taxable);
  return detectDuplicateKey({
    invoiceNumber,
    vendorGstin: normalizeGstinCell(cellAt(head, f.partyGstin)),
    vendor: cellText(cellAt(head, f.partyName)),
    totalAmount: total,
  });
}

function validateLedgerMapping(mapping: SheetMapping, push: PushFn): void {
  const l = mapping.ledgers;
  const g = mapping.gst;

  if (mapping.docType !== "JOURNAL" && !l.primaryLedgerId) {
    push(
      SHEET_SCOPE,
      null,
      "UNMAPPED_LEDGER",
      "error",
      `No ${mapping.docType === "SALE" || mapping.docType === "SALE_RETURN" ? "sales" : "purchase"} ledger chosen. Tally answers an unknown ledger with "Ledger name not found" and drops the voucher.`
    );
  }

  const needsTaxLedgers =
    g.source === "CALCULATE" ||
    (g.taxLayout === "LONG" && (g.cgst !== null || g.sgst !== null || g.igst !== null)) ||
    (g.taxLayout === "WIDE" && g.rateGroups.length > 0);

  if (needsTaxLedgers) {
    // Their Stage 2 makes all three mandatory unconditionally, and they are
    // right to: which of the three carries an amount is decided per row, so all
    // three must be nominated up front even on a sheet that only ever uses two.
    const missing: string[] = [];
    if (!l.cgstLedgerId) missing.push("CGST");
    if (!l.sgstLedgerId) missing.push("SGST");
    if (!l.igstLedgerId) missing.push("IGST");
    if (missing.length) {
      push(
        SHEET_SCOPE,
        null,
        "UNMAPPED_LEDGER",
        "error",
        `${missing.join(", ")} ledger(s) not chosen. Interstate is decided per row, so all three must be mapped even if this sheet only uses some of them.`
      );
    }
  }

  if (g.taxLayout === "LONG" && g.cess !== null && !l.cessLedgerId) {
    push(SHEET_SCOPE, null, "UNMAPPED_LEDGER", "error", "A cess column is mapped but no cess ledger is chosen.");
  }
  if (mapping.fields.discount !== null && !l.discountLedgerId) {
    push(
      SHEET_SCOPE,
      null,
      "UNMAPPED_LEDGER",
      "warning",
      "A discount column is mapped but no discount ledger is chosen — the discount will be absorbed into Round Off."
    );
  }
  if (mapping.fields.roundOff !== null && !l.roundOffLedgerId) {
    push(
      SHEET_SCOPE,
      null,
      "UNMAPPED_LEDGER",
      "warning",
      "A round-off column is mapped but no round-off ledger is chosen."
    );
  }
}
