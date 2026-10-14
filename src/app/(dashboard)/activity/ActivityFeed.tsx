"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileX2,
  History,
  Layers,
  Loader2,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatCount, formatDate, formatDateTime, formatRelative } from "@/lib/format";

/**
 * The activity trail, read the way an owner reads it: down the page, by day,
 * one sentence per thing that happened.
 *
 * The sentence is the row. Counts, voucher ids and Tally's counters are all in
 * the metadata, and all of it is one keystroke away behind a disclosure — but
 * none of it is on the surface, because a table of ids is something you decode
 * rather than something you scan, and an audit trail nobody scans is an audit
 * trail nobody reads.
 */

export interface ActivityEvent {
  id: string;
  clientId: string | null;
  clientName: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  /** ISO 8601. Serialised on the server; parsed only by the format helpers. */
  createdAt: string;
}

interface ActivityFeedProps {
  initialEvents: ActivityEvent[];
  initialCursor: string | null;
  clients: Array<{ id: string; name: string }>;
  actions: Array<{ value: string; label: string }>;
}

const PAGE_SIZE = 50;

/**
 * Tone and icon per action.
 *
 * Keyed by the raw token rather than by an imported union, because the labels
 * arrive as props (`@/lib/audit` imports Prisma and must stay out of this
 * bundle) — and because a row written by a newer version of the app must still
 * render. Anything unrecognised falls back to `FALLBACK_STYLE` instead of
 * throwing away an event nobody can then see.
 *
 * Both halves of every colour pair are stated: `dark` is this app's default
 * theme but light is user-selectable, and a single mid-tone that satisfies
 * contrast on #0f1115 fails it on #ffffff. The two deletion actions are the
 * only ones in red — they are the irreversible ones, and the whole reason this
 * screen exists is that nothing recorded them at all.
 */
interface ActionStyle {
  Icon: LucideIcon;
  text: string;
  border: string;
}

const ACTION_STYLE: Record<string, ActionStyle> = {
  VOUCHER_APPROVED: {
    Icon: CheckCircle2,
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-700/30 dark:border-emerald-400/30",
  },
  VOUCHERS_PUSHED: {
    Icon: Send,
    text: "text-sky-700 dark:text-sky-400",
    border: "border-sky-700/30 dark:border-sky-400/30",
  },
  MASTERS_CREATED: {
    Icon: Layers,
    text: "text-sky-700 dark:text-sky-400",
    border: "border-sky-700/30 dark:border-sky-400/30",
  },
  VOUCHERS_DELETED_FROM_TALLY: {
    Icon: Trash2,
    text: "text-red-700 dark:text-red-400",
    border: "border-red-700/35 dark:border-red-400/35",
  },
  INVOICE_DELETED: {
    Icon: FileX2,
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-700/35 dark:border-amber-400/35",
  },
};

const FALLBACK_STYLE: ActionStyle = {
  Icon: History,
  text: "text-[var(--spx-text-secondary)]",
  border: "border-[var(--spx-border)]",
};

/**
 * CLOCK — the same pattern as the portfolio table, and for the same reason.
 *
 * "4h ago" changes on its own, so it is subscribed to rather than computed
 * while rendering. The server has no useful clock for it (whatever string it
 * produced would be stale by hydration, which is a mismatch), so it renders
 * `null` and every relative line is simply absent until mount — the absolute
 * timestamp beside it is always there, so nothing is missing in the meantime.
 *
 * The snapshot is rounded down to the minute because `Date.now()` returns a new
 * number on every read, which useSyncExternalStore treats as a changed store
 * and re-renders forever.
 */
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function subscribeToMinute(onStoreChange: () => void) {
  const tick = window.setInterval(onStoreChange, MINUTE_MS);
  return () => window.clearInterval(tick);
}

