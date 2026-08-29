"use client";

import type { TallySyncState, VoucherSync } from "@/components/tallyClient";

/**
 * Browser-side view of `/api/bank`.
 *
 * Every mutation here is a bulk one, even when the grid sent a single row.
 * That is not generality for its own sake: the way this screen is used is
 * "filter to the forty rows whose narration says BANK CHARGES, tick them all,
 * send them all to one ledger, save" — and an API shaped one-row-at-a-time
 * turns that into forty round trips and forty chances to half-apply.
 */

export type BankRowState = "blank" | "unsaved" | "saved" | "pushed" | "failed";

export const ROW_STATE_LABELS: Record<BankRowState, string> = {
  blank: "Blank",
  unsaved: "Unsaved",
  saved: "Saved",
  pushed: "Pushed",
  failed: "Failed",
};

export interface BankAllocationRow {
  ledgerId: string | null;
  ledgerName: string | null;
  amount: number;
}

export interface BankTxnRow {
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
  allocations: BankAllocationRow[];
  saved: boolean;
  savedAt: string | null;
  voucherId: string | null;
  sync: VoucherSync | null;
  state: BankRowState;
}

export interface BankStatementHeader {
  id: string;
  fileName: string;
  bankName: string | null;
  accountNumber: string | null;
  status: string;
  bankLedgerId: string | null;
  bankLedgerName: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  balanceOk: boolean | null;
  balanceNote: string | null;
}

/** Mirrors `StatementBalanceCheck` in src/lib/bank/bankVouchers.ts. */
export interface BankBalanceCheck {
  ok: boolean;
  checked: boolean;
  note: string;
  firstBreakTxnId: string | null;
  firstBreakRow: number | null;
  openingBalance: number | null;
  closingBalance: number | null;
  computedClosing: number;
}

export interface BankTxnsResponse {
  statement: BankStatementHeader;
  balance: BankBalanceCheck;
  counts: Record<BankRowState, number>;
  total: number;
  txns: BankTxnRow[];
}

export interface BankFilters {
  states: BankRowState[];
  q: string;
  from: string;
  to: string;
  min: string;
  max: string;
  types: string[];
}

export const EMPTY_FILTERS: BankFilters = {
  states: [],
  q: "",
  from: "",
  to: "",
  min: "",
  max: "",
  types: [],
};

export function filtersAreEmpty(f: BankFilters): boolean {
  return (
    !f.states.length &&
    !f.types.length &&
    !f.q.trim() &&
    !f.from &&
    !f.to &&
    !f.min &&
    !f.max
  );
}

export function filterQuery(f: BankFilters): string {
  const qs = new URLSearchParams();
  if (f.states.length) qs.set("filter", f.states.join(","));
  if (f.types.length) qs.set("type", f.types.join(","));
  if (f.q.trim()) qs.set("q", f.q.trim());
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  if (f.min) qs.set("min", f.min);
  if (f.max) qs.set("max", f.max);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/* ------------------------------------------------------------------ rules */

export type BankRuleField = "narration" | "amount" | "type";
export type BankRuleCondition = "contains" | "equals" | "gt" | "lt";

export interface BankRuleRow {
  id: string;
  field: BankRuleField;
  condition: BankRuleCondition;
  value: string;
  /** A name, never an id — that is what makes the list cloneable. */
  ledgerName: string;
  /** Resolved against the current workspace. Null means the rule cannot fire. */
  ledgerId: string | null;
  priority?: number;
  enabled?: boolean;
}

export interface BankRuleSuggestionRow {
  txnId: string;
  ledgerName: string;
  ledgerId: string | null;
  ruleId: string;
}

/* ------------------------------------------------------------------ fetch */

const JSON_HEADERS = { "Content-Type": "application/json" };

export class BankApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "BankApiError";
    this.status = status;
    this.body = body;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      typeof body.error === "string" && body.error
        ? body.error
        : `Request failed (${res.status})`;
    throw new BankApiError(message, res.status, body);
  }
  return body as T;
}

const post = <T>(url: string, payload: unknown) =>
  call<T>(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });

export function fetchBankTxns(
  statementId: string,
  filters: BankFilters
): Promise<BankTxnsResponse> {
  return call<BankTxnsResponse>(
    `/api/bank/statements/${statementId}/txns${filterQuery(filters)}`
  );
}

export function setBankLedger(statementId: string, bankLedgerId: string | null) {
  return post<{ bankLedgerId: string | null; bankLedgerName: string | null; warning?: string }>(
    `/api/bank/statements/${statementId}/ledger`,
    { bankLedgerId }
  );
}

