"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Clock, Loader2, Send, CheckCircle2 } from "lucide-react";
import type { PortfolioRow } from "@/lib/portfolio";
import { attentionRank } from "@/lib/portfolio";
import { formatCount, formatDate, formatRelative } from "@/lib/format";

/**
 * One row per client, and one sentence per row saying what is wrong.
 *
 * The counts alone would make this a spreadsheet. What an owner needs is the
 * verdict — "three vouchers rejected" — with the numbers there to back it up,
 * so the decision of which client to open takes a glance rather than a
 * comparison.
 *
 * Clicking a row switches the whole app to that client, because every other
 * screen is scoped to the switcher. Landing on a client's dashboard without
 * switching would show the previous client's data under the new client's name,
 * which is the kind of wrong that gets into someone's books.
 *
 * The switch is offered by a real <button> in the first cell rather than by
 * ARIA bolted onto the <tr>. The row keeps its click handler because a whole
 * row is an easier mouse target, but the button is what carries the tab stop,
 * the focus ring and the accessible name — a table row given role="button"
 * stops being a row to a screen reader, which costs the reader the column
 * headers that make the numbers beside it mean anything.
 */

function verdict(r: PortfolioRow): { text: string; tone: "bad" | "warn" | "todo" | "ok" } {
  if (r.failedCount > 0) {
    return {
      text: `${r.failedCount} voucher${r.failedCount === 1 ? "" : "s"} rejected by Tally`,
      tone: "bad",
    };
  }
  if (r.stuckCount > 0) {
    return {
      text: `${r.stuckCount} stuck sending — may or may not be in the books`,
      tone: "warn",
    };
  }
  if (r.unsyncedMasters > 0 && r.readyCount > 0) {
    return {
      text: `${r.readyCount} ready, but ${r.unsyncedMasters} master${
        r.unsyncedMasters === 1 ? "" : "s"
      } not in Tally yet`,
      tone: "warn",
    };
  }
  if (r.readyCount > 0) {
    return { text: `${r.readyCount} approved, waiting to push`, tone: "todo" };
  }
  if (r.needsReviewCount > 0) {
    return { text: `${r.needsReviewCount} need review`, tone: "todo" };
  }
  if (r.draftCount > 0) {
    return { text: `${r.draftCount} draft${r.draftCount === 1 ? "" : "s"}`, tone: "todo" };
  }
  return { text: "Nothing waiting", tone: "ok" };
}

const TONE: Record<string, { color: string; bg: string; border: string }> = {
  bad: { color: "#f87171", bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.35)" },
  warn: { color: "#fbbf24", bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.3)" },
  todo: { color: "var(--spx-text-secondary)", bg: "transparent", border: "var(--spx-border)" },
  ok: { color: "var(--spx-muted)", bg: "transparent", border: "var(--spx-border)" },
};

/**
 * CLOCK — "4h ago" is a value that changes on its own, so it is subscribed to
 * rather than computed while rendering.
 *
 * Two things fall out of that. The server has no useful clock for this — the
 * string it produces would already be stale by the time the browser hydrates,
 * which is a hydration mismatch — so it renders `null` and the row falls back
 * to an absolute date until mount. And the snapshot is rounded down to the
 * minute: `Date.now()` returns a new number on every read, which
 * useSyncExternalStore treats as a changed store and re-renders forever.
 *
 * One shared value per render also stops two clients synced in the same second
 * from reading "59m ago" and "1h ago" because the minute turned between rows.
 */
const MINUTE_MS = 60_000;

function subscribeToMinute(onStoreChange: () => void) {
  const tick = window.setInterval(onStoreChange, MINUTE_MS);
  return () => window.clearInterval(tick);
}

