import type { LedgerGroup, LedgerType } from "@prisma/client";
import { mapTallyGroup, mapTallyLedgerType } from "../tally/masterSync";
import { normName } from "../accounting/normalize";
import { parseNumericText } from "./normalizeCell";
import type { ParsedSheet, ColumnIndex, CellValue } from "./types";

/**
 * Bulk master upload: a spreadsheet of ledgers or stock items.
 *
 * This is the first hour of every new client. A firm taking on a trader has a
 * chart of accounts and an item list in a sheet already — from the previous
 * accountant, from the client's billing software, from Tally itself — and
 * without this they retype it. Vyapar TaxOne ships it as `Bulk Upload → Ledger`
 * and `Bulk Upload → Item`, and it is the reason their onboarding is an hour
 * rather than a day.
 *
 * Masters reuse the whole spreadsheet pipeline — the same parser, the same
 * header detection, the same review-before-commit — because an arbitrary sheet
 * is an arbitrary sheet whether its rows are invoices or ledgers. What differs
 * is only what a row becomes at the end, which is all this module decides.
 *
 * Two things it deliberately will not do:
 *
 *   - Invent a group. An unrecognised "Under" lands in Current Assets, which is
 *     not a posting default anywhere, so a misfiled ledger shows up under an odd
 *     heading rather than silently becoming the default purchase account.
 *   - Guess a unit. A stock item with no unit is flagged, not defaulted: a base
 *     unit cannot be altered once stock has moved against it, so a wrong guess
 *     here is permanent in the client's books.
 */

export interface MasterFieldMapping {
  name: ColumnIndex | null;
  /** Ledgers: the Tally group ("Under"). */
  group: ColumnIndex | null;
  gstin: ColumnIndex | null;
  /** Stock items: base unit. */
  unit: ColumnIndex | null;
  hsnCode: ColumnIndex | null;
  gstRate: ColumnIndex | null;
  alias: ColumnIndex | null;
  openingBalance: ColumnIndex | null;
  openingQty: ColumnIndex | null;
  openingRate: ColumnIndex | null;
}

export const EMPTY_MASTER_MAPPING: MasterFieldMapping = {
  name: null,
  group: null,
  gstin: null,
  unit: null,
  hsnCode: null,
  gstRate: null,
  alias: null,
  openingBalance: null,
  openingQty: null,
  openingRate: null,
};

export type MasterIssueCode =
  | "MISSING_NAME"
  | "DUPLICATE_IN_SHEET"
  | "ALREADY_EXISTS"
  | "UNKNOWN_GROUP"
  | "MISSING_UNIT"
  | "BAD_GSTIN"
  | "BAD_NUMBER";

export interface MasterIssue {
  row: number;
  code: MasterIssueCode;
  severity: "error" | "warning";
  message: string;
}

export interface LedgerMasterDraft {
  name: string;
  group: LedgerGroup;
  ledgerType: LedgerType;
  gstin: string | null;
  openingBalance: number | null;
  /** The sheet's own words for the group, kept so the review screen can show it. */
  groupSource: string | null;
}

export interface ItemMasterDraft {
  name: string;
  unit: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  alias: string | null;
  openingQty: number | null;
  openingRate: number | null;
}

export interface MasterRow<T> {
  row: number;
  draft: T | null;
  issues: MasterIssue[];
}

