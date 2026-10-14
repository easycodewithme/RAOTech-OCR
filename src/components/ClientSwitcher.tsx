"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Client = {
  id: string;
  name: string;
  gstin: string | null;
  isDefault: boolean;
};

type ClientSwitcherProps = {
  initialClients?: Client[];
  initialActiveId?: string | null;
};

/* ------------------------------------------------------- unsaved-work registry */

/**
 * Which client a document is filed under is decided by the *server*, at save
 * time, from the workspace's active client — not by anything held on the
 * screen that collected the document. So switching client here while another
 * screen is holding work it has not written yet does not merely change a
 * label: it changes which company's books that work lands in.
 *
 * Rather than teach the switcher about uploads (and then about bank
 * statements, and then about voucher review), any screen holding browser-only
 * work registers a one-line description of it here. The switcher asks one
 * question — "is anything unsaved?" — and knows nothing about who answered.
 *
 * Module-level rather than React context because the two ends live in
 * different subtrees: this control renders in the dashboard topbar, the work
 * sits in the routed page below it, and threading a provider between them
 * would put a re-render on the topbar for every keystroke in a form it does
 * not care about. A module-level Map is per-tab, which is exactly the scope of
 * the risk — a second tab has its own active-client cookie read anyway.
 */
type UnsavedWorkDescriber = () => string | null;

const unsavedWorkSources = new Map<symbol, UnsavedWorkDescriber>();

/**
 * Register a describer for as long as a screen is holding unsaved work.
 *
 * Returns its own unregister function so the caller can hand it straight back
 * from a `useEffect` cleanup: a registration that outlived its component would
 * be a describer closed over dead state, blocking every later switch with a
 * warning about work that no longer exists.
 *
 * The describer is a callback rather than a boolean because it is read at the
 * moment of the switch, not at the moment of registration — a page registers
 * once and keeps answering honestly as its own state moves underneath it.
 */
export function registerUnsavedWork(describe: UnsavedWorkDescriber): () => void {
  const key = Symbol("unsaved-work");
  unsavedWorkSources.set(key, describe);
  return () => {
    unsavedWorkSources.delete(key);
  };
}

/**
 * The first screen with something to lose, in its own words, or null when the
 * workspace is clean. Callers show this text verbatim: "3 extracted invoices
 * have not been saved yet" is a reason to stop, where "you have unsaved
 * changes" is a dialog people learn to click through without reading.
 */
export function describeUnsavedWork(): string | null {
  for (const describe of unsavedWorkSources.values()) {
    let message: string | null = null;
    try {
      message = describe();
    } catch {
      // A describer that throws must not be able to wedge the switcher shut.
      message = null;
    }
    if (message) return message;
  }
  return null;
}

/* ----------------------------------------------------------------- component */

