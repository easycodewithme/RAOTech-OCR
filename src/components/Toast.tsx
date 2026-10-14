"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: string;
  message: string;
  kind: ToastKind;
};

type ToastContextValue = {
  toast: (message: string, kind?: ToastKind) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * How long a non-error toast stays. Errors get no timer at all — see below.
 */
const DISMISS_MS = 3500;

/**
 * Success and info are disposable, so only the last few are worth keeping on
 * screen. Errors are not disposable and are capped much higher: the cap exists
 * to stop a retry loop from filling the viewport, not to tidy them away.
 */
const MAX_TRANSIENT = 4;
const MAX_ERRORS = 5;

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: (message: string) => {
        if (typeof window !== "undefined") console.info("[toast]", message);
      },
    };
  }
  return ctx;
}

/**
 * One toast, owning its own dismissal clock.
 *
 * The timer lives here rather than in the provider because it has to be
 * pausable per toast: a firm owner who moves the pointer over a message to
 * read it should not have it vanish mid-sentence, and someone tabbing to the
 * dismiss button should not lose the button under their finger. The elapsed
 * time is banked on pause, so hovering shortens nothing and restarts nothing.
 */
function ToastRow({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(DISMISS_MS);
  const startedRef = useRef(0);

  // Errors never enter this effect's timing branch. An error that disappears
  // after three and a half seconds, with no history anywhere to read it back
  // from, is a failure the user is told about and then cannot investigate —
  // and the failures this app reports are things like "Tally rejected the
  // voucher", which nobody should have to catch on the first pass.
  const isError = item.kind === "error";

  useEffect(() => {
    if (isError || paused) return;
    startedRef.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(item.id), remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedRef.current));
    };
  }, [isError, paused, item.id, onDismiss]);

  const tone = isError
    ? { border: "border-red-500/45", icon: "text-red-500" }
    : item.kind === "success"
      ? { border: "border-emerald-500/40", icon: "text-emerald-600" }
      : { border: "border-[var(--spx-border)]", icon: "text-sky-600" };

  const Icon = isError ? AlertTriangle : item.kind === "success" ? CheckCircle2 : Info;

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-lg border ${tone.border} bg-[var(--spx-card)] px-3 py-2.5 text-sm text-[var(--spx-text)] shadow-lg duration-200 animate-in slide-in-from-bottom-2 fade-in motion-reduce:animate-none motion-reduce:duration-0`}
      // Pointer and keyboard both pause: focus moving into the toast is the
      // keyboard equivalent of hovering it.
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden="true" />
      <p className="flex-1 py-1.5 leading-snug">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        // -m-2 keeps the hit area at 44px without stretching a two-line toast.
        className="-m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--spx-muted)] transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] hover:text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
        onClick={() => onDismiss(item.id)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => {
      const next = [...prev, { id, message, kind }];
      // Trimmed per kind rather than off the front of one list, so a burst of
      // "saved" toasts can never push an unread error off the screen.
      const keptErrors = next.filter((t) => t.kind === "error").slice(-MAX_ERRORS);
      const keptTransient = next.filter((t) => t.kind !== "error").slice(-MAX_TRANSIENT);
      const keep = new Set([...keptErrors, ...keptTransient].map((t) => t.id));
      return next.filter((t) => keep.has(t.id));
    });
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  const errors = items.filter((t) => t.kind === "error");
  const transient = items.filter((t) => t.kind !== "error");

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 md:px-0">
        {/* Two regions rather than one, because the two kinds of message want
            different urgency. Both are mounted even when empty: a live region
            has to exist before content lands in it, or a screen reader has
            nothing to watch and the first message of a session goes unread.

            Errors are assertive — they interrupt, because they report something
            that did not reach the client's books. Everything else is polite and
            waits for a gap in whatever is being read. */}
        {/* aria-atomic="false" on both: role="alert" and role="status" default
            it to true, which would re-read every error still on screen each
            time a new one arrives. Only the message that just appeared is
            news. */}
        <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2">
          {errors.map((t) => (
            <ToastRow key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2">
          {transient.map((t) => (
            <ToastRow key={t.id} item={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}
