import type { Prisma, PrismaClient } from "@prisma/client";
import {
  buildBankVoucher,
  type BankAllocation,
} from "../accounting/buildBankVoucher";
import type { VoucherDraft } from "../accounting/types";

/**
 * Statement lines -> real `Voucher` rows.
 *
 * `buildBankVoucher` already knows how to turn one line into a balanced
 * Payment / Receipt / Contra draft, and it has been checked against a live
 * TallyPrime. Nothing in here re-does that arithmetic. This module is the
 * persistence and re-runnability layer around it: which rows are eligible, how
 * a built voucher is written down, and how running the build a second time
 * cannot produce a second voucher.
 *
 * Once a row has become a `Voucher` it stops being a bank thing. It is pushed,
 * tracked, retried and deleted by the same `syncJobs.ts` machinery every other
 * voucher uses, shows the same grey -> amber -> green -> red badge, and is
 * addressed in Tally by the same `RAO-<uuid>` REMOTEID. There is deliberately
 * no second pipeline for bank data.
 */

/** Under half a paisa is zero. Same tolerance as `buildBankVoucher`. */
const EPSILON = 0.005;

/* -------------------------------------------------------------- balances */

export interface BalanceCheckTxn {
  id: string;
  date?: Date | null;
  description?: string | null;
  withdrawal: number;
  deposit: number;
  /** The running balance printed on the statement, where the parser found one. */
  balance?: number | null;
}

export interface StatementBalanceCheck {
  /** False only when a contradiction was actually found. */
  ok: boolean;
  /** False when there was nothing to check against — no opening balance. */
  checked: boolean;
  /** One sentence, safe to show verbatim. Names the first row that diverges. */
  note: string;
  /** The row the walk first disagreed with, if any. */
  firstBreakTxnId: string | null;
  /** Its 1-based position, which is how a user reads a statement. */
  firstBreakRow: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Opening plus every deposit minus every withdrawal. */
  computedClosing: number;
}

const money = (n: number): string =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function rowLabel(txn: BalanceCheckTxn, row: number): string {
  const when = txn.date ? txn.date.toISOString().slice(0, 10) : "undated";
  const what = (txn.description ?? "").trim().slice(0, 60) || "(no narration)";
  return `row ${row} (${when}, "${what}")`;
}

/**
 * Walk the statement from its opening balance to its closing balance.
 *
 * This is the cheapest high-trust check a bank import can offer and we did not
 * have it. A parser that drops one row, duplicates a page, or reads a
 * withdrawal into the deposit column produces a statement that looks entirely
 * plausible row by row and is wrong in total — and the accountant finds out
 * after assigning ledgers to three hundred lines, or worse, after posting.
 * Vyapar TaxOne rejects the whole upload on a closing-balance mismatch ("if
 * there is an error in the closing balance, the system will reject the
 * statement to prevent uploading incorrect data",
 * `unsupported-bank-statement-formats.md`).
 *
 * We report rather than reject, and we report *where*. A bare "closing balance
 * does not match" sends the user back to a PDF with no idea which page to look
 * at; naming the first row whose printed running balance disagrees with the
 * arithmetic points straight at the dropped or duplicated line, because that is
 * exactly where the two series separate.
 *
 * Rows are taken in the order given — callers order by `sortOrder`, which is
 * the order they appeared in the file. Re-sorting by date would defeat the
 * check: two entries on the same day are only reconcilable in statement order.
 */
