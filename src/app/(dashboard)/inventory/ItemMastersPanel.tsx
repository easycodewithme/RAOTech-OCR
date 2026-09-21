"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatCount, formatDate } from "@/lib/format";
import type { InventoryItem } from "./InventoryClient";

/**
 * The item masters, and the only place a base unit can still be corrected.
 *
 * This is the old Settings → Stock Items tab with two things it never had:
 * opening stock, and a reason to be next to the balances it produces.
 *
 * Opening stock is the larger of the two. `openingQty` and `openingRate` have
 * been on the model and in the bulk-upload mapping since inventory was added,
 * and nothing has ever displayed or edited them — a firm that uploaded a sheet
 * with an opening quantity column had the number stored and invisible. They
 * are also the only way a mid-year client gets a closing balance that means
 * anything, because the app cannot see the purchases that happened before it
 * did.
 *
 * The unit rule stays: Tally will not alter a base unit once stock has moved
 * against an item, so the field closes as soon as the item is on a voucher and
 * says why rather than failing on the next push.
 */
export default function ItemMastersPanel({ items }: { items: InventoryItem[] }) {
  const router = useRouter();
  const fieldId = useId();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [hsn, setHsn] = useState("");
  const [rate, setRate] = useState("");

  const [pendingDelete, setPendingDelete] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      router.refresh();
    } catch {
      setError("Could not create that item");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/stock-items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not update that item");
      else {
        if (data.note) setNote(data.note);
        router.refresh();
      }
    } catch {
      setError("Could not update that item");
    }
  }

  async function remove(id: string) {
    setError(null);
    setNote(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/stock-items/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not remove that item");
      else {
        if (data.note) setNote(data.note);
        router.refresh();
      }
    } catch {
      setError("Could not remove that item");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
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

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-[var(--spx-text)]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
      {note && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm text-[var(--spx-text-secondary)]"
        >
          {note}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-5 shadow-xl">
        <div className="min-w-[200px] flex-1">
          <label htmlFor={`${fieldId}-name`} className="mb-1 block text-xs text-[var(--spx-muted)]">
            Item name
          </label>
          <Input
            id={`${fieldId}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Widget 10mm"
            className="min-h-11"
          />
        </div>
        <div className="w-28">
          <label htmlFor={`${fieldId}-unit`} className="mb-1 block text-xs text-[var(--spx-muted)]">
            Unit
          </label>
          <Input
            id={`${fieldId}-unit`}
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Nos"
            className="min-h-11"
          />
        </div>
        <div className="w-36">
          <label htmlFor={`${fieldId}-hsn`} className="mb-1 block text-xs text-[var(--spx-muted)]">
            HSN / SAC
          </label>
          <Input
            id={`${fieldId}-hsn`}
            value={hsn}
            onChange={(e) => setHsn(e.target.value)}
            placeholder="84719000"
            className="min-h-11"
          />
        </div>
        <div className="w-24">
          <label htmlFor={`${fieldId}-rate`} className="mb-1 block text-xs text-[var(--spx-muted)]">
            GST %
          </label>
          <Input
            id={`${fieldId}-rate`}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="18"
            className="min-h-11"
          />
        </div>
        <Button
          onClick={add}
          disabled={busy || !name.trim() || !unit.trim()}
          className="min-h-11 cursor-pointer"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          Add
        </Button>
      </div>

      <p className="text-xs text-[var(--spx-muted)]">
        A unit is required and cannot be changed once stock has moved against the item — Tally
        refuses to alter a base unit at that point. For a long list, upload a sheet instead:{" "}
        <Link href="/sheets" className="underline">
          Sheet Upload → Stock items (masters)
        </Link>
        .
      </p>

      {items.length > 8 && (
        <Input
          type="search"
          aria-label="Search stock items by name, alias or HSN"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, alias or HSN"
          className="min-h-11"
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--spx-border)]">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Stock item masters. Unit, HSN, GST rate and opening stock are editable in place.
          </caption>
          <thead className="bg-[var(--spx-input-bg)] text-left text-[var(--spx-muted)]">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Item</th>
              <th scope="col" className="px-4 py-2 font-medium">Unit</th>
              <th scope="col" className="px-4 py-2 font-medium">HSN</th>
              <th scope="col" className="px-4 py-2 font-medium">GST %</th>
              <th scope="col" className="px-4 py-2 font-medium">Opening qty</th>
              <th scope="col" className="px-4 py-2 font-medium">Opening rate</th>
              <th scope="col" className="px-4 py-2 font-medium">In Tally</th>
              <th scope="col" className="px-4 py-2 font-medium">Used</th>
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} className="border-t border-[var(--spx-border)]">
                <th scope="row" className="px-4 py-2 text-left font-normal text-[var(--spx-text)]">
                  <Link
                    href={`/inventory/${i.id}`}
                    className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
                  >
                    {i.name}
                  </Link>
                  {i.alias && (
                    <span className="ml-2 text-xs text-[var(--spx-muted)]">({i.alias})</span>
                  )}
                </th>
                <td className="px-4 py-2">
                  {i.usedOnVouchers > 0 ? (
                    <span
                      className="text-[var(--spx-muted)]"
                      title="Locked: Tally cannot change a base unit once stock has moved against the item."
                    >
                      {i.unit ?? "—"}
                    </span>
                  ) : (
                    <InlineField
                      label={`Unit for ${i.name}`}
                      defaultValue={i.unit ?? ""}
                      width="w-20"
                      onCommit={(v) => {
                        if (v && v !== (i.unit ?? "")) void patch(i.id, { unit: v });
                      }}
                    />
                  )}
                </td>
                <td className="px-4 py-2">
                  <InlineField
                    label={`HSN or SAC code for ${i.name}`}
                    defaultValue={i.hsnCode ?? ""}
                    width="w-28"
                    inputMode="numeric"
                    onCommit={(v) => {
                      if (v !== (i.hsnCode ?? "")) void patch(i.id, { hsnCode: v });
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  <InlineField
                    label={`GST rate percent for ${i.name}`}
                    defaultValue={i.gstRate == null ? "" : String(i.gstRate)}
                    width="w-16"
                    inputMode="decimal"
                    onCommit={(v) => {
                      if (v !== String(i.gstRate ?? "")) void patch(i.id, { gstRate: v });
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  <InlineField
                    label={`Opening quantity for ${i.name}`}
                    defaultValue={i.openingQty == null ? "" : String(i.openingQty)}
                    width="w-24"
                    inputMode="decimal"
                    onCommit={(v) => {
                      if (v !== String(i.openingQty ?? "")) void patch(i.id, { openingQty: v });
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  <InlineField
                    label={`Opening rate per unit for ${i.name}`}
                    defaultValue={i.openingRate == null ? "" : String(i.openingRate)}
                    width="w-24"
                    inputMode="decimal"
                    onCommit={(v) => {
                      if (v !== String(i.openingRate ?? "")) void patch(i.id, { openingRate: v });
                    }}
                  />
                </td>
                <td className="px-4 py-2">
                  {i.tallySyncedAt ? (
                    <span className="text-emerald-600">{formatDate(i.tallySyncedAt, "yes")}</span>
                  ) : (
                    <span className="text-amber-500">queued</span>
                  )}
                </td>
                <td className="px-4 py-2 text-[var(--spx-muted)]">
                  {i.usedOnVouchers ? formatCount(i.usedOnVouchers) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setPendingDelete(i)}
                    disabled={i.usedOnVouchers > 0}
                    aria-label={`Remove ${i.name} from this workspace`}
                    title={
                      i.usedOnVouchers > 0
                        ? "On a voucher already — removing it would leave those lines naming an item nothing knows about."
                        : "Remove from this workspace"
                    }
                    className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-red-500 transition-colors duration-150 hover:bg-red-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-30 motion-reduce:transition-none"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--spx-muted)]">
        Opening stock is what the client held before this app started keeping their books. It is
        counted into every balance on the Stock summary.{" "}
        <span className="text-[var(--spx-text-secondary)]">
          It is not sent to Tally — set the opening balance there on the item itself.
        </span>{" "}
        Tally replays the original error for any master name whose create has ever failed, so an
        untested tag in the master XML would poison the name on the first push; this one is
        deliberately left until it can be measured against a live company.
      </p>

      {pendingDelete && (
        <ConfirmDialog
          title="Remove this stock item?"
          body={
            <>
              <p>
                <span className="font-medium text-[var(--spx-text)]">{pendingDelete.name}</span> will
                be removed from this workspace.
              </p>
              <p className="mt-2">
                {pendingDelete.tallySyncedAt
                  ? "It has already been created in the client's Tally, and removing it here does not remove it there. Future vouchers naming this item will post ledger amounts only, with no quantity moved."
                  : "It has not reached Tally yet, so nothing changes in the client's books. Future vouchers naming this item will post ledger amounts only, with no quantity moved."}
              </p>
            </>
          }
          confirmLabel={deleting ? "Removing…" : "Remove item"}
          busy={deleting}
          onConfirm={() => void remove(pendingDelete.id)}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

/**
 * An in-place cell edit that saves on blur, and on Enter.
 *
 * Blur alone was the whole interaction before, which is fine with a mouse and
 * a dead end on a keyboard: the natural thing to do after typing a value is
 * press Enter, and pressing Enter did nothing at all. Escape restores the
 * value the row was rendered with, so a half-typed correction can be abandoned
 * without needing to remember what was there.
 */
function InlineField({
  label,
  defaultValue,
  width,
  inputMode,
  onCommit,
}: {
  label: string;
  defaultValue: string;
  width: string;
  inputMode?: "numeric" | "decimal";
  onCommit: (value: string) => void;
}) {
  return (
    <input
      aria-label={label}
      inputMode={inputMode}
      defaultValue={defaultValue}
      onBlur={(e) => onCommit(e.target.value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.currentTarget.value = defaultValue;
          e.currentTarget.blur();
        }
      }}
      className={`min-h-11 ${width} rounded border border-[var(--spx-border)] bg-transparent px-2 py-1 text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--spx-active-border)]`}
    />
  );
}
