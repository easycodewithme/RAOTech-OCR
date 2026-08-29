/**
 * Catch the things Tally rejects on import, before the user pushes.
 *
 * Tally's import failures are opaque: the voucher silently does not appear and
 * the reason is buried in Tally.imp or an All Exceptions report. Vyapar TaxOne's
 * own docs list the recurring causes, and every one of these checks maps to one
 * of them:
 *
 *   "Ledger name not found"                 -> UNMAPPED_LEDGER
 *   "Voucher number cannot be left blank"   -> BLANK_VOUCHER_NUMBER
 *   "No accounting allocation"              -> NO_ALLOCATION
 *   "The date is out of range"              -> DATE_OUT_OF_RANGE
 *   "Extra space in the name of ledgers"    -> PADDED_NAME / DOUBLE_SPACED_NAME
 *
 * plus the one Tally will accept but an accountant should not: a voucher whose
 * debits and credits do not agree.
 */

export type PreflightCode =
  | "UNMAPPED_LEDGER"
  | "BLANK_VOUCHER_NUMBER"
  | "NO_ALLOCATION"
  | "UNBALANCED"
  | "DATE_OUT_OF_RANGE"
  | "PADDED_NAME"
  | "DOUBLE_SPACED_NAME";

export interface PreflightIssue {
  voucherId: string;
  code: PreflightCode;
  /** "error" blocks the export; "warning" is worth showing but still pushes. */
  severity: "error" | "warning";
  message: string;
}

export interface PreflightVoucherLine {
  ledgerName: string | null;
  debit: number;
  credit: number;
}

export interface PreflightVoucher {
  id: string;
  date: Date;
  invoiceNumber?: string | null;
  lines: PreflightVoucherLine[];
}

export interface PreflightOptions {
  /**
   * The company's active book period in Tally. A voucher dated outside it is
   * rejected with "The date is out of range! Can't import!". Omit to skip the
   * check — we cannot know the period without reading it from Tally.
   */
  bookBeginning?: Date;
  bookEnding?: Date;
}

/** Amounts are floats; treat anything under half a paisa as zero. */
const EPSILON = 0.005;

function checkName(
  voucherId: string,
  raw: string,
  label: string,
  issues: PreflightIssue[]
) {
  if (raw !== raw.trim()) {
    issues.push({
      voucherId,
      code: "PADDED_NAME",
      severity: "warning",
      message: `${label} "${raw}" has leading or trailing whitespace. It is trimmed on export, but the ledger in Tally must match the trimmed form.`,
    });
  }
  if (/\s{2,}/.test(raw.trim())) {
    issues.push({
      voucherId,
      code: "DOUBLE_SPACED_NAME",
      severity: "warning",
      message: `${label} "${raw.trim()}" contains a double space. Tally matches ledgers exactly — confirm the name is spelled the same way there.`,
    });
  }
}

export function preflightVouchers(
  vouchers: PreflightVoucher[],
  opts: PreflightOptions = {}
): PreflightIssue[] {
  const issues: PreflightIssue[] = [];

  for (const v of vouchers) {
    // "Ledger name not found" — an unmapped line has no ledger to post against.
    for (const l of v.lines) {
      const nm = l.ledgerName?.trim();
      if (!nm) {
        issues.push({
          voucherId: v.id,
          code: "UNMAPPED_LEDGER",
          severity: "error",
          message: "A line has no ledger assigned. Map every line before exporting.",
        });
      } else if (l.ledgerName) {
        checkName(v.id, l.ledgerName, "Ledger", issues);
      }
    }

    // "No accounting allocation" — Tally rejects a voucher with no live entries.
    const live = v.lines.filter((l) => l.debit > EPSILON || l.credit > EPSILON);
    if (live.length === 0) {
      issues.push({
        voucherId: v.id,
        code: "NO_ALLOCATION",
        severity: "error",
        message: "Every line is zero, so the voucher has no accounting allocation.",
      });
    }

    const debit = v.lines.reduce((s, l) => s + l.debit, 0);
    const credit = v.lines.reduce((s, l) => s + l.credit, 0);
    if (live.length > 0 && Math.abs(debit - credit) > EPSILON) {
      issues.push({
        voucherId: v.id,
        code: "UNBALANCED",
        severity: "error",
        message: `Debits (${debit.toFixed(2)}) and credits (${credit.toFixed(2)}) do not agree.`,
      });
    }

    // "Voucher number cannot be left blank" — the exporter falls back to the
    // voucher id, so this only fires if that fallback is ever removed.
    const number = (v.invoiceNumber ?? "").trim() || `RAO-${v.id.slice(0, 8)}`;
    if (!number) {
      issues.push({
        voucherId: v.id,
        code: "BLANK_VOUCHER_NUMBER",
        severity: "error",
        message: "Voucher number is blank.",
      });
    }

    // "The date is out of range! Can't import!"
    if (Number.isNaN(v.date.getTime())) {
      issues.push({
        voucherId: v.id,
        code: "DATE_OUT_OF_RANGE",
        severity: "error",
        message: "Voucher date is invalid.",
      });
    } else {
      const { bookBeginning, bookEnding } = opts;
      const before = bookBeginning && v.date < bookBeginning;
      const after = bookEnding && v.date > bookEnding;
      if (before || after) {
        issues.push({
          voucherId: v.id,
          code: "DATE_OUT_OF_RANGE",
          severity: "error",
          message: `Voucher dated ${v.date.toISOString().slice(0, 10)} falls outside the company's book period in Tally. Widen "Books beginning from" or correct the date.`,
        });
      }
    }
  }

  return issues;
}

/** Convenience: does anything block the export? */
export function hasBlockingIssues(issues: PreflightIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

/** Group issues by voucher for rendering next to each row. */
export function groupByVoucher(
  issues: PreflightIssue[]
): Map<string, PreflightIssue[]> {
  const map = new Map<string, PreflightIssue[]>();
  for (const issue of issues) {
    const list = map.get(issue.voucherId);
    if (list) list.push(issue);
    else map.set(issue.voucherId, [issue]);
  }
  return map;
}