export function ClientSwitcher({ initialClients, initialActiveId }: ClientSwitcherProps = {}) {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>(initialClients || []);
  const [activeId, setActiveId] = useState<string | null>(initialActiveId ?? null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  /** A switch held back because some screen reported unsaved work. */
  const [pendingSwitch, setPendingSwitch] = useState<{
    id: string;
    name: string;
    warning: string;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialClients && initialClients.length > 0) {
      setClients(initialClients);
    }
    if (initialActiveId) {
      setActiveId(initialActiveId);
    }
  }, [initialClients, initialActiveId]);

  const load = useCallback(async () => {
    const res = await fetch("/api/clients");
    if (!res.ok) return;
    const data = await res.json();
    setClients(data.clients || []);
    setActiveId(data.activeClientId);
  }, []);

  useEffect(() => {
    if (!initialClients || initialClients.length === 0) {
      void load();
    }
    // Deliberately mount-only: the server props are the fast path, and this is
    // the fallback for a caller that rendered without them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A menu that only closes by re-clicking its own trigger is a menu people
  // leave open over the content they were reading. Escape and an outside
  // pointer both close it. Suspended while the confirm is up, because that
  // dialog owns Escape and closes the menu itself on either answer.
  useEffect(() => {
    if (!open || pendingSwitch) return;
    function dismiss() {
      setOpen(false);
      setCreating(false);
    }
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) dismiss();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, pendingSwitch]);

  const active = clients.find((c) => c.id === activeId) || clients[0];

  /** The switch itself, once it is allowed to happen. */
  const commitSwitch = useCallback(
    async (id: string) => {
      setSaving(true);
      try {
        const res = await fetch("/api/clients", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: id }),
        });
        if (res.ok) {
          setActiveId(id);
          setOpen(false);
          setCreating(false);
          setPendingSwitch(null);
          // Server Components below this control resolve the active client on
          // the server; without a refresh the page keeps rendering the old one.
          router.refresh();
        }
      } finally {
        setSaving(false);
      }
    },
    [router]
  );

  /**
   * Every path that changes the active client goes through here, including
   * "create a client and jump to it" — a brand-new empty client is if anything
   * the worse place for an in-flight batch to land.
   */
  function requestSwitch(id: string, fallbackName?: string) {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    const warning = describeUnsavedWork();
    if (warning) {
      const target = clients.find((c) => c.id === id);
      // Close the menu behind the question: what is being decided is whether
      // to switch at all, and a live list of other clients underneath it is a
      // second decision competing with the first.
      setOpen(false);
      setPendingSwitch({
        id,
        name: target?.name ?? fallbackName ?? "the selected client",
        warning,
      });
      return;
    }
    void commitSwitch(id);
  }

  async function createClient() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.client) {
        setNewName("");
        setCreating(false);
        // Load first, so the new row is on screen whether or not the switch to
        // it is then held back by the guard.
        await load();
        requestSwitch(data.client.id, data.client.name);
      }
    } finally {
      setSaving(false);
    }
  }

  const switchingAwayFrom = active?.name ?? "the current client";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Active client: ${active?.name || "none selected"}. Change client.`}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 border border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--spx-text)] transition-colors duration-150 hover:bg-[var(--spx-card-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
      >
        <Building2 className="size-[15px] shrink-0 text-[var(--spx-muted)]" strokeWidth={1.5} />
        <span className="max-w-[110px] truncate sm:max-w-[160px]">
          {active?.name || "Select client"}
        </span>
        {saving ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--spx-muted)] motion-reduce:animate-none" />
        ) : (
          <ChevronDown
            className={`size-3.5 shrink-0 text-[var(--spx-muted)] transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Switching is a server write with consequences two screens away, so it
          is announced rather than left to the spinner alone. */}
      <span role="status" aria-live="polite" className="sr-only">
        {saving ? "Switching client…" : ""}
      </span>

      {open && (
        <div
          role="menu"
          aria-label="Clients"
          className="absolute right-0 z-50 mt-1 w-[280px] max-w-[calc(100vw-2rem)] border border-[var(--spx-border)] bg-[var(--spx-card)] shadow-2xl"
        >
          <div className="border-b border-[var(--spx-border)] px-3.5 py-2.5">
            <span className="text-[10px] font-medium uppercase tracking-[1.5px] text-[var(--spx-muted)]">
              Clients
            </span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {clients.map((c) => (
              <button
                key={c.id}
                type="button"
                role="menuitemradio"
                aria-checked={c.id === activeId}
                disabled={saving}
                onClick={() => requestSwitch(c.id)}
                className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[13px] transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-[var(--spx-text)]">{c.name}</span>
                  {c.gstin && (
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--spx-muted)]">
                      {c.gstin}
                    </span>
                  )}
                </span>
                {c.id === activeId && (
                  // emerald-600 in light, -400 in dark: one shade cannot clear
                  // 3:1 against both a white card and a near-black one.
                  <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--spx-border)] p-2">
            {creating ? (
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void createClient();
                  }}
                  placeholder="Client name"
                  aria-label="New client name"
                  className="h-11 rounded-none border-[var(--spx-border)] bg-[var(--spx-input-bg)] text-[var(--spx-text)]"
                  autoFocus
                />
                <Button
                  size="sm"
                  onClick={createClient}
                  disabled={saving || !newName.trim()}
                  className="min-h-11 cursor-pointer rounded-none bg-[var(--spx-text)] font-bold text-[var(--spx-canvas)]"
                >
                  Add
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="min-h-11 w-full cursor-pointer rounded-none border-[var(--spx-border)] text-[var(--spx-text-secondary)]"
                onClick={() => setCreating(true)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> New client
              </Button>
            )}
          </div>
        </div>
      )}

      {pendingSwitch && (
        <ConfirmDialog
          title={`Switch to ${pendingSwitch.name} with work still open?`}
          body={
            <>
              <p>
                <strong className="text-[var(--spx-text)]">{pendingSwitch.warning}</strong> on the
                screen behind this dialog, under{" "}
                <strong className="text-[var(--spx-text)]">{switchingAwayFrom}</strong>.
              </p>
              <p className="mt-2">
                Documents are filed under whichever client is active at the moment they are saved,
                not the one that was active when they were added. Switch now and that work goes
                into <strong className="text-[var(--spx-text)]">{pendingSwitch.name}</strong>
                &apos;s books instead.
              </p>
            </>
          }
          confirmLabel={saving ? "Switching…" : `Switch to ${pendingSwitch.name}`}
          busy={saving}
          onConfirm={() => void commitSwitch(pendingSwitch.id)}
          onCancel={() => {
            setPendingSwitch(null);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
