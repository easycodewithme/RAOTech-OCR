import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { parseAllocations } from "@/lib/bank/bankVouchers";
import type { TallySyncState } from "@/components/tallyClient";

/**
 * Shared plumbing for the `/api/bank` routes.
 *
 * Not a route itself — the app router only mounts `route.ts`, so a plain module
 * here is safe and keeps five handlers from each growing their own copy of
 * "load the statement, prove it belongs to this workspace, work out what state
 * each row is in".
 */

export interface BankRouteContext {
  userId: string;
  clientId: string;
}

/** Every row a user can act on, in the order they appear in the file. */
export const TXN_SELECT = {
  id: true,
  date: true,
  description: true,
  refNo: true,
  withdrawal: true,
  deposit: true,
  balance: true,
  classification: true,
  confidence: true,
  ledgerId: true,
  ledgerNameSnapshot: true,
  allocations: true,
  saved: true,
  savedAt: true,
  voucherId: true,
  sortOrder: true,
} as const;

export type TxnRecord = Prisma.BankTxnGetPayload<{ select: typeof TXN_SELECT }>;

/**
 * Resolve the caller and the statement in one step, or hand back the response
 * to return. Every `/api/bank` handler starts with this, so ownership is
 * checked in exactly one place: a statement is only ever loaded with both
 * `userId` and `clientId` in the where clause, never by id alone.
 */
export async function requireStatement(statementId: string) {
  const ctx = await getActiveClient();
  if (!ctx) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  const { user, client } = ctx;

  const statement = await prisma.bankStatement.findFirst({
    where: { id: statementId, userId: user.id, clientId: client.id },
    select: {
      id: true,
      fileName: true,
      bankName: true,
      accountNumber: true,
      status: true,
      bankLedgerId: true,
      openingBalance: true,
      closingBalance: true,
      balanceOk: true,
      balanceNote: true,
    },
  });
  if (!statement) {
    return { error: NextResponse.json({ error: "Statement not found" }, { status: 404 }) } as const;
  }

  return { userId: user.id, clientId: client.id, statement } as const;
}

/**
 * The five row states, which are also the five filters.
 *
 * These mirror what the transactions screen already shows for invoice
 * vouchers, and what the competitor exposes as "General Filters" — Blank
 * Records ("entries which are still pending to check"), Saved Records, Hide
 * Tally Synced Records, Failed Records (`using-general-filters-in-sales-purchases.md`).
 * A bank row is on a strictly one-way trip through them, which is why a single
 * derived value is enough and no status column is needed.
 *
 *   blank   -> no ledger chosen at all
 *   unsaved -> a ledger is chosen but the row has not been committed
 *   saved   -> committed, not yet a voucher, or a voucher not yet posted
 *   pushed  -> in Tally's books
 *   failed  -> Tally rejected it, and the reason is on the sync row
 */
export type BankRowState = "blank" | "unsaved" | "saved" | "pushed" | "failed";

export const ROW_STATES: BankRowState[] = ["blank", "unsaved", "saved", "pushed", "failed"];

export function rowState(txn: TxnRecord, syncState: TallySyncState | null): BankRowState {
  if (syncState === "FAILED") return "failed";
  if (syncState === "POSTED") return "pushed";
  if (txn.saved) return "saved";
  const hasLedger = !!txn.ledgerId || parseAllocations(txn.allocations).length > 0;
  return hasLedger ? "unsaved" : "blank";
}

export interface SyncSummary {
  voucherId: string;
  state: TallySyncState;
  error: string | null;
  tallyVoucherNumber: string | null;
  syncedAt: string | null;
}

/**
 * Sync rows for a set of vouchers, newest attempt per voucher.
 *
 * A voucher can carry one `VoucherSync` per Tally company. In practice a
 * workspace has exactly one, but taking the most recent attempt rather than an
 * arbitrary row means a re-registered company cannot make a posted voucher
 * look queued again.
 */
export async function syncsForVouchers(
  voucherIds: string[]
): Promise<Map<string, SyncSummary>> {
  const out = new Map<string, SyncSummary>();
  if (!voucherIds.length) return out;

  const rows = await prisma.voucherSync.findMany({
    where: { voucherId: { in: voucherIds } },
    orderBy: [{ lastAttemptAt: "asc" }, { updatedAt: "asc" }],
    select: {
      voucherId: true,
      state: true,
      error: true,
      tallyVoucherNumber: true,
      syncedAt: true,
    },
  });

  for (const r of rows) {
    out.set(r.voucherId, {
      voucherId: r.voucherId,
      state: r.state as TallySyncState,
      error: r.error,
      tallyVoucherNumber: r.tallyVoucherNumber,
      syncedAt: r.syncedAt ? r.syncedAt.toISOString() : null,
    });
  }
  return out;
}

export interface SerializedTxn {
  id: string;
  date: string | null;
  description: string;
  refNo: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  classification: string | null;
  confidence: number | null;
  ledgerId: string | null;
  ledgerNameSnapshot: string | null;
  allocations: { ledgerId: string | null; ledgerName: string | null; amount: number }[];
  saved: boolean;
  savedAt: string | null;
  voucherId: string | null;
  sync: SyncSummary | null;
  state: BankRowState;
}

export function serializeTxn(
  txn: TxnRecord,
  syncs: Map<string, SyncSummary>
): SerializedTxn {
  const sync = txn.voucherId ? syncs.get(txn.voucherId) ?? null : null;
  return {
    id: txn.id,
    date: txn.date ? txn.date.toISOString() : null,
    description: txn.description,
    refNo: txn.refNo,
    withdrawal: txn.withdrawal,
    deposit: txn.deposit,
    balance: txn.balance,
    classification: txn.classification,
    confidence: txn.confidence,
    ledgerId: txn.ledgerId,
    ledgerNameSnapshot: txn.ledgerNameSnapshot,
    allocations: parseAllocations(txn.allocations).map((a) => ({
      ledgerId: a.ledgerId,
      ledgerName: a.ledgerName,
      amount: a.amount,
    })),
    saved: txn.saved,
    savedAt: txn.savedAt ? txn.savedAt.toISOString() : null,
    voucherId: txn.voucherId,
    sync,
    state: rowState(txn, sync?.state ?? null),
  };
}

/** Body ids, defensively: anything that is not a non-empty string is dropped. */
export function readIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => String(v ?? "").trim()).filter(Boolean))];
}
