import type {
  VoucherDraft,
  VoucherInput,
  VoucherLineDraft,
  VoucherLineInput,
} from "./types";

/**
 * The one place a voucher is assembled.
 *
 * Everything that posts to Tally comes through here: a scanned bill, a
 * spreadsheet row, a journal, a bank transaction. The input is a flat ordered
 * list of `(ledger, amount, Dr/Cr)` lines and nothing else — no notion of
 * subtotal, tax or party.
 *
 * That shape is deliberate. The previous core took an *invoice*
 * (`subtotal`/`cgst`/`sgst`/`igst`/`total` + items), which can express a
 * purchase and a sale and nothing else. A journal names its own ledger and side
 * per row; a bank payment is a bank ledger against an arbitrary counter-ledger;
 * a wide multi-rate spreadsheet is several taxable lines at different rates.
 * None of those fit an invoice, so each would have needed its own builder and
 * its own rounding, ordering and balance rules to drift apart. Modelling the
 * lines directly makes them all the same problem.
 *
 * `buildVoucher` is now a thin adapter over this for the invoice case.
 */

/** Money is compared and summed in paise; floats do not survive a balance check. */
const toPaise = (n: number): number => Math.round((n || 0) * 100);
const toRupees = (p: number): number => Math.round(p) / 100;

export interface BuildLinesOptions {
  /** Rounding tolerance in rupees before a warning is raised (default ₹1). */
  roundingTolerance?: number;
}

export function buildVoucherFromLines(
  input: VoucherInput,
  opts: BuildLinesOptions = {}
): VoucherDraft {
  const tolerancePaise = toPaise(opts.roundingTolerance ?? 1.0);

  const lines: VoucherLineDraft[] = [];
  const warnings: string[] = [];
  let sort = 0;

  for (const l of input.lines) {
    const paise = toPaise(l.amount);
    // A zero line is not an error, it is an absence — an invoice with no
    // discount should not carry an empty discount line into Tally.
    if (paise <= 0) continue;
    const amount = toRupees(paise);
    lines.push({
      ledgerId: l.ledgerId || null,
      ledgerNameSnapshot: l.ledgerName ?? null,
      role: l.role,
      debit: l.side === "DR" ? amount : 0,
      credit: l.side === "DR" ? 0 : amount,
      confidence: l.confidence ?? null,
      mappedVia: l.mappedVia ?? null,
      hsnCode: l.hsnCode ?? null,
      gstRate: l.gstRate ?? null,
      // Carried through untouched. The rate is derived here only when a sheet
      // gave a quantity and no rate, so Tally does not display a zero.
      stockItemId: l.stockItemId ?? null,
      stockItemName: l.stockItemName ?? null,
      quantity: l.quantity ?? null,
      unit: l.unit ?? null,
      rate:
        l.rate ??
        (l.quantity && l.quantity !== 0 ? amount / l.quantity : null),
      sortOrder: sort++,
    });
  }

  /**
   * Any line without a ledger blocks approval — not just the party and item
   * lines, which is all the old builder checked.
   *
   * Measured consequence of the narrower check: a voucher whose CGST and SGST
   * ledgers resolved to nothing was reported as fully mapped, posted, and came
   * back from Tally as `Ledger 'Unknown' does not exist!` — naming a ledger
   * nobody had chosen, because the XML writer substitutes "Unknown" for a null
   * snapshot. A tax line with no ledger is exactly as unpostable as a party
   * line with no ledger.
   */
  const hasUnmapped = lines.some((l) => !l.ledgerId);

  // Balance. The residual is real — GST rounding rarely lands exactly — so it
  // is posted rather than hidden, and flagged when it is too large to be
  // rounding at all.
  const debitPaise = lines.reduce((s, l) => s + toPaise(l.debit), 0);
  const creditPaise = lines.reduce((s, l) => s + toPaise(l.credit), 0);
  const diff = debitPaise - creditPaise; // +ve => short of credit

  let roundOff = 0;
  if (diff !== 0) {
    if (Math.abs(diff) > tolerancePaise) {
      warnings.push(
        `Rounding difference of ₹${toRupees(Math.abs(diff)).toFixed(2)} exceeds tolerance — check the amounts.`
      );
    }
    lines.push({
      ledgerId: input.roundOffLedgerId || null,
      ledgerNameSnapshot: input.roundOffLedgerName ?? null,
      role: "ROUND_OFF",
      debit: diff < 0 ? toRupees(Math.abs(diff)) : 0,
      credit: diff < 0 ? 0 : toRupees(Math.abs(diff)),
      confidence: null,
      mappedVia: "DEFAULT",
      hsnCode: null,
      gstRate: null,
      sortOrder: sort++,
    });
    roundOff = toRupees(diff);
  }

  const totalDebit = toRupees(lines.reduce((s, l) => s + toPaise(l.debit), 0));
  const totalCredit = toRupees(lines.reduce((s, l) => s + toPaise(l.credit), 0));

  return {
    voucherType: input.voucherType,
    date: input.date,
    narration: input.narration ?? null,
    lines,
    totalDebit,
    totalCredit,
    roundOff,
    hasUnmapped,
    warnings,
  };
}

/**
 * Sum a set of lines per side, for callers that need to check a balance before
 * committing to building anything — the spreadsheet journal validator, mostly.
 */
export function sumSides(lines: VoucherLineInput[]): { debit: number; credit: number } {
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const p = toPaise(l.amount);
    if (p <= 0) continue;
    if (l.side === "DR") dr += p;
    else cr += p;
  }
  return { debit: toRupees(dr), credit: toRupees(cr) };
}
