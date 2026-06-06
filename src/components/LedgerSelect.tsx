"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Loader2 } from "lucide-react";

export interface LedgerOption {
  id: string;
  name: string;
  group?: string;
  ledgerType?: string;
}

/**
 * Searchable ledger picker with inline "create ledger". Calls POST /api/ledgers
 * to create on the fly and reports the new ledger back to the parent.
 */
export function LedgerSelect({
  ledgers,
  value,
  onChange,
  onCreated,
  placeholder = "Select ledger…",
}: {
  ledgers: LedgerOption[];
  value: string | null;
  onChange: (ledgerId: string) => void;
  onCreated?: (ledger: LedgerOption) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = ledgers.find((l) => l.id === value) || null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ledgers.slice(0, 50);
    return ledgers.filter((l) => l.name.toLowerCase().includes(q)).slice(0, 50);
  }, [ledgers, query]);

  const exactExists = ledgers.some(
    (l) => l.name.toLowerCase() === query.trim().toLowerCase()
  );

  async function handleCreate() {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/ledgers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" }),
      });
      const data = await res.json();
      if (res.ok && data.ledger) {
        onCreated?.(data.ledger);
        onChange(data.ledger.id);
        setOpen(false);
        setQuery("");
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm text-left ${
          selected ? "border-gray-300 text-gray-900" : "border-red-300 text-red-500"
        }`}
      >
        <span className="truncate">{selected ? selected.name : placeholder}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="p-2 border-b">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or create…"
              className="w-full rounded border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => {
                  onChange(l.id);
                  setOpen(false);
                  setQuery("");
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 text-left"
              >
                <span className="truncate">{l.name}</span>
                {value === l.id && <Check className="h-4 w-4 text-blue-600" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
            )}
          </div>
          {query.trim() && !exactExists && (
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm border-t text-blue-600 hover:bg-blue-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