export function validateStatementBalance(
  txns: BalanceCheckTxn[],
  opening: number | null | undefined,
  closing: number | null | undefined
): StatementBalanceCheck {
  const net = txns.reduce(
    (sum, t) => sum + (t.deposit || 0) - (t.withdrawal || 0),
    0
  );

  const base = {
    openingBalance: opening ?? null,
    closingBalance: closing ?? null,
    firstBreakTxnId: null as string | null,
    firstBreakRow: null as number | null,
  };

  if (opening == null) {
    return {
      ...base,
      ok: true,
      checked: false,
      computedClosing: net,
      note:
        closing == null
          ? "This statement carries no opening or closing balance, so the rows cannot be reconciled. Anything the parser dropped will go unnoticed."
          : "This statement has a closing balance but no opening balance, so the rows cannot be walked. Add the opening balance to reconcile it.",
    };
  }

  // Pass one: the printed running balance, row by row. The first row that
  // disagrees is the row the parser got wrong, and everything after it is
  // simply carrying that error forward — so we stop at the first.
  let running = opening;
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i];
    running += (t.deposit || 0) - (t.withdrawal || 0);
    if (t.balance == null) continue;
    const drift = running - t.balance;
    if (Math.abs(drift) > EPSILON) {
      return {
        ...base,
        ok: false,
        checked: true,
        computedClosing: opening + net,
        firstBreakTxnId: t.id,
        firstBreakRow: i + 1,
        note:
          `The running balance breaks at ${rowLabel(t, i + 1)}. ` +
          `Walking from the opening balance of ${money(opening)} gives ${money(running)} there, ` +
          `but the statement prints ${money(t.balance)} — a difference of ${money(Math.abs(drift))}. ` +
          `A row is missing, duplicated, or read into the wrong column at or before that point.`,
      };
    }
  }

  const computedClosing = opening + net;

  if (closing == null) {
    return {
      ...base,
      ok: true,
      checked: true,
      computedClosing,
      note: `Every printed running balance agrees with the rows, but the statement carries no closing balance to finish the check against. The rows add up to ${money(computedClosing)}.`,
    };
  }

  const diff = computedClosing - closing;
  if (Math.abs(diff) > EPSILON) {
    return {
      ...base,
      ok: false,
      checked: true,
      computedClosing,
      note:
        `The rows do not reconcile. Opening ${money(opening)} plus ${txns.length} transactions ` +
        `gives ${money(computedClosing)}, but the statement closes at ${money(closing)} — ` +
        `${money(Math.abs(diff))} ${diff > 0 ? "too much" : "missing"}. ` +
        `No individual row contradicts its printed balance, so the gap is most likely a whole ` +
        `row, or a page, that never made it into the file.`,
    };
  }

  return {
    ...base,
    ok: true,
    checked: true,
    computedClosing,
    note: `Reconciled: ${money(opening)} opening plus ${txns.length} transactions closes at ${money(closing)}, exactly as printed.`,
  };
}

/* ------------------------------------------------------------- building */

/**
 * Raised when the statement itself is not ready, as opposed to one row being
 * wrong. Routes turn this into a 409 — the user has to go and fix something
 * before any row can build.
 */
export class BankStatementNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankStatementNotReadyError";
  }
}

export interface BuildVouchersInput {
  userId: string;
  clientId: string;
  statementId: string;
  /** Restrict to these rows. Omit for every saved row in the statement. */
  txnIds?: string[];
}

export interface BuiltVoucher {
  txnId: string;
  voucherId: string;
  voucherType: string;
  amount: number;
}

export interface SkippedTxn {
  txnId: string;
  reason: string;
}

export interface FailedTxn {
  txnId: string;
  /** `buildBankVoucher`'s own words. Never paraphrase them. */
  messages: string[];
}

export interface BuildVouchersResult {
  built: BuiltVoucher[];
  skipped: SkippedTxn[];
  failed: FailedTxn[];
  /**
   * Every voucher belonging to the requested rows — the ones just built and the
   * ones that already existed. This is what gets handed to the push, so that a
   * re-run of "build and send" re-sends a row whose first push failed instead of
   * quietly doing nothing.
   */
  voucherIds: string[];
}

