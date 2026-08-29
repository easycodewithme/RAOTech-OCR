"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser-side view of the connector API.
 *
 * The desktop connector polls; the cloud never dials it. That single fact
 * shapes everything here: a push cannot be awaited, only enqueued and then
 * watched, so every mutation below is "fire, then poll" rather than
 * "fire and read the answer". A voucher that stays QUEUED is not a bug — it is
 * a connector that is not running, which is why `connectorOnline` is surfaced
 * separately instead of being folded into a generic error.
 */

/** Mirrors VoucherSyncState in prisma/schema.prisma. */
export type TallySyncState = "QUEUED" | "SENDING" | "POSTED" | "FAILED" | "DELETED";

export interface VoucherSync {
  voucherId: string;
  state: TallySyncState;
  /** Tally's own words, e.g. `Ledger 'Acme Traders' does not exist!`. Never paraphrase. */
  error: string | null;
  tallyVoucherNumber: string | null;
  syncedAt: string | null;
  /**
   * When the push was last handed out. `syncedAt` stays null while a voucher is
   * in flight, so this is the only field that can age a SENDING row into
   * "stuck" — which is the state worth surfacing, because it means a device
   * took the job and never said what happened.
   */
  lastAttemptAt: string | null;
}

export interface TallyJob {
  id: string;
  kind: string;
  state: string;
  error?: string | null;
}

