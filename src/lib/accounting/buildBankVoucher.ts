import type { VoucherDraft, VoucherLineInput, VoucherType } from "./types";
import { buildVoucherFromLines } from "./buildVoucherLines";

/**
 * Bank statement line -> Payment / Receipt / Contra voucher.
 *
 * Until now `BankTxn` rows were inert: they carried a classification and a
 * chosen ledger, but nothing turned them into a voucher, so no bank data could
 * ever reach Tally. This is the missing half.
 *
 * The shape is always the same — the bank ledger on one side, one or more
 * counter-ledgers on the other — which is exactly what the flat line model
 * expresses and what the invoice-shaped builder could not.
 *
 *   withdrawal  -> Payment  : Dr counter-ledger(s), Cr bank
 *   deposit     -> Receipt  : Dr bank,              Cr counter-ledger(s)
 *   transfer    -> Contra   : same sides, different voucher type
 *
 * Contra is not inferred from the amount — it is the accountant's call, because
 * a transfer between two of the firm's own accounts is indistinguishable from
 * an ordinary payment by looking at one side of it.
 */

export interface BankAllocation {
  ledgerId: string | null;
  ledgerName: string | null;
  /** Positive. Several allocations split one statement line across ledgers. */
  amount: number;
  confidence?: number | null;
}

export interface BankVoucherInput {
  date: Date;
  /** The statement's own bank ledger, bound once per statement, not per row. */
  bankLedgerId: string | null;
  bankLedgerName: string | null;
  /** Money out. Exactly one of withdrawal/deposit is non-zero. */
  withdrawal: number;
  /** Money in. */
  deposit: number;
  allocations: BankAllocation[];
  narration?: string | null;
  /** Override the direction-derived type — the only way to get a Contra. */
  voucherTypeOverride?: Extract<VoucherType, "PAYMENT" | "RECEIPT" | "CONTRA">;
}

/** Under half a paisa is zero, matching the tolerance used elsewhere. */
const EPSILON = 0.005;

export interface BankVoucherResult {
  draft: VoucherDraft | null;
  /** Why nothing was built. Empty when `draft` is present. */
  errors: string[];
}

export function buildBankVoucher(input: BankVoucherInput): BankVoucherResult {
  const errors: string[] = [];

  const withdrawal = Math.max(0, input.withdrawal || 0);
  const deposit = Math.max(0, input.deposit || 0);

  if (withdrawal > EPSILON && deposit > EPSILON) {
    errors.push(
      "This line has both a withdrawal and a deposit. A statement row is one or the other; check the column mapping."
    );
  }
  const amount = withdrawal > EPSILON ? withdrawal : deposit;
  if (amount <= EPSILON) {
    errors.push("This line has no amount, so there is nothing to post.");
  }

  const isOutflow = withdrawal > EPSILON;
  const voucherType: VoucherType =
    input.voucherTypeOverride ?? (isOutflow ? "PAYMENT" : "RECEIPT");

  const allocations = input.allocations.filter((a) => (a.amount || 0) > EPSILON);
  if (!allocations.length) {
    errors.push("No ledger has been chosen for this line.");
  }

  /**
   * Splits must account for the whole line.
   *
   * Tally would accept a voucher we balanced with a round-off plug, and the
   * books would be quietly wrong — the plug would absorb whatever the user
   * failed to allocate. So a mismatch is refused here rather than balanced
   * away, which is also what the competitor does on its split-ledger screen.
   */
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (allocations.length && Math.abs(allocated - amount) > EPSILON) {
    errors.push(
      `The split amounts total ₹${allocated.toFixed(2)} but the transaction is ₹${amount.toFixed(2)}. They must match exactly.`
    );
  }

  if (errors.length) return { draft: null, errors };

  // The bank side takes the opposite side to the allocations: money leaving the
  // account credits the bank, money arriving debits it.
  const bankSide: "DR" | "CR" = isOutflow ? "CR" : "DR";
  const otherSide: "DR" | "CR" = isOutflow ? "DR" : "CR";

  const lines: VoucherLineInput[] = allocations.map((a) => ({
    role: "ITEM",
    ledgerId: a.ledgerId,
    ledgerName: a.ledgerName,
    amount: a.amount,
    side: otherSide,
    confidence: a.confidence ?? null,
    mappedVia: null,
  }));

  lines.push({
    role: "BANK",
    ledgerId: input.bankLedgerId,
    ledgerName: input.bankLedgerName,
    amount,
    side: bankSide,
    mappedVia: "DEFAULT",
  });

  const draft = buildVoucherFromLines({
    voucherType,
    date: input.date,
    narration: input.narration ?? null,
    lines,
    // Deliberately no round-off ledger. The allocations were already required
    // to total the transaction exactly, so a residual here would mean a bug,
    // and a nameless plug line is not the way to find out about it.
  });

  return { draft, errors: [] };
}

/**
 * The direction a statement line implies, before the accountant overrides it.
 *
 * Contra never appears here: telling a transfer between the firm's own accounts
 * apart from an ordinary payment needs knowledge of the other account, which a
 * single statement line does not carry.
 */
export function defaultBankVoucherType(
  withdrawal: number,
  deposit: number
): "PAYMENT" | "RECEIPT" | null {
  if ((withdrawal || 0) > EPSILON) return "PAYMENT";
  if ((deposit || 0) > EPSILON) return "RECEIPT";
  return null;
}
