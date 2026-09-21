"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  Monitor,
  PlugZap,
  RefreshCw,
  Save,
  Terminal,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { formatRelative } from "@/lib/format";
import {
  fetchDevices,
  fetchSyncStatus,
  formatTallyDate,
  useConnectorStatus,
  type ConnectorDevice,
  type TallyCompany,
  type TallyConnection as Connection,
} from "@/components/tallyClient";

/**
 * The human side of the connector protocol.
 *
 * Three things have to be true before a voucher can reach Tally, and this page
 * is where each one is established: a paired desktop device, a named company,
 * and a Tally that is actually answering on its HTTP gateway. When one of them
 * is false, everything downstream queues — so each section says plainly which
 * of the three it is reporting on.
 *
 * UX-04: this screen used to open on a pairing code and the sentence "Open the
 * Rao-Tech connector on the machine running Tally", with nothing anywhere in
 * the product that said what that was or where to get it. Every new customer's
 * first action was a support ticket, at the moment they were deciding whether
 * the product works at all. The first-run sequence below replaces that: what to
 * install, where it has to run, what to switch on in Tally, and how to tell it
 * worked — before the code is ever asked for.
 */

/* ------------------------------------------------------ release configuration */

/**
 * MUST BE SET BEFORE RELEASE.
 *
 * The published download for the Windows connector — a direct link to the
 * signed `.exe` (or to a release page that offers it). There is no such URL
 * yet: the agent is built from `tally-connector/` and handed over by the
 * Rao-Tech team, so shipping a link here would be inventing one, and a button
 * that 404s at first run is worse than no button.
 *
 * Leave it empty and the screen tells the truth — it shows the build-and-run
 * instructions instead of a dead download. Set it to the real URL and the
 * download step becomes a button with no other change needed.
 */
// Annotated `string` rather than left as the literal `""` so the empty branch
// below stays type-checked when a real URL is dropped in.
const CONNECTOR_DOWNLOAD_URL: string = "";

/** TallyPrime's HTTP-XML gateway default; the connector's default too. */
const DEFAULT_TALLY_PORT = 9000;

/** Where the agent keeps its settings and its log, quoted on screen so a
 *  support call can start with "send me that file" rather than a hunt. */
const CONNECTOR_SETTINGS_PATH = "%AppData%\\RaoTech\\connector.json";
const CONNECTOR_LOG_PATH = "%AppData%\\RaoTech\\logs\\connector.log";

/** A device is "online" if it has checked in inside three heartbeats. The
 *  connector heartbeats every 30s; the devices API uses the same window. */
const ONLINE_WINDOW_MS = 90_000;

/** A change in either signature means the connector has answered our job. */
function companySignature(c: Connection | null): string {
  const co = c?.company;
  return co ? `${co.status}|${co.lastSyncedAt ?? ""}|${co.ledgerCount}` : "none";
}
function deviceSignature(c: Connection | null): string {
  const d = c?.device;
  return d ? `${d.lastSeenAt ?? ""}|${d.tallyReachable}|${d.tallyMessage ?? ""}` : "none";
}

