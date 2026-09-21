"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A confirm that has room to say what it is about to do. Used where the
 *  consequence lands outside this app — in Tally's books, or on a paired
 *  machine — and a browser confirm() would be too thin to explain it.
 *
 *  Everything below the presentation exists because this dialog guards
 *  irreversible work. Two behaviours in particular:
 *
 *  1. A destructive confirm does NOT close on a backdrop click. This dialog is
 *     what stands between a stray click and vouchers being deleted from a live
 *     client's books; a backdrop covering the whole viewport is the easiest
 *     thing in the window to hit by accident. Escape and Cancel remain, because
 *     both are deliberate. Non-destructive confirms keep backdrop dismiss,
 *     where a mis-click costs nothing.
 *
 *  2. Focus is moved in, kept in, and put back. Without a trap, Tab walks
 *     straight out of a modal into the page behind it, and a keyboard or
 *     screen-reader user ends up operating a screen they cannot see. Restoring
 *     focus to whatever opened the dialog matters just as much: dropping focus
 *     to <body> on close sends the next keystroke nowhere.
 */

/**
 * Deliberately narrow: only what a browser will actually focus. `:not([disabled])`
 * matters because the confirm button is disabled while the action is in flight,
 * and a trap that cycles onto a disabled node loses focus entirely.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus in on open, and hand it back to the trigger on close. Runs once:
  // the element that opened the dialog is whatever was focused at mount.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // The primary action, unless it opened already disabled — focusing a
    // disabled button is a no-op that would leave focus outside the dialog.
    const confirm = confirmRef.current;
    (confirm && !confirm.disabled ? confirm : panelRef.current)?.focus();
    return () => {
      // The trigger can legitimately be gone by now — a row that was deleted,
      // for instance — so only restore focus to something still on the page.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Escape is ignored while the action is running: the request has
        // already left, and closing would only hide what is happening.
        if (busy) return;
        e.preventDefault();
        // Stopped so a parent that also listens for Escape — the ledger picker,
        // the shortcut layer — does not act on the same press.
        e.stopPropagation();
        onCancel();
        return;
      }

      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;

      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !panel.contains(active);

      if (e.shiftKey) {
        if (outside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (outside || active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    // Capture phase, so the dialog sees Escape before whatever is behind it.
    // Resubscribed whenever busy or onCancel changes, which costs a listener
    // swap and keeps the handler free of refs read during render.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onCancel]);

  const onBackdropClick = useCallback(() => {
    if (!destructive) onCancel();
  }, [destructive, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-[var(--spx-overlay)] p-4 pt-[16vh] backdrop-blur-sm"
      onClick={onBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] shadow-2xl outline-none duration-200 animate-in zoom-in-95 fade-in motion-reduce:animate-none motion-reduce:duration-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--spx-border)] px-4 py-3">
          <div className="flex items-start gap-2">
            {destructive && (
              // red-500 rather than red-400: it clears 3:1 against both the
              // white light-theme card and the near-black dark one.
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            )}
            <h2 id={titleId} className="text-sm font-semibold text-[var(--spx-text)]">
              {title}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onCancel}
            disabled={busy}
            // -mr-2/-my-2 keeps the 44px touch target without letting it push
            // the header taller than the title beside it.
            className="-my-2 -mr-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--spx-muted)] transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] hover:text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          id={bodyId}
          className="px-4 py-3 text-sm leading-relaxed text-[var(--spx-text-secondary)]"
        >
          {body}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            size="sm"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 cursor-pointer"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