/** The `BankTxn.allocations` Json, defensively. */
export function parseAllocations(raw: Prisma.JsonValue | null): BankAllocation[] {
  if (!Array.isArray(raw)) return [];
  const out: BankAllocation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const amount = Number(o.amount);
    if (!Number.isFinite(amount) || amount <= EPSILON) continue;
    out.push({
      ledgerId: typeof o.ledgerId === "string" && o.ledgerId ? o.ledgerId : null,
      ledgerName: typeof o.ledgerName === "string" && o.ledgerName ? o.ledgerName : null,
      amount,
    });
  }
  return out;
}

/** The shape of one bank row this module needs; a subset of `BankTxn`. */
interface TxnRow {
  id: string;
  date: Date | null;
  description: string;
  withdrawal: number;
  deposit: number;
  classification: "PAYMENT" | "RECEIPT" | "CONTRA" | null;
  ledgerId: string | null;
  ledgerNameSnapshot: string | null;
  confidence: number | null;
  allocations: Prisma.JsonValue | null;
  saved: boolean;
  voucherId: string | null;
}

function draftAvgConfidence(draft: VoucherDraft): number | null {
  const values = draft.lines
    .map((l) => l.confidence)
    .filter((c): c is number => c != null);
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Build a voucher for every saved, not-yet-built row.
 *
 * Safe to re-run, and it will be: "Save" and "Send to Tally" are separate
 * clicks, a push can fail halfway, and an accountant works down a statement
 * over a session. The guard is `BankTxn.voucherId` — a row carrying one is
 * skipped outright, and the claim that sets it is conditional, so two
 * simultaneous builds cannot both win the same row.
 */
export async function buildVouchersForStatement(
  db: PrismaClient,
  input: BuildVouchersInput
): Promise<BuildVouchersResult> {
  const statement = await db.bankStatement.findFirst({
    where: { id: input.statementId, userId: input.userId, clientId: input.clientId },
    select: {
      id: true,
      bankName: true,
      accountNumber: true,
      bankLedgerId: true,
    },
  });
  if (!statement) throw new BankStatementNotReadyError("Statement not found.");

  /**
   * The bank side is a property of the statement, not of a row.
   *
   * Vyapar TaxOne's version of this error is the literal string
   * "Please Select Bank", and their own documented fix is to export the mapped
   * data to Excel and re-import it into a fresh statement
   * (`please-select-bank-error-in-banking-module.md`) — a destructive
   * workaround for a two-word error message. Refusing early and saying which
   * statement, what the field does and where to set it costs nothing and is the
   * difference between a ten-second fix and losing an afternoon's mapping.
   */
  if (!statement.bankLedgerId) {
    const which =
      [statement.bankName, statement.accountNumber ? `A/C ${statement.accountNumber}` : null]
        .filter(Boolean)
        .join(" ") || "this statement";
    throw new BankStatementNotReadyError(
      `No bank ledger is set for ${which}. Every Payment, Receipt and Contra needs the bank account itself on one side, ` +
        `and a statement row only shows the other side — so nothing can be built until you say which ledger this account is. ` +
        `Choose it at the top of the statement; the ledgers you have already assigned to rows are kept.`
    );
  }

  const txns = (await db.bankTxn.findMany({
    where: {
      statementId: statement.id,
      ...(input.txnIds?.length ? { id: { in: input.txnIds } } : {}),
    },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      date: true,
      description: true,
      withdrawal: true,
      deposit: true,
      classification: true,
      ledgerId: true,
      ledgerNameSnapshot: true,
      confidence: true,
      allocations: true,
      saved: true,
      voucherId: true,
    },
  })) as TxnRow[];

  const result: BuildVouchersResult = {
    built: [],
    skipped: [],
    failed: [],
    voucherIds: [],
  };

  const pending: TxnRow[] = [];
  for (const t of txns) {
    if (t.voucherId) {
      // Already a voucher. Its id still goes into `voucherIds` so a re-push can
      // pick it up, but nothing is rebuilt.
      result.skipped.push({ txnId: t.id, reason: "Already built." });
      result.voucherIds.push(t.voucherId);
      continue;
    }
    if (!t.saved) {
      result.skipped.push({
        txnId: t.id,
        reason: "Not saved yet. Assigning a ledger and saving the row are separate steps.",
      });
      continue;
    }
    pending.push(t);
  }

  if (!pending.length) return result;

  /**
   * Ledger names are re-read here rather than trusted from the row's snapshot.
   *
   * `ledgerNameSnapshot` and the name inside `allocations` were both written
   * when the user picked the ledger, possibly weeks ago, and the name is what
   * ends up in `<LEDGERNAME>` — a stale one is Tally's
   * `Ledger 'X' does not exist!`. The query is also the authorisation check:
   * scoping it to this user and client means a row cannot post against a ledger
   * belonging to another workspace, whatever id it happens to be carrying.
   */
  const wantedIds = new Set<string>([statement.bankLedgerId]);
  for (const t of pending) {
    if (t.ledgerId) wantedIds.add(t.ledgerId);
    for (const a of parseAllocations(t.allocations)) {
      if (a.ledgerId) wantedIds.add(a.ledgerId);
    }
  }
  const ledgers = await db.ledger.findMany({
    where: {
      id: { in: [...wantedIds] },
      userId: input.userId,
      clientId: input.clientId,
    },
    select: { id: true, name: true },
  });
  const ledgerName = new Map(ledgers.map((l) => [l.id, l.name]));

  const bankLedgerName = ledgerName.get(statement.bankLedgerId);
  if (!bankLedgerName) {
    throw new BankStatementNotReadyError(
      "The bank ledger set on this statement no longer exists in this workspace. Pick it again before building vouchers."
    );
  }

  for (const t of pending) {
    const stored = parseAllocations(t.allocations);
    const allocations: BankAllocation[] = stored.length
      ? stored.map((a) => ({
          ledgerId: a.ledgerId,
          ledgerName: a.ledgerId ? ledgerName.get(a.ledgerId) ?? null : a.ledgerName,
          amount: a.amount,
          confidence: t.confidence,
        }))
      : t.ledgerId
        ? [
            {
              ledgerId: t.ledgerId,
              ledgerName: ledgerName.get(t.ledgerId) ?? t.ledgerNameSnapshot,
              amount: (t.withdrawal || 0) > EPSILON ? t.withdrawal : t.deposit,
              confidence: t.confidence,
            },
          ]
        : [];

    const unknown = allocations.filter((a) => !a.ledgerId || !ledgerName.has(a.ledgerId));
    if (unknown.length) {
      result.failed.push({
        txnId: t.id,
        messages: [
          "A ledger on this row does not exist in this workspace any more. Pick it again.",
        ],
      });
      continue;
    }

    if (!t.date) {
      result.failed.push({
        txnId: t.id,
        messages: [
          "This row has no date. Tally rejects an undated voucher outright, so set the date before building.",
        ],
      });
      continue;
    }

    const { draft, errors } = buildBankVoucher({
      date: t.date,
      bankLedgerId: statement.bankLedgerId,
      bankLedgerName,
      withdrawal: t.withdrawal || 0,
      deposit: t.deposit || 0,
      allocations,
      narration: t.description,
      // Contra is never inferred — it only ever gets here because a human said
      // so on the row. See the note in `buildBankVoucher`.
      voucherTypeOverride: t.classification ?? undefined,
    });

    if (!draft) {
      result.failed.push({ txnId: t.id, messages: errors });
      continue;
    }

    const built = await persistBankVoucher(db, {
      userId: input.userId,
      clientId: input.clientId,
      txnId: t.id,
      draft,
    });

    if (!built) {
      // Another build claimed the row between our read and our write. Nothing
      // was created; the winner's voucher is the one that counts.
      result.skipped.push({ txnId: t.id, reason: "Already built." });
      continue;
    }

    result.built.push({
      txnId: t.id,
      voucherId: built,
      voucherType: draft.voucherType,
      amount: draft.totalDebit,
    });
    result.voucherIds.push(built);
  }

  return result;
}

