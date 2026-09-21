"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { InventoryItem } from "./InventoryClient";

/**
 * Copy an item list into another client's workspace.
 *
 * Vyapar TaxOne ships this as "Copy Stock Item Master" and it is the one part
 * of their Master module that saves real time: two companies in the same trade
 * keep close to the same chart of items, and re-typing forty items with their
 * units and HSN codes is an afternoon.
 *
 * What is deliberately not copied is anything that belongs to the source
 * client's books rather than to the item itself — opening stock, the Tally
 * GUID, the synced-at stamp. An opening quantity is a fact about one company's
 * godown on one date; carrying it across would silently hand the target client
 * stock they never had.
 */
export default function CloneItemsDialog({
  items,
  targets,
  onClose,
}: {
  items: InventoryItem[];
  targets: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const selectId = useId();

  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);

  const target = targets.find((t) => t.id === targetId);

  async function clone() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stock-items/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetClientId: targetId }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Could not copy the items");
      else {
        setResult({ created: data.created ?? 0, skipped: data.skipped ?? 0 });
        router.refresh();
      }
    } catch {
      setError("Could not copy the items");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <ConfirmDialog
        title="Items copied"
        destructive={false}
        body={
          <p>
            {result.created} item{result.created === 1 ? "" : "s"} created in{" "}
            <span className="font-medium text-[var(--spx-text)]">{target?.name}</span>
            {result.skipped > 0 && (
              <>
                {" "}
                · {result.skipped} skipped because an item of the same name was already there
              </>
            )}
            . They reach that client&apos;s Tally on its next master sync.
          </p>
        }
        confirmLabel="Done"
        onConfirm={onClose}
        onCancel={onClose}
      />
    );
  }

  return (
    <ConfirmDialog
      title="Copy items to another client"
      destructive={false}
      busy={busy}
      body={
        <div className="space-y-3">
          <p>
            All {items.length} item{items.length === 1 ? "" : "s"} — name, unit, HSN and GST rate —
            will be created in the client you pick. An item whose name is already there is left
            alone rather than overwritten.
          </p>
          <p className="text-xs text-[var(--spx-muted)]">
            Opening stock is not copied. It describes one company&apos;s godown on one date, and
            carrying it over would give the target client stock it never held.
          </p>

          <div>
            <label
              htmlFor={selectId}
              className="mb-1 block text-xs text-[var(--spx-muted)]"
            >
              Copy into
            </label>
            <select
              id={selectId}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-[var(--spx-border)] bg-[var(--spx-input-bg)] px-3 text-sm text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--spx-active-border)]"
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-500" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>
      }
      confirmLabel={
        busy ? "Copying…" : `Copy ${items.length} item${items.length === 1 ? "" : "s"}`
      }
      onConfirm={() => void clone()}
      onCancel={onClose}
    />
  );
}