function getMinuteNow() {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

function getMinuteOnServer() {
  return null;
}

export default function PortfolioTable({
  rows,
  activeClientId,
}: {
  rows: PortfolioRow[];
  activeClientId: string;
}) {
  const router = useRouter();
  const [switching, setSwitching] = useState<string | null>(null);

  async function open(clientId: string) {
    // The row and the button inside it can both fire for one click, and the
    // button stays enabled while switching so focus is not thrown to <body>
    // mid-navigation. Both make re-entry possible, so it is guarded here.
    if (switching) return;
    if (clientId === activeClientId) return router.push("/dashboard");
    setSwitching(clientId);
    try {
      // Switch first, then navigate. The dashboard reads whichever client is
      // active server-side, so navigating first would render the old one.
      const res = await fetch("/api/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setSwitching(null);
      }
    } catch {
      setSwitching(null);
    }
  }

  const needing = rows.filter((r) => attentionRank(r) <= 2).length;

  // See CLOCK above. null on the server, a minute-stable timestamp after mount.
  const now = useSyncExternalStore<number | null>(
    subscribeToMinute,
    getMinuteNow,
    getMinuteOnServer
  );

  if (!rows.length) {
    return (
      <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-10 text-center">
        <p className="text-sm text-[var(--spx-muted)]">No clients yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {needing > 0 ? (
        <div
          className="flex items-start gap-2 rounded-xl p-3 text-sm"
          style={{
            border: `1px solid ${TONE.bad.border}`,
            background: TONE.bad.bg,
          }}
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" style={{ color: TONE.bad.color }} />
          <span>
            {needing} client{needing === 1 ? " has" : "s have"} something that will not reach Tally
            on its own.
          </span>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
          <span>Nothing is stuck or rejected across any client.</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--spx-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--spx-input-bg)] text-left text-[var(--spx-muted)]">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Client
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Drafts
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Ready
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                In Tally
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Last sync
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const v = verdict(r);
              const tone = TONE[v.tone];
              return (
                <tr
                  key={r.clientId}
                  onClick={() => void open(r.clientId)}
                  // has-[:focus-visible] mirrors the hover highlight when the
                  // row's button is reached by keyboard, so a tabbing user sees
                  // the same "this row" cue a mouse user gets.
                  className="cursor-pointer border-t border-[var(--spx-border)] transition duration-150 hover:bg-[var(--spx-card-hover)] has-[button:focus-visible]:bg-[var(--spx-card-hover)] motion-reduce:transition-none"
                  style={{ background: v.tone === "bad" ? tone.bg : undefined }}
                >
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      // The row handler would otherwise fire for the same click.
                      onClick={(e) => {
                        e.stopPropagation();
                        void open(r.clientId);
                      }}
                      aria-label={`Switch to ${r.clientName} — ${v.text}`}
                      aria-busy={switching === r.clientId || undefined}
                      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-left font-medium text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
                    >
                      {r.clientName}
                      {r.clientId === activeClientId && (
                        <span className="rounded border border-[var(--spx-border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--spx-muted)]">
                          current
                        </span>
                      )}
                      {switching === r.clientId && (
                        <Loader2
                          className="size-3.5 animate-spin text-[var(--spx-muted)] motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                    <div className="mt-0.5 text-xs text-[var(--spx-muted)]">
                      {r.tallyCompany ? (
                        r.tallyCompany
                      ) : (
                        <span style={{ color: TONE.warn.color }}>no Tally company bound</span>
                      )}
                      {r.gstin ? ` · ${r.gstin}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
                      style={{ border: `1px solid ${tone.border}`, color: tone.color }}
                    >
                      {v.tone === "bad" && <AlertTriangle className="size-3.5" />}
                      {v.tone === "warn" && <Clock className="size-3.5" />}
                      {v.tone === "todo" && <Send className="size-3.5" />}
                      {v.text}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--spx-muted)]">
                    {r.draftCount ? formatCount(r.draftCount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--spx-muted)]">
                    {r.readyCount ? formatCount(r.readyCount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--spx-muted)]">
                    {r.postedCount ? formatCount(r.postedCount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--spx-muted)]">
                    {now === null
                      ? formatDate(r.lastSyncedAt, "never")
                      : formatRelative(r.lastSyncedAt, now, "never")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--spx-muted)]">
        Clicking a client — or pressing Enter on its name — switches the whole app to it.
      </p>
    </div>
  );
}
