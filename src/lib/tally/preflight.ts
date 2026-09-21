/**
 * Catch the things Tally rejects on import, before the user pushes.
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
  bookBeginning?: Date;
  bookEnding?: Date;
}

/**
 * Amounts are floats; treat anything under half a paisa as zero.
 *
 * Exported because approval and pre-flight have to be the *same* number, and
 * they were not: the three approve routes used to allow ₹0.01 of drift while
 * this file rejected anything over ₹0.005. A voucher out by ₹0.008 therefore
 * approved happily and then failed pre-flight forever after — it cannot be
 * edited (PATCH requires DRAFT) and nothing un-approves it, so it sat in the
 * client's queue permanently unpushable.
 *
 * The stricter of the two wins by construction: nothing may become APPROVED
 * that this file will later refuse to export. If this ever needs to loosen,
 * loosen it here and only here — every approve route imports this constant, so
 * the two sides cannot drift apart again.
 */
export const BALANCE_EPSILON = 0.005;

/**
 * In-file alias. `src/lib/excel/validate.ts` documents its own AMOUNT_EPSILON
 * as "the same constant and same reasoning as `EPSILON` in
 * `src/lib/tally/preflight.ts`", so the name that reference points at stays.
 */
const EPSILON = BALANCE_EPSILON;

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

    /**
     * A voucher with nothing on it. Blocking, and it has to stay blocking.
     *
     * This was downgraded to a warning at some point so it would not stop a
     * push. What that actually bought was a voucher Tally rejects every time
     * — there is no accounting entry to post — reported back as
     * `Voucher date is missing`, which is Tally's message for a malformed
     * voucher and sends whoever reads it looking at the date. Measured on this
     * database: every VoucherSync in FAILED was an empty voucher, all five
     * carrying that message, while every healthy voucher in the queue posted.
     *
     * Letting it through does not make the push succeed. It converts a clear
     * local sentence into a misleading remote one, which is the exact trade
     * this file exists to prevent.
     *
     * It also escapes UNBALANCED below, because that check is guarded on
     * `live.length > 0` — an empty voucher balances: zero equals zero.
     */
    const live = v.lines.filter((l) => l.debit > EPSILON || l.credit > EPSILON);
    if (live.length === 0) {
      issues.push({
        voucherId: v.id,
        code: "NO_ALLOCATION",
        severity: "error",
        message:
          v.lines.length === 0
            ? "This voucher has no lines at all, so there is nothing to post. Tally rejects it as a malformed voucher and reports a missing date."
            : "Every line is zero, so the voucher has no accounting allocation and Tally has nothing to post.",
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

    const number = (v.invoiceNumber ?? "").trim() || `RAO-${v.id.slice(0, 8)}`;
    if (!number) {
      issues.push({
        voucherId: v.id,
        code: "BLANK_VOUCHER_NUMBER",
        severity: "error",
        message: "Voucher number is blank.",
      });
    }

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
          message: `Voucher dated ${v.date.toISOString().slice(0, 10)} falls outside the company's book period in Tally.`,
        });
      }
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: PreflightIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

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