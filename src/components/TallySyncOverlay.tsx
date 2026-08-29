"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, Loader2, PlugZap, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TallySyncBadge } from "@/components/TallySyncBadge";
import {
  useConnectorStatus,
  type TallyIssue,
  type TallyPush,
  type VoucherSync,
} from "@/components/tallyClient";

/**
 * What a push to Tally actually looks like, while it happens.
 *
 * The previous version of this file animated paper aeroplanes on a timer and
 * said "Synced" whether or not anything had been sent. Every line below is
 * driven by `GET /api/tally/status`: grey until the connector claims the job,
 * amber while it is talking to Tally, then green with Tally's voucher number
 * or red with Tally's own rejection text.
 */
export function TallySyncOverlay({
  push,
  labels = {},
  onClose,
}: {
  push: TallyPush;
  /** voucherId → what the user calls it, e.g. "Acme Traders · INV-204". */
  labels?: Record<string, string>;
  onClose?: () => void;
}) {
  const { state, reset } = push;
  const open = state.phase !== "idle";
  // Only worth asking while the panel is up: a queued push that will not move
  // needs to say why, and "connector offline" is the usual why.
  const { data: connection } = useConnectorStatus({ enabled: open, intervalMs: 10_000 });

  if (!open) return null;

  function close() {
    reset();
    onClose?.();
  }

  const byId = new Map(state.syncs.map((s) => [s.voucherId, s]));
  const total = state.voucherIds.length;
  const done = state.voucherIds.filter((id) => {
    const s = byId.get(id);
    return s && (s.state === "POSTED" || s.state === "FAILED" || s.state === "DELETED");
  }).length;
  const failed = state.syncs.filter((s) => s.state === "FAILED").length;
  const verb = state.mode === "delete" ? "Deleting from Tally" : "Posting to Tally";
  const settled = state.phase === "settled";
  const blocked = state.phase === "blocked";

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-900/60 p-4 pt-[10vh] backdrop-blur-sm">
      <div className="flex max-h-[76vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border bg-white shadow-2xl animate-in zoom-in-95 fade-in">
        <div className="flex items-start justify-between gap-3 border-b bg-gray-50/80 px-4 py-3">
          <div className="flex items-start gap-2">
            {blocked ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            ) : settled ? (
              <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${failed ? "text-amber-600" : "text-emerald-600"}`} />
            ) : (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-gray-500" />
            )}
            <div>
              <h2 className="text-sm font-semibold text-gray-900">
                {blocked
                  ? state.mastersError
                    ? "Master data has not been synced"
                    : "Nothing was sent"
                  : settled
                    ? state.mode === "delete"
                      ? "Delete finished"
                      : failed
                        ? `${total - failed} of ${total} posted`
                        : `${total} voucher${total === 1 ? "" : "s"} in Tally's books`
                    : `${verb} — ${done} of ${total}`}
              </h2>
              {!blocked && (
                <p className="text-xs text-gray-500">
                  {settled
                    ? failed
                      ? "Open a failed row for Tally's own reason."
                      : "Tally assigned its own voucher numbers; hover a badge to see them."
                    : "The connector picks up one voucher at a time, so each row is its own answer."}
                </p>
              )}
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {state.mastersError && <MastersGate message={state.mastersError} />}

          {state.error && !state.mastersError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{state.error}</div>
          )}

          {(state.issues.length > 0 || state.warnings.length > 0) && (
            <PreflightIssues issues={state.issues} warnings={state.warnings} labels={labels} />
          )}

          {!blocked && total > 0 && (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${failed ? "bg-amber-500" : "bg-[#0b6b3a]"}`}
                  style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
                />
              </div>

              {connection && !connection.connectorOnline && !settled && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <PlugZap className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    The connector is offline, so these are queued rather than stuck. They will post
                    as soon as the Rao-Tech connector is running on the Tally machine.
                  </p>
                </div>
              )}

              <ul className="divide-y rounded-lg border">
                {state.voucherIds.map((id) => (
                  <SyncRow key={id} label={labels[id] ?? id.slice(0, 8)} sync={byId.get(id)} />
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-3">
          <Button size="sm" variant={settled && !failed ? "default" : "outline"} onClick={close}>
            {settled ? "Done" : "Close"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SyncRow({ label, sync }: { label: string; sync: VoucherSync | undefined }) {
  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-gray-800">{label}</span>
        {sync ? (
          <TallySyncBadge sync={sync} />
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
            Queued
          </span>
        )}
      </div>
      {sync?.state === "FAILED" && sync.error && (
        <p className="mt-1 break-words font-mono text-xs text-red-700">{sync.error}</p>
      )}
      {sync?.state === "POSTED" && sync.tallyVoucherNumber && (
        <p className="mt-1 text-xs text-gray-400">Tally voucher no. {sync.tallyVoucherNumber}</p>
      )}
    </li>
  );
}

/** 409. The gate is deliberate: without Tally's ledger names read back first,
 *  every voucher would be rejected one at a time for a name mismatch. */
function MastersGate({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p className="font-semibold">{message}</p>
      <p className="mt-1 text-red-800">
        Tally matches ledgers by name, so the workspace has to read its chart of accounts before
        anything can post against it. Run Sync Master once per company.
      </p>
      <Link
        href="/settings/tally"
        className="mt-2 inline-flex items-center gap-1.5 font-medium text-red-700 underline underline-offset-2 hover:text-red-900"
      >
        <Settings2 className="h-3.5 w-3.5" /> Settings → Tally Connection
      </Link>
    </div>
  );
}

/** 422. Errors blocked the push; warnings rode along with it. */
function PreflightIssues({
  issues,
  warnings,
  labels,
}: {
  issues: TallyIssue[];
  warnings: TallyIssue[];
  labels: Record<string, string>;
}) {
  const rows = [...issues, ...warnings];
  if (!rows.length) return null;

  const grouped = new Map<string, TallyIssue[]>();
  for (const issue of rows) {
    const list = grouped.get(issue.voucherId);
    if (list) list.push(issue);
    else grouped.set(issue.voucherId, [issue]);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
      <h3 className="text-sm font-semibold text-amber-900">
        {issues.length ? "Tally would reject this" : "Worth a look before it posts"}
      </h3>
      <p className="mt-0.5 text-xs text-amber-800">
        Caught here, none of these becomes a line in Tally.imp. Errors block the push; warnings do not.
      </p>
      <ul className="mt-2 space-y-2">
        {[...grouped.entries()].map(([voucherId, list]) => (
          <li key={voucherId || "general"} className="rounded-lg bg-white px-3 py-2 text-sm">
            <p className="font-medium text-gray-800">
              {labels[voucherId] ?? (voucherId ? voucherId.slice(0, 8) : "This batch")}
            </p>
            {list.map((issue, i) => (
              <p key={`${issue.code}-${i}`} className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                    issue.severity === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {issue.severity}
                </span>
                <span className="text-gray-700">{issue.message}</span>
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
