"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpDown,
  Copy,
  Info,
  Loader2,
  Package,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import type { StockException } from "@/lib/inventory/stockLedger";
import type { StockBasis } from "@/lib/inventory/queries";
import ItemMastersPanel from "./ItemMastersPanel";
import CloneItemsDialog from "./CloneItemsDialog";

/**
 * The stock screen: what is on hand, what is wrong, and the masters behind it.
 *
 * Three tabs rather than three pages, because the questions they answer are
 * asked in one sitting — "how much Widget is left", "why did that push fail",
 * "fix the unit" — and a page load between each one turns a two-minute check
 * into a navigation exercise.
 *
 * The summary leads with quantity, not value. Quantity is a fact the app can
 * state exactly; value depends on a costing method the client chose inside
 * Tally and which a voucher line does not record. Putting a rupee figure first
 * would invite a comparison with Tally's stock value that is allowed to differ.
 */

export interface PositionJson {
  openingQty: number;
  openingValue: number;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
  closingRate: number | null;
  movements: number;
  lastMovedAt: string | null;
  valueOnlyLines: number;
  wentNegative: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  unit: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  alias: string | null;
  openingQty: number | null;
  openingRate: number | null;
  tallySyncedAt: string | null;
  usedOnVouchers: number;
  position: PositionJson;
}

type Tab = "summary" | "masters" | "exceptions";
type SortKey = "name" | "closingQty" | "closingValue" | "lastMovedAt";

const SEVERITY_STYLE: Record<
  StockException["severity"],
  { border: string; bg: string; text: string; label: string }
> = {
  BLOCKING: {
    border: "border-red-500/30",
    bg: "bg-red-500/5",
    text: "text-red-400",
    label: "Blocking",
  },
  WARNING: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/5",
    text: "text-amber-400",
    label: "Check",
  },
  INFO: {
    border: "border-[var(--spx-border)]",
    bg: "bg-transparent",
    text: "text-[var(--spx-muted)]",
    label: "Note",
  },
};

/** A quantity with its unit, or an em dash. Never a bare number — "12" of what? */
function qty(n: number, unit: string | null): string {
  const body = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
  return unit ? `${body} ${unit}` : body;
}

