"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, HelpCircle, X } from "lucide-react";
import type { TallySyncState, VoucherSync } from "@/components/tallyClient";

/**
 * The states a voucher can be in, rendered the same way everywhere.
 *
 * FAILED is a button rather than a chip because Tally's rejection reason is
 * the most valuable string in the product — `Ledger 'Acme Traders' does not
 * exist!` — and it must reach the user verbatim, not as a paraphrase and not
 * via an All Exceptions report inside Tally.
 *
 * SENDING is a button too, but only sometimes. It normally means exactly what
 * it says: a device has the job and is talking to Tally. It means something
 * quite different when the row also carries an `error` — see `isUnconfirmed`.
 */
const TONE: Record<TallySyncState, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  SENDING: { label: "Sending", className: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
  POSTED: { label: "Posted", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  FAILED: {
    label: "Failed",
    className:
      "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900",
  },
  DELETED: { label: "Deleted", className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" },
};

const HINT: Record<TallySyncState, string> = {
  QUEUED: "Waiting for the connector to pick it up",
  SENDING: "The connector has it and is talking to Tally",
  POSTED: "In Tally's books",
  FAILED: "Tally rejected it — click for the reason",
  DELETED: "Removed from Tally's books",
};

const chip =
  "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

/**
 * A voucher whose fate we genuinely do not know.
 *
 * When a connector dies mid-batch it reports a job-level failure with no
 * per-voucher results, so the vouchers it carried are left SENDING with the
 * reason recorded rather than marked FAILED — because some of them are very
 * probably already in the client's books, and calling that a rejection is what
 * makes someone re-key them by hand and create real duplicates.
 *
 * That honesty is only worth anything if the user can read it. A plain amber
 * "Sending" chip that never resolves is a quieter lie than the red one it
 * replaced, so the presence of an `error` on a non-failed row is what promotes
 * the chip to something clickable.
 */
function isUnconfirmed(sync: VoucherSync): boolean {
  return sync.state === "SENDING" && !!sync.error?.trim();
}

export function TallySyncBadge({ sync }: { sync: VoucherSync | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!sync) return null;

  const tone = TONE[sync.state] ?? TONE.QUEUED;

  if (sync.state === "FAILED" || isUnconfirmed(sync)) {
    const unconfirmed = isUnconfirmed(sync);
    const label = unconfirmed ? "Unconfirmed" : tone.label;
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`${chip} ${tone.className}`}
          title={unconfirmed ? "We could not confirm this one — click to see why" : HINT.FAILED}
        >
          {unconfirmed ? <HelpCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {label}
        </button>
        {open && <TallySyncReasonDialog sync={sync} onClose={() => setOpen(false)} />}
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
    <span className={`${chip} ${tone.className} cursor-default`} title={title}>
      {tone.label}
    </span>
  );
}

/**
 * Why a voucher is not where the user expected it to be.
 *
 * One dialog for two outcomes, because they need the same thing — Tally's own
 * words, unedited — and differ only in what the user should do next. A
 * rejection is safe to fix and re-push. An unconfirmed voucher is *not* safe to
 * re-key by hand, and saying so is the entire reason this dialog exists.
 */
export function TallySyncReasonDialog({
  sync,
  onClose,
}: {
  sync: VoucherSync;
  onClose: () => void;
}) {
  const unconfirmed = isUnconfirmed(sync);
  const panelRef = useRef<HTMLDivElement>(null);
  // Focus goes back where it came from on close, or the user is dumped at the
  // top of a long transactions table with no idea which row they just opened.
  const returnTo = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    onClose();
    returnTo.current?.focus?.();
  }, [onClose]);

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);

  const accent = unconfirmed
    ? { border: "border-amber-500/35", wash: "bg-amber-500/[0.07]", text: "text-amber-400" }
    : { border: "border-red-500/35", wash: "bg-red-500/[0.07]", text: "text-red-400" };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 p-4 pt-[14vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tally-sync-reason-title"
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl focus:outline-none motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in"
        style={{
          background: "var(--spx-card)",
          borderColor: "var(--spx-border)",
          color: "var(--spx-text)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`flex items-start justify-between gap-3 border-b ${accent.border} ${accent.wash} px-4 py-3`}
        >
          <div className="flex items-start gap-2">
            {unconfirmed ? (
              <HelpCircle className={`mt-0.5 h-4 w-4 shrink-0 ${accent.text}`} aria-hidden="true" />
            ) : (
              <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${accent.text}`} aria-hidden="true" />
            )}
            <div>
              <h2
                id="tally-sync-reason-title"
                className="text-sm font-semibold"
                style={{ color: "var(--spx-text)" }}
              >
                {unconfirmed
                  ? "We could not confirm this voucher"
                  : "Tally rejected this voucher"}
              </h2>
              <p className="text-xs" style={{ color: "var(--spx-text-secondary)" }}>
                {unconfirmed ? "It may already be in the books." : "Its own words, unedited."}
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="cursor-pointer rounded p-2 transition-colors hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-white/10"
            style={{ color: "var(--spx-muted)" }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <pre
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 font-mono text-xs"
            style={{
              background: "var(--spx-input-bg)",
              borderColor: "var(--spx-border)",
              color: "var(--spx-text)",
            }}
          >
            {sync.error?.trim() ||
              "Tally rejected the voucher without giving a reason. That normally means the voucher is unbalanced, or Tally is running in education mode."}
          </pre>

          {unconfirmed ? (
            <p className="text-xs" style={{ color: "var(--spx-text-secondary)" }}>
              <strong style={{ color: "var(--spx-text)" }}>
                Do not key this into Tally by hand.
              </strong>{" "}
              Check the Day Book first. If it is not there, push again — the voucher keeps the same
              id in Tally, so a re-push alters the existing entry rather than creating a second one.
              Typing it in manually is the one action that cannot be undone from here.
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--spx-text-secondary)" }}>
              Fix the cause here and push again — the voucher keeps the same id in Tally, so a
              re-push alters it rather than creating a duplicate.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The old name, kept so existing imports keep working.
 *
 * `TallySyncOverlay` imports this to render a rejection inline; renaming it
 * there would put a component edit inside a change that is otherwise about
 * what the badge does.
 */
export const TallyFailureDialog = TallySyncReasonDialog;
