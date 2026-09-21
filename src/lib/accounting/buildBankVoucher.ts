import type {
  BillRefType,
  LedgerGroup,
  LineRole,
  VoucherDraft,
  VoucherLineInput,
  VoucherType,
} from "./types";
import { BILL_WISE_GROUPS } from "./types";
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

  /**
   * The counter-ledger's group, when the caller knows it.
   *
   * This is what tells a payment to a supplier apart from a payment of the
   * electricity bill, and the two must post differently. A Sundry Creditors /
   * Sundry Debtors ledger is written to Tally with `ISBILLWISEON=Yes`, so every
   * entry against it has to say which bill it touches. Without this field the
   * builder cannot tell, so it did what it always did — called the line an
   * ITEM, emitted no allocation, and let Tally park the money On Account while
   * the invoice it was paying stayed 100% outstanding.
   *
   * Optional because it is genuinely unknown on some paths (an expense ledger
   * chosen by rule carries no group in the row), and omitting it reproduces the
   * old behaviour exactly rather than guessing.
   */
  ledgerGroup?: LedgerGroup | null;

  /**
   * The bill this allocation settles, when the accountant has named one.
   *
   * Present ⇒ `Agst Ref` against that reference, which is what actually knocks
   * the invoice down. Absent ⇒ `On Account`, see `billTypeFor` below.
   */
  billRefName?: string | null;
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

/**
 * Is this counter-ledger one Tally is ageing?
 *
 * `BILL_WISE_GROUPS` is the same set that decides `ISBILLWISEON` on the ledger
 * master, deliberately shared rather than restated — a ledger Tally ages and a
 * voucher line that names no bill against it is precisely the bug this answers.
 */
function isPartyLedger(group: LedgerGroup | null | undefined): boolean {
  return !!group && BILL_WISE_GROUPS.has(group);
}

/**
 * What a bank line says about the bill it touches.
 *
 * `Agst Ref` when the accountant named the bill: that is a real settlement and
 * Tally reduces the outstanding by this amount.
 *
 * `On Account` when nobody did — and this is the deliberate part. It is not a
 * placeholder or a degraded mode; it is the *same posting Tally already makes*
 * for an unallocated entry on a bill-wise ledger, written down explicitly
 * instead of left to be inferred from an absent tag. Stating it buys two
 * things: the voucher we send is the voucher Tally holds, so a diff between
 * them means something; and an On Account balance is visible and settleable in
 * Tally's Bill-wise Details, whereas the silence we used to send looked like a
 * complete allocation to anyone reading our XML.
 */
function billTypeFor(billRefName: string | null): BillRefType {
  return billRefName ? "Agst Ref" : "On Account";
}

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

  /**
   * The counter-ledger side, and the fix for the ageing bug.
   *
   * Every allocation used to be an ITEM, which is right for rent, salaries and
   * the phone bill and wrong for the case that matters most: paying a supplier.
   * A Sundry Creditors ledger is bill-wise in Tally, so an entry against it that
   * names no bill is parked On Account — the invoice stays fully outstanding and
   * an unapplied payment sits next to it, in every ageing report and every
   * supplier statement the firm sends out. Only the *ledger's group* can tell
   * the two cases apart, which is why `BankAllocation` now carries it.
   *
   * A party allocation is therefore given the PARTY role (so `exportXml` treats
   * it as one) plus an explicit bill type. Anything else is untouched: an
   * expense ledger is not aged, and a `BILLALLOCATIONS.LIST` on one is rejected
   * by Tally outright.
   */
  const lines: VoucherLineInput[] = allocations.map((a) => {
    const party = isPartyLedger(a.ledgerGroup);
    const billRefName = a.billRefName?.trim() || null;
    const role: LineRole = party ? "PARTY" : "ITEM";

    return {
      role,
      ledgerId: a.ledgerId,
      ledgerName: a.ledgerName,
      amount: a.amount,
      side: otherSide,
      confidence: a.confidence ?? null,
      mappedVia: null,
      ...(party
        ? {
            billRefType: billTypeFor(billRefName),
            // Null for On Account: there is no bill, and naming one would
            // invent a reference Tally would then dutifully open.
            billRefName,
          }
        : {}),
    };
  });

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

  /**
   * Re-attach the allocations the shared assembler does not carry.
   *
   * `buildVoucherFromLines` copies each draft line field by field and knows
   * nothing about bills — that ignorance is why a journal, a bill and a bank row
   * can share it — so the allocation is matched back on here.
   *
   * `sortOrder` is the index into the input array (it is assigned in order over
   * the lines that survive, and every allocation survives: each was already
   * required to exceed EPSILON). Role and ledger are still checked, because a
   * silently mismatched pairing would put a supplier's bill reference on the
   * electricity account, which is worse than no allocation at all.
   */
  const allocatedLines = draft.lines.map((l) => {
    const source = lines[l.sortOrder];
    if (!source?.billRefType) return l;
    if (source.role !== l.role || source.ledgerId !== l.ledgerId) return l;
    return {
      ...l,
      billRefType: source.billRefType,
      billRefName: source.billRefName ?? null,
    };
  });

  return { draft: { ...draft, lines: allocatedLines }, errors: [] };
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