export interface MasterMapResult<T> {
  rows: MasterRow<T>[];
  issues: MasterIssue[];
  /** Rows with no blocking issue — what a commit would actually write. */
  committableCount: number;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function cell(row: CellValue[], idx: ColumnIndex | null): string {
  if (idx == null) return "";
  const v = row[idx];
  if (v == null) return "";
  return String(v).trim();
}

function num(row: CellValue[], idx: ColumnIndex | null): number | null {
  if (idx == null) return null;
  const v = row[idx];
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const raw = cell(row, idx);
  if (!raw) return null;
  const n = parseNumericText(raw);
  return n == null || Number.isNaN(n) ? null : n;
}

/**
 * Column guesses for a master sheet.
 *
 * Kept separate from `suggestMapping`, which is built around the invoice field
 * set — party, taxable, tax, total — none of which a chart of accounts has.
 * Feeding a ledger sheet through it produced confident nonsense: "Opening
 * Balance" mapped to the invoice total, "Under" to the party name.
 */
export function suggestMasterMapping(
  headers: string[],
  kind: "LEDGER_MASTER" | "ITEM_MASTER"
): MasterFieldMapping {
  const find = (...patterns: RegExp[]): ColumnIndex | null => {
    for (const p of patterns) {
      const i = headers.findIndex((h) => p.test(String(h ?? "").trim()));
      if (i >= 0) return i;
    }
    return null;
  };

  const mapping: MasterFieldMapping = { ...EMPTY_MASTER_MAPPING };

  // "Name" alone is ambiguous on an item sheet, where "Item Name" and "Unit
  // Name" both match; the specific patterns are tried first for that reason.
  mapping.name =
    kind === "LEDGER_MASTER"
      ? find(/^ledger\s*name$/i, /^ledger$/i, /^party\s*name$/i, /^name$/i, /name/i)
      : find(/^item\s*name$/i, /^stock\s*item/i, /^product\s*name$/i, /^item$/i, /^name$/i, /name/i);

  mapping.gstin = find(/^gstin$/i, /gstin/i, /gst\s*no/i, /^gst\s*number$/i);
  mapping.alias = find(/^alias$/i, /alias/i, /short\s*name/i);

  if (kind === "LEDGER_MASTER") {
    mapping.group = find(/^under$/i, /^group$/i, /^parent$/i, /under/i, /group/i);
    mapping.openingBalance = find(/^opening\s*balance$/i, /opening/i);
  } else {
    mapping.unit = find(/^unit$/i, /^uom$/i, /base\s*unit/i, /unit/i);
    mapping.hsnCode = find(/^hsn$/i, /hsn/i, /sac/i);
    mapping.gstRate = find(/^gst\s*rate$/i, /^tax\s*rate$/i, /gst\s*%/i, /rate\s*%/i, /^gst$/i);
    mapping.openingQty = find(/opening\s*qty/i, /opening\s*quantity/i, /^qty$/i);
    mapping.openingRate = find(/opening\s*rate/i, /^rate$/i, /^price$/i);
  }

  return mapping;
}

/** Rows -> ledger master drafts, with everything wrong about them named. */
export function mapLedgerMasters(
  parsed: ParsedSheet,
  mapping: MasterFieldMapping,
  opts: { existingNames?: string[] } = {}
): MasterMapResult<LedgerMasterDraft> {
  const existing = new Set((opts.existingNames ?? []).map((n) => normName(n)).filter(Boolean));
  const seen = new Set<string>();
  const rows: MasterRow<LedgerMasterDraft>[] = [];
  const issues: MasterIssue[] = [];

  parsed.rows.forEach((raw, i) => {
    const rowIssues: MasterIssue[] = [];
    const add = (code: MasterIssueCode, severity: "error" | "warning", message: string) => {
      const issue = { row: i, code, severity, message };
      rowIssues.push(issue);
      issues.push(issue);
    };

    const name = cell(raw, mapping.name);
    if (!name) {
      add("MISSING_NAME", "error", "This row has no ledger name.");
      rows.push({ row: i, draft: null, issues: rowIssues });
      return;
    }

    const key = normName(name) ?? name.toLowerCase();
    if (seen.has(key)) {
      add("DUPLICATE_IN_SHEET", "error", `"${name}" appears more than once in this sheet.`);
    }
    seen.add(key);

    // Not an error. Re-uploading a chart to add ten ledgers to it is a normal
    // thing to do, and the commit skips what already exists rather than
    // refusing the file.
    if (existing.has(key)) {
      add("ALREADY_EXISTS", "warning", `"${name}" already exists here and will be skipped.`);
    }

    const groupSource = cell(raw, mapping.group) || null;
    const group = mapTallyGroup(groupSource);
    if (groupSource && group === "CURRENT_ASSETS" && !/current\s*asset/i.test(groupSource)) {
      add(
        "UNKNOWN_GROUP",
        "warning",
        `"${groupSource}" is not a group we recognise, so "${name}" goes under Current Assets. Change it before committing if that is wrong.`
      );
    }

    const gstinRaw = cell(raw, mapping.gstin).toUpperCase();
    let gstin: string | null = null;
    if (gstinRaw) {
      if (GSTIN_RE.test(gstinRaw)) gstin = gstinRaw;
      else add("BAD_GSTIN", "warning", `"${gstinRaw}" is not a valid GSTIN, so it is left off "${name}".`);
    }

    const openingBalance = num(raw, mapping.openingBalance);
    if (mapping.openingBalance != null && cell(raw, mapping.openingBalance) && openingBalance == null) {
      add("BAD_NUMBER", "warning", `The opening balance for "${name}" is not a number.`);
    }

    rows.push({
      row: i,
      draft: {
        name,
        group,
        ledgerType: mapTallyLedgerType(group, name),
        gstin,
        openingBalance,
        groupSource,
      },
      issues: rowIssues,
    });
  });

  return {
    rows,
    issues,
    committableCount: rows.filter(
      (r) => r.draft && !r.issues.some((x) => x.severity === "error")
    ).length,
  };
}

/** Rows -> stock item master drafts. */
export function mapItemMasters(
  parsed: ParsedSheet,
  mapping: MasterFieldMapping,
  opts: { existingNames?: string[] } = {}
): MasterMapResult<ItemMasterDraft> {
  const existing = new Set((opts.existingNames ?? []).map((n) => normName(n)).filter(Boolean));
  const seen = new Set<string>();
  const rows: MasterRow<ItemMasterDraft>[] = [];
  const issues: MasterIssue[] = [];

  parsed.rows.forEach((raw, i) => {
    const rowIssues: MasterIssue[] = [];
    const add = (code: MasterIssueCode, severity: "error" | "warning", message: string) => {
      const issue = { row: i, code, severity, message };
      rowIssues.push(issue);
      issues.push(issue);
    };

    const name = cell(raw, mapping.name);
    if (!name) {
      add("MISSING_NAME", "error", "This row has no item name.");
      rows.push({ row: i, draft: null, issues: rowIssues });
      return;
    }

    const key = normName(name) ?? name.toLowerCase();
    if (seen.has(key)) {
      add("DUPLICATE_IN_SHEET", "error", `"${name}" appears more than once in this sheet.`);
    }
    seen.add(key);
    if (existing.has(key)) {
      add("ALREADY_EXISTS", "warning", `"${name}" already exists here and will be skipped.`);
    }

    /**
     * A missing unit blocks the row rather than defaulting to "Nos".
     *
     * Tally will not let a base unit be altered once stock has moved against
     * the item, so a guess here is not a guess the accountant can take back —
     * it is a permanent wrong unit on a client's master, and the quantities
     * that accumulate under it are wrong by whatever the real unit was.
     */
    const unit = cell(raw, mapping.unit) || null;
    if (!unit) {
      add(
        "MISSING_UNIT",
        "error",
        `"${name}" has no unit. Tally cannot change an item's base unit once stock has moved against it, so this is not something to guess at — set it in the sheet.`
      );
    }

    const gstRate = num(raw, mapping.gstRate);
    const openingQty = num(raw, mapping.openingQty);
    const openingRate = num(raw, mapping.openingRate);

    rows.push({
      row: i,
      draft: {
        name,
        unit,
        hsnCode: cell(raw, mapping.hsnCode).replace(/\s+/g, "") || null,
        gstRate,
        alias: cell(raw, mapping.alias) || null,
        openingQty,
        openingRate,
      },
      issues: rowIssues,
    });
  });

  return {
    rows,
    issues,
    committableCount: rows.filter(
      (r) => r.draft && !r.issues.some((x) => x.severity === "error")
    ).length,
  };
}