export default function InventoryClient({
  clientName,
  basis,
  items,
  exceptions,
  otherClients,
}: {
  clientName: string;
  basis: StockBasis;
  items: InventoryItem[];
  exceptions: StockException[];
  otherClients: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("summary");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("name");
  const [desc, setDesc] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [cloning, setCloning] = useState(false);

  const blocking = exceptions.filter((e) => e.severity === "BLOCKING").length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(needle) ||
            (i.alias ?? "").toLowerCase().includes(needle) ||
            (i.hsnCode ?? "").includes(needle)
        )
      : items;

    const dir = desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "closingQty":
          return (a.position.closingQty - b.position.closingQty) * dir;
        case "closingValue":
          return (a.position.closingValue - b.position.closingValue) * dir;
        case "lastMovedAt": {
          // Items that have never moved sort last whichever way the column is
          // pointed: "no movement" is not a date, and letting it win the
          // descending sort buries every item that actually moved.
          const at = a.position.lastMovedAt ? Date.parse(a.position.lastMovedAt) : null;
          const bt = b.position.lastMovedAt ? Date.parse(b.position.lastMovedAt) : null;
          if (at === null && bt === null) return 0;
          if (at === null) return 1;
          if (bt === null) return -1;
          return (at - bt) * dir;
        }
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [items, q, sort, desc]);

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, i) => ({
          value: acc.value + i.position.closingValue,
          moved: acc.moved + i.position.movements,
          negative: acc.negative + (i.position.wentNegative ? 1 : 0),
        }),
        { value: 0, moved: 0, negative: 0 }
      ),
    [items]
  );

  function setBasis(next: StockBasis) {
    setSwitching(true);
    router.push(next === "ALL" ? "/inventory?basis=ALL" : "/inventory");
  }

  function sortBy(key: SortKey) {
    if (sort === key) setDesc((d) => !d);
    else {
      setSort(key);
      // Numbers are most useful largest-first; a name is not.
      setDesc(key !== "name");
    }
  }

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inventory</h1>
            <p className="mt-1 text-sm text-[var(--spx-muted)]">
              {clientName} · {formatCount(items.length)} item
              {items.length === 1 ? "" : "s"} ·{" "}
              {basis === "POSTED"
                ? "counting only what has been posted to Tally"
                : "counting drafts and approved vouchers too"}
            </p>
          </div>

          {items.length > 0 && otherClients.length > 0 && (
            <button
              type="button"
              onClick={() => setCloning(true)}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--spx-border)] px-4 text-sm text-[var(--spx-text)] transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
            >
              <Copy className="size-4" aria-hidden="true" />
              Copy items to another client
            </button>
          )}
        </div>
      </header>

      {/* What this screen is and is not. Stated once, at the top, because every
          number below invites a comparison with Tally's Stock Summary and the
          two are allowed to differ for a reason the user cannot guess. */}
      <div className="mb-6 flex items-start gap-2 rounded-xl border border-sky-500/25 bg-sky-500/5 p-3 text-sm text-[var(--spx-text-secondary)]">
        <Info className="mt-0.5 size-4 shrink-0 text-sky-400" aria-hidden="true" />
        <p>
          These balances are built from the vouchers this app posted, valued at weighted average
          cost. Entries your client punched directly into Tally are not counted here, and Tally
          values stock by whichever method each item is set to — so the{" "}
          <span className="text-[var(--spx-text)]">quantities</span> should agree with Tally and the{" "}
          <span className="text-[var(--spx-text)]">values</span> may not.
        </p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Inventory views"
        className="mb-6 flex flex-wrap gap-2 border-b border-[var(--spx-border)]"
      >
        {(
          [
            ["summary", "Stock summary"],
            ["masters", "Items"],
            ["exceptions", `Exceptions${blocking ? ` (${blocking})` : ""}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-11 cursor-pointer border-b-2 px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none ${
              tab === key
                ? "border-[var(--spx-active-border)] text-[var(--spx-text)]"
                : "border-transparent text-[var(--spx-muted)] hover:text-[var(--spx-text)]"
            }`}
          >
            {label}
            {key === "exceptions" && blocking > 0 && (
              <span className="ml-2 inline-block size-2 rounded-full bg-red-500" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-10 text-center">
          <Package className="mx-auto size-8 text-[var(--spx-muted)]" strokeWidth={1.5} />
          <h2 className="mt-3 font-semibold text-[var(--spx-text)]">No stock items yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--spx-muted)]">
            This client&apos;s vouchers post ledger amounts only, which is right for a services
            business. Add items — one at a time under <span className="text-[var(--spx-text)]">Items</span>,
            or as a sheet under <Link href="/sheets" className="underline">Sheet Upload → Stock items (masters)</Link> —
            and purchases naming them will start moving quantities in Tally.
          </p>
        </div>
      ) : tab === "summary" ? (
        <>
          {/* Basis switch and totals */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div
              role="group"
              aria-label="Which vouchers to count"
              className="inline-flex rounded-lg border border-[var(--spx-border)] p-1"
            >
              {(
                [
                  ["POSTED", "In Tally"],
                  ["ALL", "Including pending"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  disabled={switching}
                  aria-pressed={basis === key}
                  onClick={() => basis !== key && setBasis(key)}
                  className={`min-h-9 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors duration-150 disabled:cursor-wait motion-reduce:transition-none ${
                    basis === key
                      ? "bg-[var(--spx-input-bg)] text-[var(--spx-text)]"
                      : "text-[var(--spx-muted)] hover:text-[var(--spx-text)]"
                  }`}
                >
                  {switching && basis !== key ? (
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                  ) : (
                    label
                  )}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg border border-[var(--spx-border)] px-3 py-1.5 text-[var(--spx-muted)]">
                Stock value{" "}
                <span className="text-[var(--spx-text)]">
                  {formatMoney(totals.value, { paise: false })}
                </span>
              </span>
              <span className="rounded-lg border border-[var(--spx-border)] px-3 py-1.5 text-[var(--spx-muted)]">
                {formatCount(totals.moved)} movement{totals.moved === 1 ? "" : "s"}
              </span>
              {totals.negative > 0 && (
                <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-amber-300">
                  {totals.negative} went negative
                </span>
              )}
            </div>
          </div>

          {items.length > 8 && (
            <Input
              type="search"
              aria-label="Search stock by name, alias or HSN"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, alias or HSN"
              className="mb-4 min-h-11"
            />
          )}

          <div className="overflow-x-auto rounded-xl border border-[var(--spx-border)]">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Closing stock per item, with opening balance and movement in and out.
              </caption>
              <thead className="bg-[var(--spx-input-bg)] text-left text-[var(--spx-muted)]">
                <tr>
                  <SortHeader label="Item" active={sort === "name"} desc={desc} onClick={() => sortBy("name")} />
                  <th scope="col" className="px-4 py-2 text-right font-medium">Opening</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">In</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Out</th>
                  <SortHeader label="Closing" align="right" active={sort === "closingQty"} desc={desc} onClick={() => sortBy("closingQty")} />
                  <SortHeader label="Value" align="right" active={sort === "closingValue"} desc={desc} onClick={() => sortBy("closingValue")} />
                  <SortHeader label="Last moved" align="right" active={sort === "lastMovedAt"} desc={desc} onClick={() => sortBy("lastMovedAt")} />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const p = i.position;
                  return (
                    <tr
                      key={i.id}
                      className="border-t border-[var(--spx-border)] hover:bg-[var(--spx-hover-bg)]"
                    >
                      <th scope="row" className="px-4 py-2 text-left font-normal">
                        <Link
                          href={`/inventory/${i.id}`}
                          className="text-[var(--spx-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
                        >
                          {i.name}
                        </Link>
                        {!i.unit && (
                          <span className="ml-2 text-xs text-red-400">no unit</span>
                        )}
                        {i.alias && (
                          <span className="ml-2 text-xs text-[var(--spx-muted)]">({i.alias})</span>
                        )}
                      </th>
                      <td className="px-4 py-2 text-right text-[var(--spx-muted)] tabular-nums">
                        {p.openingQty ? qty(p.openingQty, i.unit) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.inQty ? (
                          <span className="inline-flex items-center gap-1 text-emerald-500">
                            <TrendingUp className="size-3" aria-hidden="true" />
                            {qty(p.inQty, i.unit)}
                          </span>
                        ) : (
                          <span className="text-[var(--spx-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {p.outQty ? (
                          <span className="inline-flex items-center gap-1 text-rose-400">
                            <TrendingDown className="size-3" aria-hidden="true" />
                            {qty(p.outQty, i.unit)}
                          </span>
                        ) : (
                          <span className="text-[var(--spx-muted)]">—</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          p.closingQty < 0 ? "text-red-400" : "text-[var(--spx-text)]"
                        }`}
                      >
                        {qty(p.closingQty, i.unit)}
                        {p.wentNegative && (
                          <AlertTriangle
                            className="ml-1 inline size-3 text-amber-400"
                            aria-label="went negative at some point"
                          />
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--spx-text-secondary)] tabular-nums">
                        {formatMoney(p.closingValue, { paise: false })}
                        {p.closingRate != null && (
                          <span className="block text-xs text-[var(--spx-muted)]">
                            @ {formatMoney(p.closingRate)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--spx-muted)]">
                        {p.lastMovedAt ? formatDate(p.lastMovedAt) : "never"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {shown.length === 0 && (
            <p className="mt-4 text-center text-sm text-[var(--spx-muted)]">
              Nothing matches “{q}”.
            </p>
          )}
        </>
      ) : tab === "masters" ? (
        <ItemMastersPanel items={items} />
      ) : (
        <ExceptionList exceptions={exceptions} />
      )}

      {cloning && (
        <CloneItemsDialog
          items={items}
          targets={otherClients}
          onClose={() => setCloning(false)}
        />
      )}
    </>
  );
}

function SortHeader({
  label,
  active,
  desc,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  desc: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      // aria-sort belongs on the header cell, not the button: it tells a screen
      // reader how the *column* is ordered, which is what makes the other
      // columns' silence meaningful.
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      className={`px-4 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex cursor-pointer items-center gap-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] ${
          active ? "text-[var(--spx-text)]" : ""
        }`}
      >
        {label}
        <ArrowUpDown className="size-3" aria-hidden="true" />
      </button>
    </th>
  );
}

function ExceptionList({ exceptions }: { exceptions: StockException[] }) {
  if (exceptions.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-10 text-center">
        <Package className="mx-auto size-8 text-emerald-500" strokeWidth={1.5} />
        <h2 className="mt-3 font-semibold text-[var(--spx-text)]">Nothing to fix</h2>
        <p className="mt-2 text-sm text-[var(--spx-muted)]">
          Every item has a unit, is in Tally, and has a balance that makes sense.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {exceptions.map((e, idx) => {
        const s = SEVERITY_STYLE[e.severity];
        return (
          <li
            key={`${e.itemId}-${e.kind}-${idx}`}
            className={`flex items-start gap-3 rounded-xl border ${s.border} ${s.bg} p-4`}
          >
            <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${s.text}`} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link
                  href={`/inventory/${e.itemId}`}
                  className="font-medium text-[var(--spx-text)] underline-offset-2 hover:underline"
                >
                  {e.itemName}
                </Link>
                <span className={`text-xs uppercase tracking-wide ${s.text}`}>{s.label}</span>
              </div>
              <p className="mt-1 text-sm text-[var(--spx-text-secondary)]">{e.message}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