export function assignLedger(statementId: string, txnIds: string[], ledgerId: string) {
  return post<{ updated: number; unsaved: number; warning?: string }>(
    `/api/bank/statements/${statementId}/assign`,
    { txnIds, ledgerId }
  );
}

export function assignSplit(
  statementId: string,
  txnIds: string[],
  allocations: { ledgerId: string; amount: number }[]
) {
  return post<{ updated: number; warning?: string }>(
    `/api/bank/statements/${statementId}/assign`,
    { txnIds, allocations }
  );
}

export function assignClassification(
  statementId: string,
  txnIds: string[],
  classification: "PAYMENT" | "RECEIPT" | "CONTRA"
) {
  return post<{ updated: number }>(`/api/bank/statements/${statementId}/assign`, {
    txnIds,
    classification,
  });
}

export function saveTxns(statementId: string, txnIds: string[], saved = true) {
  return post<{ saved: number; blocked: string[]; learned?: number; warning?: string }>(
    `/api/bank/statements/${statementId}/save`,
    { txnIds, saved }
  );
}

export function editTxns(
  statementId: string,
  updates: { id: string; date?: string | null; description?: string }[]
) {
  return call<{ updated: number; blocked: string[]; warning?: string }>(
    `/api/bank/statements/${statementId}/txns`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ updates }) }
  );
}

export interface BuildResponse {
  built: { txnId: string; voucherId: string; voucherType: string; amount: number }[];
  skipped: { txnId: string; reason: string }[];
  failed: { txnId: string; messages: string[] }[];
  voucherIds: string[];
  jobIds?: string[];
  pushed?: boolean;
}

/**
 * Build only, then hand the voucher ids to the ordinary Tally push.
 *
 * `push: false` is not a downgrade — it is what lets the bank screen reuse
 * `useTallyPush` and `TallySyncOverlay` unchanged, so a bank voucher shows the
 * same grey -> amber -> green -> red, the same verbatim Tally rejection text,
 * and the same connector-offline explanation as an invoice voucher. The route
 * can also queue the push itself for non-interactive callers.
 */
export function buildBankVouchers(statementId: string, txnIds?: string[]) {
  return post<BuildResponse>(`/api/bank/statements/${statementId}/build`, {
    ...(txnIds?.length ? { txnIds } : {}),
    push: false,
  });
}

export function fetchBankRules() {
  return call<{ rules: BankRuleRow[]; unresolved: string[]; durable: boolean }>(
    "/api/bank/rules"
  );
}

export function createBankRule(rule: {
  field: BankRuleField;
  condition: BankRuleCondition;
  value: string;
  ledgerName: string;
}) {
  return post<{ rule: BankRuleRow; warning?: string }>("/api/bank/rules", rule);
}

export function deleteBankRule(ruleId: string) {
  return call<{ success: true }>(`/api/bank/rules/${ruleId}`, { method: "DELETE" });
}

export function applyBankRules(
  statementId: string,
  opts: { dryRun: boolean; txnIds?: string[]; overwrite?: boolean }
) {
  return post<{
    dryRun: boolean;
    applied: number;
    wouldApply?: number;
    suggestions: BankRuleSuggestionRow[];
    unresolved: string[];
    warning?: string;
  }>("/api/bank/rules/apply", { statementId, ...opts });
}

export function cloneBankRules(targetClientId: string, dryRun: boolean) {
  return post<{
    dryRun: boolean;
    target: string;
    ruleCount?: number;
    cloned?: number;
    resolved: { ledgerName: string; ledgerId: string }[];
    unresolved: string[];
    warning?: string;
  }>("/api/bank/rules/clone", { targetClientId, dryRun });
}

/* ----------------------------------------------------------------- format */

export const money = (n: number | null | undefined): string =>
  n == null
    ? "—"
    : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The amount a row is worth: exactly one of the two columns is non-zero. */
export const rowAmount = (t: Pick<BankTxnRow, "withdrawal" | "deposit">): number =>
  t.withdrawal > 0 ? t.withdrawal : t.deposit;

/** `yyyy-mm-dd` for a date input, from the ISO string the API returns. */
export const dateInputValue = (iso: string | null): string =>
  iso ? iso.slice(0, 10) : "";

export const SYNC_TONE: Record<TallySyncState, string> = {
  QUEUED: "text-slate-500",
  SENDING: "text-amber-600",
  POSTED: "text-emerald-600",
  FAILED: "text-red-600",
  DELETED: "text-slate-400",
};
