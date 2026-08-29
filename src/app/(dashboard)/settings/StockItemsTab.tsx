"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Plus, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The client's stock item masters.
 *
 * These are not a reference list, they are the switch. A voucher line becomes
 * an inventory allocation only if an item of that name exists here, so a firm
 * doing a services client's books has an empty tab and nothing changes for
 * them, while a firm doing a trader's books uploads the item list once and
 * every purchase after that moves the right quantities in Tally.
 *
 * The screen is shaped around one fact: Tally will not let a base unit change
 * once stock has moved against an item. Before that point the unit is editable;
 * after it, the field is closed and says why, because offering an edit that the
 * next push would reject is worse than offering none.
 */

interface StockItem {
  id: string;
  name: string;
  unit: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  alias: string | null;
  tallySyncedAt: string | null;
  usedOnVouchers: number;
}

export default function StockItemsTab() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [hsn, setHsn] = useState("");
  const [rate, setRate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stock-items");
      const data = await res.json();
      if (res.ok) setItems(data.items ?? []);
      else setError(data.error ?? "Could not load stock items");
    } catch {
      setError("Could not load stock items");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/stock-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, unit, hsnCode: hsn, gstRate: rate }),
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error ?? "Could not create that item");
      setName("");
      setUnit("");
      setHsn("");
      setRate("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    setNote(null);
    const res = await fetch(`/api/stock-items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Could not update that item");
    else {
      if (data.note) setNote(data.note);
      await load();
    }
  }

  async function remove(id: string) {
    setError(null);
    setNote(null);
    const res = await fetch(`/api/stock-items/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Could not remove that item");
    else {
      if (data.note) setNote(data.note);
      await load();
    }
  }

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? items.filter(
        (i) =>
          i.name.toLowerCase().includes(needle) ||
          (i.hsnCode ?? "").includes(needle) ||
          (i.alias ?? "").toLowerCase().includes(needle)
      )
    : items;

  const unsynced = items.filter((i) => !i.tallySyncedAt).length;
  const unitless = items.filter((i) => !i.unit).length;

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-[var(--spx-text)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}
      {note && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm text-[var(--spx-muted)]">
          {note}
        </div>
      )}

      {/* Add an item */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-5 shadow-xl">
        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-xs text-[var(--spx-muted)]">Item name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Widget 10mm" />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs text-[var(--spx-muted)]">Unit</label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Nos" />
        </div>
        <div className="w-36">
          <label className="mb-1 block text-xs text-[var(--spx-muted)]">HSN / SAC</label>
          <Input value={hsn} onChange={(e) => setHsn(e.target.value)} placeholder="84719000" />
        </div>
        <div className="w-24">
          <label className="mb-1 block text-xs text-[var(--spx-muted)]">GST %</label>
          <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="18" />
        </div>
        <Button onClick={add} disabled={busy || !name.trim() || !unit.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </Button>
      </div>

      <p className="text-xs text-[var(--spx-muted)]">
        A unit is required and cannot be changed once stock has moved against the item — Tally
        refuses to alter a base unit at that point. For a long list, upload a sheet instead:{" "}
        <span className="text-[var(--spx-text)]">Sheets → Stock items (masters)</span>.
      </p>

      {/* Health */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg border border-[var(--spx-border)] px-3 py-1.5 text-[var(--spx-muted)]">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          {unsynced > 0 && (
            <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-300">
              {unsynced} not in Tally yet — the next sync creates them
            </span>
          )}
          {unitless > 0 && (
            <span className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-red-300">
              {unitless} with no unit — vouchers naming them will be rejected
            </span>
          )}
        </div>
      )}

      {items.length > 8 && (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, alias or HSN"
        />
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-8 text-sm text-[var(--spx-muted)]">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-10 text-center">
          <Package className="mx-auto size-8 text-[var(--spx-muted)]" strokeWidth={1.5} />
          <h3 className="mt-3 font-semibold text-[var(--spx-text)]">No stock items</h3>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--spx-muted)]">
            This client&apos;s vouchers post ledger amounts only, which is right for a services
            business. Add items here — or upload the list under Sheets — and purchases naming them
            will start moving quantities in Tally too.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--spx-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--spx-input-bg)] text-left text-[var(--spx-muted)]">
              <tr>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium">HSN</th>
                <th className="px-4 py-2 font-medium">GST %</th>
                <th className="px-4 py-2 font-medium">In Tally</th>
                <th className="px-4 py-2 font-medium">Used</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-t border-[var(--spx-border)]">
                  <td className="px-4 py-2 text-[var(--spx-text)]">
                    {i.name}
                    {i.alias && (
                      <span className="ml-2 text-xs text-[var(--spx-muted)]">({i.alias})</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {i.usedOnVouchers > 0 ? (
                      <span
                        className="text-[var(--spx-muted)]"
                        title="Locked: Tally cannot change a base unit once stock has moved against the item."
                      >
                        {i.unit ?? "—"}
                      </span>
                    ) : (
                      <input
                        defaultValue={i.unit ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== (i.unit ?? "")) void patch(i.id, { unit: v });
                        }}
                        className="w-20 rounded border border-[var(--spx-border)] bg-transparent px-2 py-1"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={i.hsnCode ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== (i.hsnCode ?? "")) void patch(i.id, { hsnCode: v });
                      }}
                      className="w-28 rounded border border-[var(--spx-border)] bg-transparent px-2 py-1"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      defaultValue={i.gstRate ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== String(i.gstRate ?? "")) void patch(i.id, { gstRate: v });
                      }}
                      className="w-16 rounded border border-[var(--spx-border)] bg-transparent px-2 py-1"
                    />
                  </td>
                  <td className="px-4 py-2">
                    {i.tallySyncedAt ? (
                      <span className="text-emerald-400">yes</span>
                    ) : (
                      <span className="text-amber-400">queued</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[var(--spx-muted)]">
                    {i.usedOnVouchers || "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => void remove(i.id)}
                      disabled={i.usedOnVouchers > 0}
                      title={
                        i.usedOnVouchers > 0
                          ? "On a voucher already — removing it would leave those lines naming an item nothing knows about."
                          : "Remove from this workspace"
                      }
                      className="text-red-400 transition hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
