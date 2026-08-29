"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { TallySyncState, VoucherSync } from "@/components/tallyClient";

/**
 * The four states a voucher can be in, rendered the same way everywhere.
 *
 * FAILED is a button rather than a chip because Tally's rejection reason is
 * the most valuable string in the product — `Ledger 'Acme Traders' does not
 * exist!` — and it must reach the user verbatim, not as a paraphrase and not
 * via an All Exceptions report inside Tally.
 */
const TONE: Record<TallySyncState, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-slate-100 text-slate-600" },
  SENDING: { label: "Sending", className: "bg-amber-100 text-amber-700" },
  POSTED: { label: "Posted", className: "bg-emerald-100 text-emerald-700" },
  FAILED: { label: "Failed", className: "bg-red-100 text-red-700 hover:bg-red-200" },
  DELETED: { label: "Deleted", className: "bg-slate-100 text-slate-500" },
};

const HINT: Record<TallySyncState, string> = {
  QUEUED: "Waiting for the connector to pick it up",
  SENDING: "The connector has it and is talking to Tally",
  POSTED: "In Tally's books",
  FAILED: "Tally rejected it — click for the reason",
  DELETED: "Removed from Tally's books",
};

const chip = "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold";

export function TallySyncBadge({ sync }: { sync: VoucherSync | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!sync) return null;

  const tone = TONE[sync.state] ?? TONE.QUEUED;

  if (sync.state === "FAILED") {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)} className={`${chip} ${tone.className}`} title={HINT.FAILED}>
          <AlertTriangle className="h-3 w-3" /> {tone.label}
        </button>
        {open && <TallyFailureDialog sync={sync} onClose={() => setOpen(false)} />}
      </>
    );
  }

  // Tally replaces the voucher number we send with its own auto-numbering, so
  // the number it hands back is the only one that will find the voucher again.
  const title =
    sync.state === "POSTED" && sync.tallyVoucherNumber
      ? `Tally voucher no. ${sync.tallyVoucherNumber}`
      : HINT[sync.state] ?? "";

  return (
    <span className={`${chip} ${tone.className}`} title={title}>
      {tone.label}
    </span>
  );
}

export function TallyFailureDialog({ sync, onClose }: { sync: VoucherSync; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 p-4 pt-[14vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-white shadow-2xl animate-in zoom-in-95 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b bg-red-50 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div>
              <h2 className="text-sm font-semibold text-red-900">Tally rejected this voucher</h2>
              <p className="text-xs text-red-800">Its own words, unedited.</p>
            </div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded p-1 text-red-500 hover:bg-red-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <pre className="whitespace-pre-wrap break-words rounded-lg border bg-slate-50 p-3 font-mono text-xs text-slate-800">
            {sync.error?.trim() || "Tally rejected the voucher without giving a reason. That normally means the voucher is unbalanced, or Tally is running in education mode."}
          </pre>
          <p className="text-xs text-gray-500">
            Fix the cause here and push again — the voucher keeps the same id in Tally, so a
            re-push alters it rather than creating a duplicate.
          </p>
        </div>
      </div>
    </div>
  );
}