function getMinuteNow() {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

function getMinuteOnServer(): number | null {
  return null;
}

/** `voucherIds` -> `Voucher ids`. First letter only, so GSTIN survives. */
function metaLabel(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Metadata values as text. Long id arrays are truncated: a batch of two hundred
 * voucher ids is worth *keeping*, and worth nobody's screen.
 */
function metaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    const shown = value
      .slice(0, 6)
      .map((v) => (v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)));
    return value.length > 6
      ? `${shown.join(", ")} … and ${formatCount(value.length - 6)} more`
      : shown.join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface DayGroup {
  key: string;
  label: string;
  events: ActivityEvent[];
}

export default function ActivityFeed({
  initialEvents,
  initialCursor,
  clients,
  actions,
}: ActivityFeedProps) {
  const [clientId, setClientId] = useState("");
  const [action, setAction] = useState("");
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const now = useSyncExternalStore<number | null>(
    subscribeToMinute,
    getMinuteNow,
    getMinuteOnServer
  );

  const actionLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of actions) map.set(a.value, a.label);
    return map;
  }, [actions]);

  const filtering = clientId !== "" || action !== "";

  // The server already rendered the unfiltered first page, so the mount pass
  // must not immediately re-request it.
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    // Aborted on the next change: switching client twice quickly used to leave
    // whichever response landed last on screen, which on this screen means
    // showing one client's trail under another client's name.
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setOpenId(null);

    const qs = new URLSearchParams();
    if (clientId) qs.set("clientId", clientId);
    if (action) qs.set("action", action);
    qs.set("limit", String(PAGE_SIZE));

    fetch(`/api/audit?${qs.toString()}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { events: ActivityEvent[]; nextCursor: string | null };
      })
      .then((data) => {
        setEvents(data.events);
        setCursor(data.nextCursor);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError("Could not load the activity trail. Check your connection and try again.");
        setLoading(false);
      });

    return () => ac.abort();
  }, [clientId, action]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (clientId) qs.set("clientId", clientId);
      if (action) qs.set("action", action);
      qs.set("limit", String(PAGE_SIZE));
      qs.set("cursor", cursor);
      const res = await fetch(`/api/audit?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { events: ActivityEvent[]; nextCursor: string | null };
      setEvents((prev) => [...prev, ...data.events]);
      setCursor(data.nextCursor);
    } catch {
      setError("Could not load more activity. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Grouped by calendar day in IST, which is what `formatDate` already returns —
   * so the group key and the group heading are the same string and cannot drift
   * apart. The events arrive newest-first, so the groups come out in order
   * without a sort.
   */
  const groups: DayGroup[] = useMemo(() => {
    const todayKey = now === null ? null : formatDate(now);
    const yesterdayKey = now === null ? null : formatDate(now - DAY_MS);

    const out: DayGroup[] = [];
    for (const e of events) {
      const key = formatDate(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.events.push(e);
        continue;
      }
      const label =
        key === todayKey ? `Today · ${key}` : key === yesterdayKey ? `Yesterday · ${key}` : key;
      out.push({ key, label, events: [e] });
    }
    return out;
  }, [events, now]);

  const clientLabel = clientId ? clients.find((c) => c.id === clientId)?.name ?? "that client" : null;
  const actionLabel = action ? actionLabels.get(action) ?? action : null;

  return (
    <div className="space-y-4">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="activity-client"
            className="text-[11px] uppercase tracking-wider text-[var(--spx-muted)]"
          >
            Client
          </label>
          <select
            id="activity-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="min-h-11 min-w-52 rounded-lg border border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-3 text-sm text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
          >
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="activity-action"
            className="text-[11px] uppercase tracking-wider text-[var(--spx-muted)]"
          >
            What happened
          </label>
          <select
            id="activity-action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="min-h-11 min-w-52 rounded-lg border border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-3 text-sm text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
          >
            <option value="">Everything</option>
            {actions.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {filtering && (
          <button
            type="button"
            onClick={() => {
              setClientId("");
              setAction("");
            }}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--spx-border)] px-3 text-sm text-[var(--spx-text-secondary)] transition-colors duration-150 hover:bg-[var(--spx-card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
          >
            <X className="size-4" aria-hidden="true" />
            Clear filters
          </button>
        )}
      </div>

      {/* ── Live region ──
          One place that says what is on screen right now. Announced politely so
          a screen reader user changing the client filter is told the list
          reloaded and how much of it there is, rather than being left to
          discover it by arrowing through a table that silently changed. */}
      <p role="status" aria-live="polite" className="text-sm text-[var(--spx-muted)]">
        {loading
          ? "Loading activity…"
          : error
            ? error
            : events.length === 0
              ? "No matching activity."
              : `Showing ${formatCount(events.length)} event${events.length === 1 ? "" : "s"}${
                  clientLabel ? ` for ${clientLabel}` : " across all clients"
                }${actionLabel ? ` · ${actionLabel}` : ""}${cursor ? " · more available" : ""}`}
      </p>

      {error && !loading && (
        <div className="flex items-start gap-2 rounded-xl border border-red-700/35 bg-red-500/5 p-3 text-sm dark:border-red-400/35">
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400"
            aria-hidden="true"
          />
          <span>{error}</span>
        </div>
      )}

      {/* ── Empty states ── */}
      {events.length === 0 && !loading && !error ? (
        <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-10 text-center">
          <History className="mx-auto size-6 text-[var(--spx-muted)]" aria-hidden="true" />
          {filtering ? (
            <>
              <p className="mt-3 text-sm text-[var(--spx-text-secondary)]">
                Nothing recorded{actionLabel ? ` under “${actionLabel}”` : ""}
                {clientLabel ? ` for ${clientLabel}` : ""} yet.
              </p>
              <button
                type="button"
                onClick={() => {
                  setClientId("");
                  setAction("");
                }}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-[var(--spx-border)] px-3 text-sm text-[var(--spx-text)] hover:bg-[var(--spx-card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
              >
                Show everything
              </button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-[var(--spx-text-secondary)]">
                No activity recorded yet.
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-[var(--spx-muted)]">
                Every approval, every push to a client&apos;s TallyPrime, every deletion from Tally
                and every invoice removed here will appear on this screen — with the person who did
                it, the client it touched, and the time — as soon as it happens.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {/*
            The table scrolls inside this box rather than making the page scroll
            sideways, and the box itself is a focusable, labelled region — a
            scroll container that only a mouse can reach is unusable by keyboard.
          */}
          <div
            role="region"
            aria-label="Activity trail"
            tabIndex={0}
            className="overflow-x-auto rounded-xl border border-[var(--spx-border)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
          >
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">
                Activity across every client, newest first, grouped by day.
              </caption>
              <thead className="bg-[var(--spx-input-bg)] text-left text-[var(--spx-muted)]">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Action
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    What happened
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Client
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    By
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    When
                  </th>
                </tr>
              </thead>

              {groups.map((group) => (
                // One <tbody> per day, so the day heading is structurally part
                // of the group it introduces rather than a loose row.
                <tbody key={group.key}>
                  <tr>
                    <th
                      scope="colgroup"
                      colSpan={5}
                      className="border-t border-[var(--spx-border)] bg-[var(--spx-card)] px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--spx-text-secondary)]"
                    >
                      {group.label}
                      <span className="ml-2 font-normal normal-case tracking-normal text-[var(--spx-muted)]">
                        {formatCount(group.events.length)} event
                        {group.events.length === 1 ? "" : "s"}
                      </span>
                    </th>
                  </tr>

                  {group.events.map((e) => {
                    const tone = ACTION_STYLE[e.action] ?? FALLBACK_STYLE;
                    const label = actionLabels.get(e.action) ?? e.action;
                    const isOpen = openId === e.id;
                    const meta = e.metadata ? Object.entries(e.metadata) : [];
                    const who = e.actorName ?? e.actorEmail ?? "Unknown";

                    return [
                      <tr
                        key={e.id}
                        // The row is an easier mouse target, but the button
                        // inside it carries the tab stop, the accessible name
                        // and the aria-expanded state. has-[:focus-visible]
                        // mirrors the hover cue for a keyboard user, so tabbing
                        // does not move an invisible cursor.
                        onClick={() => setOpenId(isOpen ? null : e.id)}
                        className="cursor-pointer border-t border-[var(--spx-border)] transition-colors duration-150 hover:bg-[var(--spx-card-hover)] has-[button:focus-visible]:bg-[var(--spx-card-hover)] motion-reduce:transition-none"
                      >
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-xs ${tone.border} ${tone.text}`}
                          >
                            <tone.Icon className="size-3.5 shrink-0" aria-hidden="true" />
                            {label}
                          </span>
                        </td>

                        <td className="px-4 py-3 align-top">
                          <button
                            type="button"
                            onClick={(ev) => {
                              // The row handler would otherwise fire for the
                              // same click and toggle it straight back shut.
                              ev.stopPropagation();
                              setOpenId(isOpen ? null : e.id);
                            }}
                            aria-expanded={isOpen}
                            aria-controls={`activity-detail-${e.id}`}
                            className="flex min-h-11 w-full items-start gap-2 rounded-md text-left text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
                          >
                            {isOpen ? (
                              <ChevronDown
                                className="mt-0.5 size-4 shrink-0 text-[var(--spx-muted)]"
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronRight
                                className="mt-0.5 size-4 shrink-0 text-[var(--spx-muted)]"
                                aria-hidden="true"
                              />
                            )}
                            <span>{e.summary}</span>
                          </button>
                        </td>

                        <td className="px-4 py-3 align-top text-[var(--spx-text-secondary)]">
                          {e.clientName ?? (
                            // clientId is SetNull when a workspace is deleted.
                            // The summary sentence still names it, which is why
                            // the name is written into the sentence.
                            <span className="text-[var(--spx-muted)]">Client removed</span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top">
                          <span className="text-[var(--spx-text-secondary)]">{who}</span>
                          {e.actorEmail && e.actorName && (
                            <span className="mt-0.5 block text-xs text-[var(--spx-muted)]">
                              {e.actorEmail}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 align-top whitespace-nowrap">
                          <time dateTime={e.createdAt} className="text-[var(--spx-text-secondary)]">
                            {formatDateTime(e.createdAt)}
                          </time>
                          {now !== null && (
                            <span className="mt-0.5 block text-xs text-[var(--spx-muted)]">
                              {formatRelative(e.createdAt, now)}
                            </span>
                          )}
                        </td>
                      </tr>,

                      <tr
                        key={`${e.id}-detail`}
                        id={`activity-detail-${e.id}`}
                        hidden={!isOpen}
                        className="border-t border-[var(--spx-border)] bg-[var(--spx-card)]"
                      >
                        <td colSpan={5} className="px-4 py-3">
                          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[max-content_1fr]">
                            <dt className="text-xs uppercase tracking-wider text-[var(--spx-muted)]">
                              Record
                            </dt>
                            <dd className="break-words text-xs text-[var(--spx-text-secondary)]">
                              {e.entityType}
                              {e.entityId ? ` · ${e.entityId}` : ""}
                            </dd>
                            {meta.length === 0 ? (
                              <>
                                <dt className="text-xs uppercase tracking-wider text-[var(--spx-muted)]">
                                  Detail
                                </dt>
                                <dd className="text-xs text-[var(--spx-muted)]">
                                  Nothing beyond the sentence above was recorded.
                                </dd>
                              </>
                            ) : (
                              meta.map(([k, v]) => (
                                <div key={k} className="contents">
                                  <dt className="text-xs uppercase tracking-wider text-[var(--spx-muted)]">
                                    {metaLabel(k)}
                                  </dt>
                                  <dd className="break-words text-xs text-[var(--spx-text-secondary)]">
                                    {metaValue(v)}
                                  </dd>
                                </div>
                              ))
                            )}
                          </dl>
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>
              ))}
            </table>
          </div>

          {cursor && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              aria-busy={loadingMore || undefined}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] px-4 text-sm text-[var(--spx-text)] transition-colors duration-150 hover:bg-[var(--spx-card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
            >
              {loadingMore && (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              )}
              {loadingMore ? "Loading…" : "Load older activity"}
            </button>
          )}
        </>
      )}

      <p className="text-xs text-[var(--spx-muted)]">
        Nothing on this screen can be edited or removed. Times are IST.
      </p>
    </div>
  );
}