/** Mirrors PreflightIssue in src/lib/tally/preflight.ts. */
export interface TallyIssue {
  voucherId: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface TallyCompany {
  id: string;
  companyName: string;
  status: string;
  lastSyncedAt: string | null;
  ledgerCount: number;
  fyStart: string | null;
  fyEnd: string | null;
  educationMode: boolean;
}

export interface TallyDeviceSummary {
  id: string;
  deviceName: string;
  lastSeenAt: string | null;
  tallyHost: string | null;
  tallyPort: number | null;
  tallyReachable: boolean | null;
  tallyMessage: string | null;
}

export interface ConnectorDevice extends TallyDeviceSummary {
  appVersion: string | null;
  revokedAt: string | null;
}

export interface TallyConnection {
  company: TallyCompany | null;
  device: TallyDeviceSummary | null;
  connectorOnline: boolean;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function readError(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return (body && typeof body.error === "string" && body.error) || `${fallback} (${res.status})`;
}

export async function fetchConnection(): Promise<TallyConnection> {
  const res = await fetch("/api/tally/company", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, "Could not read the Tally connection"));
  return res.json();
}

export async function fetchSyncStatus(
  voucherIds: string[],
  jobId?: string | null
): Promise<{ syncs: VoucherSync[]; job?: TallyJob | null }> {
  const qs = new URLSearchParams({ voucherIds: voucherIds.join(",") });
  // Without an id the route reports the workspace's most recent job, which may
  // belong to somebody else's click. Only ask about ours.
  if (jobId) qs.set("jobId", jobId);
  const res = await fetch(`/api/tally/status?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, "Could not read sync status"));
  return res.json();
}

export async function fetchDevices(): Promise<ConnectorDevice[]> {
  const res = await fetch("/api/connector/devices", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, "Could not list devices"));
  const body = await res.json();
  return body.devices ?? [];
}

/* ------------------------------------------------------------------ time */

/** "3 minutes ago" — only ever called after mount, so no hydration skew. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return "just now";
  if (secs < 45) return "just now";
  if (secs < 90) return "a minute ago";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString("en-IN");
}

/** Tally reports its financial year as `YYYYMMDD`; the API may hand back ISO. */
export function formatTallyDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  const d = compact
    ? new Date(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/* ------------------------------------------------------- connector status */

/**
 * Presence of the desktop agent, polled. Used by the offline banner and by the
 * push overlay, which has to explain why a queued voucher is not moving.
 */
export function useConnectorStatus({
  enabled = true,
  intervalMs = 20_000,
}: { enabled?: boolean; intervalMs?: number } = {}) {
  const [data, setData] = useState<TallyConnection | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchConnection();
      setData(next);
      setError(null);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the Tally connection");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void refresh();
    const timer = window.setInterval(() => {
      if (alive) void refresh();
    }, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs, refresh]);

  return { data, loading, error, refresh, setData };
}

/* ------------------------------------------------------------------ push */

export type PushPhase = "idle" | "starting" | "running" | "settled" | "blocked";

export interface PushState {
  phase: PushPhase;
  /** A delete reports the same way a push does, so both share this machine. */
  mode: "push" | "delete";
  voucherIds: string[];
  /** The jobs this push created, so polling asks about ours and not the last one. */
  jobIds: string[];
  syncs: VoucherSync[];
  job: TallyJob | null;
  /** 409 — masters have not been synced. Nothing posts until they are. */
  mastersError: string | null;
  /** 422 — preflight. Errors blocked the push; warnings did not. */
  issues: TallyIssue[];
  warnings: TallyIssue[];
  /** Transport or unexpected server failure. */
  error: string | null;
}

const IDLE: PushState = {
  phase: "idle",
  mode: "push",
  voucherIds: [],
  jobIds: [],
  syncs: [],
  job: null,
  mastersError: null,
  issues: [],
  warnings: [],
  error: null,
};

export type TallyPush = ReturnType<typeof useTallyPush>;

function isTerminalJob(job: TallyJob | null): boolean {
  return !!job && (job.state === "DONE" || job.state === "FAILED" || job.state === "CANCELLED");
}

function isSettledSync(sync: VoucherSync | undefined, mode: "push" | "delete"): boolean {
  if (!sync) return false;
  if (mode === "delete") return sync.state === "DELETED" || sync.state === "FAILED";
  return sync.state !== "QUEUED" && sync.state !== "SENDING";
}

/**
 * Enqueue a push (or a delete) and follow it to the end.
 *
 * Poll every 2s until no voucher is still QUEUED/SENDING. Two consecutive
 * agreeing polls are required before we call it done, because the rows carry
 * the *previous* push's outcome for the moment between our POST and the
 * connector claiming the job — settling on the first look would report a
 * re-push of an already-POSTED voucher as finished before it left.
 */
export function useTallyPush(options: { onSettled?: (syncs: VoucherSync[]) => void } = {}) {
  const { onSettled } = options;
  const [state, setState] = useState<PushState>(IDLE);
  const stableRef = useRef(0);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const reset = useCallback(() => {
    stableRef.current = 0;
    setState(IDLE);
  }, []);

  const begin = useCallback(async (mode: "push" | "delete", voucherIds?: string[]) => {
    stableRef.current = 0;
    setState({ ...IDLE, mode, phase: "starting", voucherIds: voucherIds ?? [] });

    const url = mode === "delete" ? "/api/tally/delete" : "/api/tally/push";
    const body = mode === "delete" ? { voucherIds } : voucherIds?.length ? { voucherIds } : {};

    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
    } catch {
      setState((s) => ({ ...s, phase: "blocked", error: "Could not reach the server." }));
      return;
    }

    // Masters first, always. A voucher referencing a ledger Tally has never
    // heard of is rejected with a reason nobody wants to go read.
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      setState((s) => ({
        ...s,
        phase: "blocked",
        mastersError: data.error || "Sync master data from Tally before posting vouchers.",
      }));
      return;
    }

    if (res.status === 422) {
      const data = await res.json().catch(() => ({}));
      setState((s) => ({
        ...s,
        phase: "blocked",
        issues: data.issues ?? [],
        warnings: data.warnings ?? [],
        error: (data.issues?.length ?? 0) === 0 ? data.error ?? null : null,
      }));
      return;
    }

    if (!res.ok) {
      const message = await readError(res, "Push failed");
      setState((s) => ({ ...s, phase: "blocked", error: message }));
      return;
    }

    const data = await res.json().catch(() => ({}));
    const ids: string[] = data.voucherIds ?? voucherIds ?? [];
    setState((s) => ({
      ...s,
      phase: ids.length ? "running" : "settled",
      voucherIds: ids,
      jobIds: data.jobIds ?? [],
      warnings: data.warnings ?? [],
    }));
  }, []);

  const start = useCallback((voucherIds?: string[]) => begin("push", voucherIds), [begin]);
  const remove = useCallback((voucherIds: string[]) => begin("delete", voucherIds), [begin]);

  const key = state.voucherIds.join(",");
  const mode = state.mode;
  const running = state.phase === "running";
  // A push that fanned out into several jobs cannot be tracked by any one of
  // them, so the job shortcut is only used when there is exactly one.
  const jobId = state.jobIds.length === 1 ? state.jobIds[0] : null;

  useEffect(() => {
    if (!running || !key) return;
    let alive = true;
    const ids = key.split(",");

    async function poll() {
      let payload: { syncs: VoucherSync[]; job?: TallyJob | null };
      try {
        payload = await fetchSyncStatus(ids, jobId);
      } catch {
        return; // A dropped poll is not a failed push; the next one will tell us.
      }
      if (!alive) return;

      const syncs = payload.syncs ?? [];
      const job = payload.job ?? null;
      const byId = new Map(syncs.map((s) => [s.voucherId, s]));
      const allSettled = ids.every((id) => isSettledSync(byId.get(id), mode));
      stableRef.current = allSettled ? stableRef.current + 1 : 0;
      const done = (!!jobId && isTerminalJob(job)) || stableRef.current >= 2;

      setState((s) => ({ ...s, syncs, job, phase: done ? "settled" : s.phase }));
      if (done) settledRef.current?.(syncs);
    }

    void poll();
    const timer = window.setInterval(poll, 2000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [running, key, mode, jobId]);

  return { state, start, remove, reset };
}

/* ---------------------------------------------------------------- lookups */

/**
 * Sync rows for a list of vouchers, refreshable. The transactions table and
 * the voucher screen both need "where does Tally think this stands?" on load,
 * and neither server page carries it.
 */
export function useVoucherSyncs(voucherIds: string[]) {
  const [syncs, setSyncs] = useState<Record<string, VoucherSync>>({});
  const key = voucherIds.join(",");

  const load = useCallback(async (alive: () => boolean) => {
    if (!key) {
      if (alive()) setSyncs({});
      return;
    }
    try {
      const { syncs: rows } = await fetchSyncStatus(key.split(","));
      if (alive()) setSyncs(Object.fromEntries((rows ?? []).map((r) => [r.voucherId, r])));
    } catch {
      // Status is decoration on a table that renders fine without it.
    }
  }, [key]);

  useEffect(() => {
    let alive = true;
    // Sync state lives on the server and changes without us; reading it on
    // mount is a subscription, not a render-time computation the lint rule
    // could hoist away.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = useCallback(() => load(() => true), [load]);

  return { syncs, refresh };
}

/* ------------------------------------------------------------- preflight */

export interface PreflightIssue {
  voucherId: string;
  code: string;
  severity: "error" | "warning";
  message: string;
}

export interface PreflightResult {
  ready: boolean;
  reason?: string;
  fix?: { label: string; href: string };
  companyName?: string;
  voucherCount?: number;
  notPushable?: number;
  blockingCount?: number;
  warningCount?: number;
  issues: PreflightIssue[];
  mastersToCreate?: number;
  movesStock?: boolean;
  connector?: {
    online: boolean;
    name: string | null;
    lastSeenAt: string | null;
    tallyReachable: boolean | null;
    tallyMessage: string | null;
  };
  educationMode?: boolean;
}

/**
 * What a push would do, checked as the selection changes.
 *
 * Debounced, because this fires on every checkbox click and a user ticking
 * forty rows would otherwise issue forty requests. Two hundred milliseconds is
 * below the threshold where the panel feels like it lags the selection, and
 * above the rate at which anyone can click.
 *
 * Every response carries the selection it was computed for, and a stale one is
 * dropped: without that, unticking a row that had the only blocking issue could
 * leave the panel still saying the push is blocked, which is the worst possible
 * failure for a control whose whole job is to be trusted.
 */
export function usePushPreflight(voucherIds: string[]) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [checking, setChecking] = useState(false);
  const key = voucherIds.join(",");

  useEffect(() => {
    if (!key) {
      setResult(null);
      setChecking(false);
      return;
    }

    let alive = true;
    setChecking(true);

    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/tally/preflight", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voucherIds: key.split(",") }),
        });
        const data = (await res.json()) as PreflightResult;
        if (alive) setResult(res.ok ? data : { ready: true, issues: [] });
      } catch {
        // A preflight that cannot run must not block the push: the server
        // checks again anyway, and refusing on a network blip would be a
        // worse failure than letting the 422 do its job.
        if (alive) setResult({ ready: true, issues: [] });
      } finally {
        if (alive) setChecking(false);
      }
    }, 200);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key]);

  return { preflight: result, checking };
}