function isOnline(device: ConnectorDevice, now: number): boolean {
  if (device.revokedAt || !device.lastSeenAt) return false;
  return now - new Date(device.lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/**
 * A clock that ticks.
 *
 * Every relative time on this page is computed from it rather than from a
 * `Date.now()` read during render — partly because reading the clock mid-render
 * is not idempotent, and partly because "2 minutes ago" should become "3
 * minutes ago" on its own. A device that went quiet is the thing this screen
 * exists to show, and a frozen "just now" would hide exactly that.
 */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

type Watch = { kind: "master" | "test"; jobId: string; baseline: string; deadline: number };
type Busy = "pair" | "save" | "master" | "test" | "revoke" | null;

export default function TallyConnection({ clientName }: { clientName?: string }) {
  const { toast } = useToast();
  const { data, loading, refresh, setData } = useConnectorStatus({ intervalMs: 15_000 });
  const [devices, setDevices] = useState<ConnectorDevice[]>([]);
  const [watch, setWatch] = useState<Watch | null>(null);
  const [busy, setBusy] = useState<Busy>(null);

  const loadDevices = useCallback(async (alive: () => boolean = () => true) => {
    try {
      const list = await fetchDevices();
      if (alive()) setDevices(list);
    } catch {
      // The connection payload already carries enough to render the panel.
    }
  }, []);

  useEffect(() => {
    let alive = true;
    // The device list is owned by the server — and by whoever is at the Tally
    // machine. Reading it on mount is a subscription, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDevices(() => alive);
    return () => {
      alive = false;
    };
  }, [loadDevices]);

  // A job is only "finished" when the connector has written something back —
  // either the job row reaching a terminal state, or the payload it updates
  // visibly changing. Whichever arrives first ends the wait.
  useEffect(() => {
    if (!watch) return;
    let alive = true;

    function finish(next: Connection | null, jobError?: string | null) {
      setWatch(null);
      setBusy(null);
      if (jobError) {
        toast(jobError, "error");
        return;
      }
      if (watch!.kind === "master") {
        const status = next?.company?.status;
        if (status === "ERROR") toast("Master sync failed — see the diagnostics below.", "error");
        else toast(`Read ${next?.company?.ledgerCount ?? 0} ledgers from Tally.`, "success");
      } else {
        const d = next?.device;
        toast(
          d?.tallyMessage || (d?.tallyReachable ? "Tally answered." : "Tally did not answer."),
          d?.tallyReachable ? "success" : "error"
        );
      }
    }

    const timer = window.setInterval(async () => {
      const [next, status] = await Promise.all([
        refresh(),
        fetchSyncStatus([], watch.jobId).catch(() => null),
      ]);
      if (!alive) return;

      const job = status?.job;
      if (job && (job.state === "DONE" || job.state === "FAILED" || job.state === "CANCELLED")) {
        finish(next, job.state === "DONE" ? null : job.error || "The connector could not run the job.");
        return;
      }

      const now = watch.kind === "master" ? companySignature(next) : deviceSignature(next);
      if (now !== watch.baseline) {
        finish(next);
        return;
      }
      if (Date.now() > watch.deadline) {
        setWatch(null);
        setBusy(null);
        toast("Still queued — the connector will run it the next time it polls.", "info");
      }
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [watch, refresh, toast]);

  async function post(url: string, kind: "master" | "test") {
    setBusy(kind);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error || `Request failed (${res.status})`, "error");
        setBusy(null);
        return;
      }
      setWatch({
        kind,
        jobId: body.jobId,
        baseline: kind === "master" ? companySignature(data) : deviceSignature(data),
        deadline: Date.now() + (kind === "master" ? 180_000 : 60_000),
      });
      await refresh();
    } catch {
      toast("Could not reach the server.", "error");
      setBusy(null);
    }
  }

  /**
   * Every live device, not the first one.
   *
   * This screen used to render `devices.find(d => !d.revokedAt)` — so a second
   * machine that had paired to the same account, whether a colleague's laptop
   * or one nobody remembered setting up, was invisible to the person who owns
   * the books it can write to. There is nothing stopping two connectors from
   * pairing, and job claiming is explicitly designed for it, so the list has to
   * show all of them and let each one be cut off individually.
   */
  const pairedDevices = useMemo(() => devices.filter((d) => !d.revokedAt), [devices]);

  return (
    <div className="space-y-6 p-4 md:p-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="mb-2 inline-flex min-h-11 cursor-pointer items-center gap-1 text-xs text-[var(--spx-muted)] transition-colors duration-150 hover:text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Ledgers &amp; Rules
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--spx-text)] sm:text-3xl">
            Tally Connection
          </h1>
          <p className="mt-1 text-sm text-[var(--spx-muted)]">
            {clientName ? `${clientName} · ` : ""}Pair the desktop connector, name the company in
            Tally, and check the gateway
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 cursor-pointer"
          onClick={() => {
            void refresh();
            void loadDevices();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      {loading && !data ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-6 text-sm text-[var(--spx-muted)] shadow-sm"
        >
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none" /> Reading
          the connection…
        </div>
      ) : (
        <>
          <DeviceSection
            devices={pairedDevices}
            summary={data?.device ?? null}
            busy={busy}
            setBusy={setBusy}
            onChanged={async () => {
              await Promise.all([refresh(), loadDevices()]);
            }}
          />

          <CompanySection
            company={data?.company ?? null}
            paired={pairedDevices.length > 0}
            busy={busy}
            setBusy={setBusy}
            onSaved={(company) =>
              setData((prev) => (prev ? { ...prev, company } : { company, device: null, connectorOnline: false }))
            }
            onSyncMaster={() => post("/api/tally/sync-master", "master")}
            onTestConnection={() => post("/api/tally/test-connection", "test")}
          />

          {data?.device && <Diagnostics device={data.device} educationMode={data.company?.educationMode} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- shared shells */

function Section({
  title,
  icon,
  aside,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold text-[var(--spx-text)]">{title}</h2>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Status pills. Each tone is declared for both themes: one shade cannot clear
 *  3:1 against a white card and a near-black one at the same time. */
const TONE = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  idle: "bg-[var(--spx-input-bg)] text-[var(--spx-text-secondary)]",
} as const;

function Pill({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** A short literal — a command, a path, a port. Monospace, and it wraps rather
 *  than pushing the page sideways on a 375px screen. */
function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="break-all rounded bg-[var(--spx-input-bg)] px-1.5 py-0.5 font-mono text-xs text-[var(--spx-text)]">
      {children}
    </code>
  );
}

/* ------------------------------------------------------------------- device */

function DeviceSection({
  devices,
  summary,
  busy,
  setBusy,
  onChanged,
}: {
  devices: ConnectorDevice[];
  summary: Connection["device"];
  busy: Busy;
  setBusy: (b: Busy) => void;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const now = useNow();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [confirmRevoke, setConfirmRevoke] = useState<ConnectorDevice | null>(null);
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;
  /**
   * Which devices already existed when the code was minted. Watching for "any
   * live device" would have been wrong the moment a second machine was being
   * added: the code would clear itself instantly against the first one.
   */
  const knownIdsRef = useRef<Set<string>>(new Set());

  // The code is live for ten minutes; showing the countdown is the difference
  // between "type this in" and "type this in before it stops working".
  useEffect(() => {
    if (!code) return;
    function tick() {
      const left = Math.round((new Date(code!.expiresAt).getTime() - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) setCode(null);
    }
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  // While a code is on screen the desktop may claim it at any moment, and the
  // only way we hear about it is by asking.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    const timer = window.setInterval(async () => {
      let list: ConnectorDevice[];
      try {
        list = await fetchDevices();
      } catch {
        return;
      }
      if (!alive) return;
      const claimed = list.some((d) => !d.revokedAt && !knownIdsRef.current.has(d.id));
      if (claimed) {
        setCode(null);
        void changedRef.current();
      }
    }, 3000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [code]);

  async function pair() {
    setBusy("pair");
    try {
      const res = await fetch("/api/connector/devices/pair-code", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error || "Could not create a pairing code", "error");
        return;
      }
      knownIdsRef.current = new Set(devices.map((d) => d.id));
      setCode({ code: body.code, expiresAt: body.expiresAt });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(device: ConnectorDevice) {
    setBusy("revoke");
    try {
      const res = await fetch(`/api/connector/devices/${device.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast(body.error || "Could not revoke the device", "error");
        return;
      }
      setConfirmRevoke(null);
      toast(`${device.deviceName} revoked. It stops polling on its next request.`, "success");
      await onChanged();
    } finally {
      setBusy(null);
    }
  }

  const onlineCount = devices.filter((d) => isOnline(d, now)).length;
  const port = devices[0]?.tallyPort ?? summary?.tallyPort ?? DEFAULT_TALLY_PORT;

  return (
    <Section
      title={devices.length > 1 ? "Connector devices" : "Connector device"}
      icon={<Monitor className="h-4 w-4 text-[var(--spx-muted)]" />}
      aside={
        devices.length > 0 ? (
          <Pill tone={onlineCount > 0 ? "ok" : "warn"}>
            {onlineCount > 0 ? <CheckCircle2 className="h-3 w-3" /> : <PlugZap className="h-3 w-3" />}
            {onlineCount > 0
              ? `${onlineCount} of ${devices.length} online`
              : devices.length === 1
                ? "Offline"
                : `${devices.length} paired, none online`}
          </Pill>
        ) : null
      }
    >
      {devices.length > 0 && (
        <ul className="divide-y divide-[var(--spx-border)]">
          {devices.map((device) => (
            <DeviceRow
              key={device.id}
              device={device}
              now={now}
              fallbackPort={port}
              busy={busy}
              onRevoke={() => setConfirmRevoke(device)}
            />
          ))}
        </ul>
      )}

      {/* The pairing code, whether this is the first device or the fifth. */}
      {code ? (
        <div className="space-y-4 border-t border-[var(--spx-border)] p-4">
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-dashed border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-4 py-6 text-center"
          >
            <p className="text-xs uppercase tracking-[1.5px] text-[var(--spx-muted)]">
              Pairing code
            </p>
            <p className="mt-2 font-mono text-3xl font-bold tracking-[0.2em] text-[var(--spx-text)] sm:text-4xl sm:tracking-[0.3em]">
              {code.code}
            </p>
            <p className="mt-2 text-xs text-[var(--spx-muted)]">
              Expires in{" "}
              <span className="font-medium text-[var(--spx-text-secondary)]">
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </span>{" "}
              · single use
            </p>
          </div>
          <div className="space-y-2 text-sm text-[var(--spx-text-secondary)]">
            <p>
              Enter it in the connector on the machine running Tally — the tray icon opens a
              settings page with a field for it — or from a terminal on that machine:
            </p>
            <Mono>connector.exe -pair {code.code}</Mono>
            <p>
              This page switches over on its own the moment the code is claimed. Nothing else is
              typed on the desktop: the code carries the identity, so no password reaches the
              connector.
            </p>
          </div>
          <p
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-xs text-[var(--spx-muted)]"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Waiting for
            the connector…
          </p>
        </div>
      ) : devices.length === 0 ? (
        <FirstRun port={port} onPair={pair} pairing={busy === "pair"} />
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--spx-border)] p-4">
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 cursor-pointer"
            onClick={pair}
            disabled={busy === "pair"}
          >
            {busy === "pair" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            Pair another machine
          </Button>
          <p className="text-xs text-[var(--spx-muted)]">
            Every machine that should post to this workspace needs its own pairing. Re-pairing a
            machine already listed replaces its token instead of adding a row.
          </p>
        </div>
      )}

      {confirmRevoke && (
        <ConfirmDialog
          title={`Revoke ${confirmRevoke.deviceName}?`}
          body={
            <>
              The connector on that machine gets a 401 on its next poll and stops. Queued vouchers
              stay queued until a device is paired again. Vouchers already in Tally are untouched.
              {confirmRevoke.lastSeenAt && (
                <> It last checked in {formatRelative(confirmRevoke.lastSeenAt, now, "never")}.</>
              )}
            </>
          }
          confirmLabel={busy === "revoke" ? "Revoking…" : "Revoke device"}
          busy={busy === "revoke"}
          onConfirm={() => void revoke(confirmRevoke)}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}
    </Section>
  );
}

function DeviceRow({
  device,
  now,
  fallbackPort,
  busy,
  onRevoke,
}: {
  device: ConnectorDevice;
  now: number;
  fallbackPort: number;
  busy: Busy;
  onRevoke: () => void;
}) {
  const online = isOnline(device, now);
  const host = device.tallyHost ?? "localhost";
  const port = device.tallyPort ?? fallbackPort;

  return (
    <li className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-[var(--spx-text)]">{device.deviceName}</span>
          <Pill tone={online ? "ok" : "warn"}>
            {online ? <CheckCircle2 className="h-3 w-3" /> : <PlugZap className="h-3 w-3" />}
            {online ? "Online" : "Offline"}
          </Pill>
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {/* Last seen is the field that tells an owner whether a machine they
              do not recognise is dormant or writing to the books right now. */}
          <Row label="Last seen" value={formatRelative(device.lastSeenAt, now, "never")} />
          <Row label="Connector version" value={device.appVersion || "—"} />
          <Row label="Tally gateway" value={`${host}:${port}`} mono />
          <Row
            label="Tally"
            value={
              device.tallyReachable === true
                ? "answering"
                : device.tallyReachable === false
                  ? "not answering"
                  : "not checked yet"
            }
          />
        </dl>
      </div>
      <div className="flex flex-col items-start gap-2 md:items-end">
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 cursor-pointer"
          onClick={onRevoke}
          disabled={busy === "revoke"}
          aria-label={`Revoke ${device.deviceName}`}
        >
          Revoke
        </Button>
      </div>
    </li>
  );
}

/* ---------------------------------------------------------------- first run */

/**
 * What to do when nothing is paired yet.
 *
 * Ordered the way it actually has to happen on the customer's machine, and
 * explicit that all of it happens *there* rather than here — the single most
 * common misunderstanding is that this web page talks to Tally. It cannot:
 * Tally listens on an accountant's own Windows box, usually behind NAT, and
 * every byte between the two is an outbound HTTPS poll made by the desktop.
 */
function FirstRun({
  port,
  onPair,
  pairing,
}: {
  port: number;
  onPair: () => void;
  pairing: boolean;
}) {
  // Rendered after mount only: the connector has to be pointed at this exact
  // workspace URL, and reading it during SSR would risk a hydration mismatch
  // behind a proxy that rewrites the host.
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);

  return (
    <div className="space-y-5 p-4">
      <div className="rounded-lg border border-[var(--spx-border)] bg-[var(--spx-input-bg)] p-3 text-sm text-[var(--spx-text-secondary)]">
        <p>
          <strong className="text-[var(--spx-text)]">Nothing is paired yet.</strong> Tally has no
          public address — it listens only on the machine it runs on — so a small Windows agent, the
          Rao-Tech connector, runs on that machine and polls this workspace for work. Traffic is
          outbound from the desktop over HTTPS only; nothing dials in, and no port has to be opened
          to the internet.
        </p>
      </div>

      <ol className="space-y-4">
        <Step
          n={1}
          title="Install the connector on the machine running Tally"
          detail={
            <>
              Not on this machine unless Tally runs here too. It is a single Windows{" "}
              <Mono>.exe</Mono> with nothing else to install — no runtime, no service account. It
              keeps its settings in <Mono>{CONNECTOR_SETTINGS_PATH}</Mono>.
            </>
          }
        >
          <DownloadStep origin={origin} />
        </Step>

        <Step
          n={2}
          title="Switch on Tally's gateway"
          detail={
            <>
              In TallyPrime on that machine:{" "}
              <Mono>F1: Help → Settings → Connectivity → Client/Server Configuration</Mono>
            </>
          }
        >
          <ul className="space-y-1.5 text-sm text-[var(--spx-text-secondary)]">
            <li>
              TallyPrime acts as <strong className="text-[var(--spx-text)]">Server</strong> (or{" "}
              <strong className="text-[var(--spx-text)]">Both</strong>)
            </li>
            <li>
              Enable ODBC <strong className="text-[var(--spx-text)]">Yes</strong>
            </li>
            <li>
              Port <Mono>{port}</Mono> — anything in 9000–9999 works, as long as the connector is
              set to the same one
            </li>
            <li>Restart Tally when it asks</li>
            <li>
              Leave <Mono>tally.exe</Mono> running{" "}
              <strong className="text-[var(--spx-text)]">with the company open</strong>. A running{" "}
              <Mono>tallygatewayserver.exe</Mono> is a different component and is not enough on its
              own.
            </li>
          </ul>
        </Step>

        <Step
          n={3}
          title="Pair it with this workspace"
          detail={
            <>
              Generate a code here and type it into the connector on that machine. The code is
              single-use and lives for ten minutes; claiming it returns a token bound to that one
              machine, which is what revoking later cuts off. No password is ever typed into the
              desktop agent.
            </>
          }
        >
          <Button
            size="sm"
            className="min-h-11 cursor-pointer"
            onClick={onPair}
            disabled={pairing}
          >
            {pairing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            Generate a pairing code
          </Button>
        </Step>

        <Step
          n={4}
          title="Check that it worked"
          detail={
            <>
              This panel switches to the paired machine by itself, within a few seconds, and its
              status turns <strong className="text-[var(--spx-text)]">Online</strong> once the
              connector starts its 30-second heartbeat. Then name the company below and run{" "}
              <strong className="text-[var(--spx-text)]">Test Connection</strong> — it asks the
              desktop to knock on Tally and reports back in Tally&apos;s own words.
            </>
          }
        >
          <p className="text-sm text-[var(--spx-text-secondary)]">
            If it stays offline, <Mono>connector.exe -status</Mono> on that machine prints what it
            thinks it knows and probes the gateway, and its log is at{" "}
            <Mono>{CONNECTOR_LOG_PATH}</Mono>.
          </p>
        </Step>
      </ol>
    </div>
  );
}

function Step({
  n,
  title,
  detail,
  children,
}: {
  n: number;
  title: string;
  detail: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--spx-border)] bg-[var(--spx-input-bg)] text-xs font-bold text-[var(--spx-text)]"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="font-semibold text-[var(--spx-text)]">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-[var(--spx-text-secondary)]">{detail}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * The download, or the truth about there not being one.
 *
 * There is deliberately no fallback URL and no "contact support" button that
 * pretends to be a download. Until CONNECTOR_DOWNLOAD_URL is set, this shows
 * exactly how the binary is produced from the repository, which is a thing
 * that is true today, rather than a link that would 404 at first run.
 */
function DownloadStep({ origin }: { origin: string | null }) {
  if (CONNECTOR_DOWNLOAD_URL) {
    return (
      <div className="space-y-2">
        {/* No `download` attribute: browsers ignore it cross-origin anyway, and
            the constant may point at a release page rather than the file. */}
        <Button asChild size="sm" className="min-h-11 cursor-pointer">
          <a href={CONNECTOR_DOWNLOAD_URL} rel="noopener noreferrer">
            <Download className="mr-2 h-4 w-4" /> Download the connector for Windows
          </a>
        </Button>
        <p className="text-xs text-[var(--spx-muted)]">
          Run it once; it settles into the system tray and stays there.
          {origin && (
            <>
              {" "}
              If it asks for a workspace URL, use <Mono>{origin}</Mono>.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        No published download yet
      </p>
      <p>
        The connector is not yet on a public download page, so there is no link to give you here.
        Ask your Rao-Tech contact for the signed Windows build — or, if you have the{" "}
        <Mono>tally-connector</Mono> repository and Go 1.26+, build it on the Tally machine:
      </p>
      <pre className="overflow-x-auto rounded border border-amber-300 bg-[var(--spx-card)] p-2 font-mono text-xs text-[var(--spx-text)] dark:border-amber-500/40">
        <code>{`go build -o bin/connector.exe ./cmd/connector
.\\bin\\connector.exe${origin ? ` -cloud ${origin}` : ""}`}</code>
      </pre>
      <p className="flex items-start gap-2">
        <Terminal className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          The first command produces the agent; the second starts it in the system tray. Add{" "}
          <Mono>-run</Mono> instead to run it in a console with its log on screen, which is the
          quickest way to see what it is doing.
        </span>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ company */

const STATUS_TONE: Record<string, keyof typeof TONE> = {
  READY: "ok",
  SYNCING: "warn",
  ERROR: "bad",
  UNSYNCED: "idle",
};

function CompanySection({
  company,
  paired,
  busy,
  setBusy,
  onSaved,
  onSyncMaster,
  onTestConnection,
}: {
  company: TallyCompany | null;
  paired: boolean;
  busy: Busy;
  setBusy: (b: Busy) => void;
  onSaved: (company: TallyCompany) => void;
  onSyncMaster: () => void;
  onTestConnection: () => void;
}) {
  const { toast } = useToast();
  const now = useNow();
  const [name, setName] = useState(company?.companyName ?? "");
  const touched = useRef(false);

  // Polling must not overwrite what the user is halfway through typing.
  useEffect(() => {
    if (!touched.current) setName(company?.companyName ?? "");
  }, [company?.companyName]);

  async function save() {
    const companyName = name.trim();
    if (!companyName) return;
    setBusy("save");
    try {
      const res = await fetch("/api/tally/company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(body.error || "Could not save the company", "error");
        return;
      }
      touched.current = false;
      onSaved(body.company);
      toast("Company saved. Run Sync Master to read its ledgers.", "success");
    } finally {
      setBusy(null);
    }
  }

  const fyStart = formatTallyDate(company?.fyStart);
  const fyEnd = formatTallyDate(company?.fyEnd);
  const dirty = touched.current && name.trim() !== (company?.companyName ?? "");

  return (
    <Section
      title="Tally company"
      aside={
        company ? (
          <Pill tone={STATUS_TONE[company.status] ?? "idle"}>{company.status}</Pill>
        ) : null
      }
    >
      <div className="space-y-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="tally-company" className="text-[var(--spx-text)]">
              Company name, exactly as it appears in Tally
            </Label>
            <Input
              id="tally-company"
              value={name}
              placeholder="RAOTECH TRADERS"
              aria-describedby="tally-company-help"
              className="min-h-11"
              onChange={(e) => {
                touched.current = true;
                setName(e.target.value);
              }}
            />
            <p id="tally-company-help" className="text-xs text-[var(--spx-muted)]">
              Tally addresses companies by name. A spelling that differs by so much as a double
              space is a different company as far as the import is concerned.
            </p>
          </div>
          <Button
            size="sm"
            className="min-h-11 cursor-pointer"
            onClick={save}
            disabled={busy === "save" || !name.trim() || (!!company && !dirty)}
          >
            {busy === "save" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>

        {company && (
          <dl className="grid gap-2 rounded-lg border border-[var(--spx-border)] bg-[var(--spx-input-bg)] p-3 text-sm sm:grid-cols-3">
            <Row label="Ledgers" value={String(company.ledgerCount)} />
            <Row label="Last synced" value={formatRelative(company.lastSyncedAt, now, "never")} />
            <Row
              label="Financial year"
              value={fyStart && fyEnd ? `${fyStart} — ${fyEnd}` : "unknown until first sync"}
            />
          </dl>
        )}

        {company?.educationMode && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Tally is running in education mode. It rejects imports with an <em>empty</em> reason,
              so a push will fail without saying why. Activate a licence before posting.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="min-h-11 cursor-pointer bg-[#0b6b3a] text-white hover:bg-[#0a5c32]"
            disabled={!company || !paired || busy === "master"}
            onClick={onSyncMaster}
          >
            {busy === "master" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync Master
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 cursor-pointer"
            disabled={!paired || busy === "test"}
            onClick={onTestConnection}
          >
            {busy === "test" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Wifi className="mr-2 h-4 w-4" />
            )}
            Test Connection
          </Button>
          <p role="status" aria-live="polite" className="text-xs text-[var(--spx-muted)]">
            {busy === "master" || busy === "test"
              ? "Queued — waiting for the connector to poll."
              : paired
                ? "Both are queued for the connector; it answers on its next poll."
                : "Pair a device first — these run on the Tally machine, not here."}
          </p>
        </div>

        {company?.status !== "READY" && (
          <p className="text-xs text-[var(--spx-muted)]">
            Vouchers cannot be pushed until master data has been read at least once: Tally matches
            ledgers by name, and the workspace has to know the names it will be matched against.
          </p>
        )}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------- diagnostics */

function Diagnostics({
  device,
  educationMode,
}: {
  device: NonNullable<Connection["device"]>;
  educationMode?: boolean;
}) {
  const reachable = device.tallyReachable === true;
  const port = device.tallyPort ?? DEFAULT_TALLY_PORT;

  return (
    <Section title="Diagnostics">
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-start gap-2">
          {reachable ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={
                reachable
                  ? "font-medium text-emerald-700 dark:text-emerald-300"
                  : "font-medium text-red-700 dark:text-red-300"
              }
            >
              {reachable ? "Tally is answering" : "The connector cannot reach Tally"}
            </p>
            {device.tallyMessage && (
              // Verbatim. Whatever the desktop saw is more useful than our summary of it.
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--spx-border)] bg-[var(--spx-input-bg)] p-2 font-mono text-xs text-[var(--spx-text)]">
                {device.tallyMessage}
              </pre>
            )}
          </div>
        </div>

        {!reachable && (
          <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
            <p className="font-semibold">On the Tally machine</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <Mono>F1 → Settings → Connectivity → Client/Server Configuration</Mono>
              </li>
              <li>
                TallyPrime acts as <strong>Both</strong>
              </li>
              <li>
                Enable ODBC <strong>Yes</strong>
              </li>
              <li>
                Port <strong>{port}</strong> — it must match the port the connector is configured
                with
              </li>
              <li>Restart Tally</li>
            </ol>
            <p className="pt-1">
              Then confirm <Mono>tally.exe</Mono> is running{" "}
              <strong>with the company loaded</strong>. A running{" "}
              <Mono>tallygatewayserver.exe</Mono> is a different component and is not enough on its
              own — the gateway answers only while the application has the company open.
            </p>
          </div>
        )}

        {educationMode && (
          <p className="text-xs text-[var(--spx-muted)]">
            Education mode is also reported here because its rejections come back blank; if a push
            fails with no reason at all, check the licence first.
          </p>
        )}
      </div>
    </Section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--spx-muted)]">{label}</dt>
      <dd
        className={`text-right text-[var(--spx-text)] ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