/**
 * Write one draft down as a `Voucher`, and claim the row that produced it.
 *
 * No `Invoice` is involved. `Voucher.invoiceId` is nullable, and a bank row is
 * exactly the case it was made nullable for: there is no bill behind a Payment.
 * An earlier version of this function wrote a synthetic carrier invoice with a
 * `bank://` pseudo-URL, copying the spreadsheet importer's workaround, and that
 * fake bill then appeared in the invoice list, on the pipeline board and in the
 * Tally export as a document with a null vendor and a null number.
 *
 * The two fields that carrier used to leave null are worth restating, because
 * the push path still reads them off the voucher's (now absent) invoice:
 *
 *   vendor        -> `buildVoucherPushPayload` passes it as `partyName`, which
 *                    `exportXml` emits as <PARTYLEDGERNAME>. A bank narration
 *                    there would name a party ledger that does not exist and
 *                    Tally would reject the voucher. Absent is correct.
 *   invoiceNumber -> becomes <VOUCHERNUMBER>. Absent, the exporter falls back
 *                    to `RAO-<id>`, which is stable across re-exports. A bank
 *                    statement has no voucher number to give anyway — the
 *                    competitor says so outright: "As of now we are not
 *                    fetching Voucher Number from the Bank statement".
 */
async function persistBankVoucher(
  db: PrismaClient,
  args: {
    userId: string;
    clientId: string;
    txnId: string;
    draft: VoucherDraft;
  }
): Promise<string | null> {
  const { draft } = args;

  const voucher = await db.voucher.create({
    data: {
      userId: args.userId,
      clientId: args.clientId,
      voucherType: draft.voucherType,
      /**
       * APPROVED, not DRAFT.
       *
       * `/api/tally/push` only picks up APPROVED or EXPORTED_DEMO vouchers, and
       * a bank row has already been through its own approval: the Save gate.
       * The accountant chose the ledger, chose the voucher type, and clicked
       * Save on that specific row. Landing these in DRAFT would mean a second,
       * meaningless approval step in a different screen before anything could
       * post.
       */
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: args.userId,
      date: draft.date,
      narration: draft.narration,
      totalDebit: draft.totalDebit,
      totalCredit: draft.totalCredit,
      roundOff: draft.roundOff,
      avgConfidence: draftAvgConfidence(draft),
      lines: {
        create: draft.lines.map((l) => ({
          ledgerId: l.ledgerId,
          ledgerNameSnapshot: l.ledgerNameSnapshot,
          role: l.role,
          debit: l.debit,
          credit: l.credit,
          confidence: l.confidence,
          mappedVia: l.mappedVia,
          hsnCode: l.hsnCode,
          gstRate: l.gstRate,
          // Always null for a bank row -- a statement line moves money, not
          // stock -- but written through so the shape stays uniform.
          stockItemId: l.stockItemId ?? null,
          stockItemName: l.stockItemName ?? null,
          quantity: l.quantity ?? null,
          unit: l.unit ?? null,
          rate: l.rate ?? null,
          sortOrder: l.sortOrder,
        })),
      },
    },
    select: { id: true },
  });

  // The claim. Conditional on the row still being unbuilt, so a concurrent
  // build loses here rather than in a unique-constraint error, and cleans up
  // after itself. `BankTxn.voucherId` is unique, so this is also the last line
  // of defence against a double post.
  const claimed = await db.bankTxn.updateMany({
    where: { id: args.txnId, voucherId: null },
    data: { voucherId: voucher.id },
  });

  if (claimed.count === 0) {
    await db.voucher.delete({ where: { id: voucher.id } });
    return null;
  }

  return voucher.id;
}
