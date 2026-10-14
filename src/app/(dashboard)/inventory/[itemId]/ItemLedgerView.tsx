"use client";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, Package } from "lucide-react";
import { formatCount, formatDate, formatMoney } from "@/lib/format";
import type { StockLedgerRow, StockPosition } from "@/lib/inventory/stockLedger";
import type { StockItemRow } from "@/lib/inventory/queries";

type RowJson = Omit<StockLedgerRow, "date"> & { date: string };
type PositionJson = Omit<StockPosition, "lastMovedAt"> & { lastMovedAt: string | null };
type ItemJson = Omit<StockItemRow, "tallySyncedAt"> & { tallySyncedAt: string | null };

/**
 * The stock ledger for one item.
 *
 * Every row is a real voucher and links to it, because the reason to be on
 * this screen is almost always to go and correct one. The running balance is
 * carried in its own column rather than left to be added up: an accountant
 * scanning for the entry that took a balance negative is looking for the row
 * where the number crosses zero, and that is only a glance if the number is
 * printed.
 *
 * Draft and approved vouchers are shown alongside posted ones and marked. They
 * are part of why the balance is what it is about to be, and hiding them would
 * make this screen disagree with the summary's "including pending" view for no
 * visible reason.
 */

const TYPE_LABEL: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sale",
  JOURNAL: "Journal",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  CONTRA: "Contra",
};

const STATUS_STYLE: Record<string, string> = {
  POSTED: "text-emerald-500",
  APPROVED: "text-sky-400",
  DRAFT: "text-[var(--spx-muted)]",
  EXPORTED_DEMO: "text-[var(--spx-muted)]",
};

function qtyText(n: number, unit: string | null): string {
  const body = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(n);
  return unit ? `${body} ${unit}` : body;
}

export default function ItemLedgerView({
  clientName,
  item,
  position,
  rows,
}: {
  clientName: string;
  item: ItemJson;
  position: PositionJson;
  rows: RowJson[];
}) {
  return (
    <>
      <Link
        href="/inventory"
        className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-[var(--spx-muted)] transition-colors duration-150 hover:text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        All stock
      </Link>

      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">{item.name}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--spx-muted)]">
          <span>{clientName}</span>
          {item.alias && <span>alias {item.alias}</span>}
          <span>{item.unit ? `Unit ${item.unit}` : "No unit set"}</span>
          {item.hsnCode && <span>HSN {item.hsnCode}</span>}
          {item.gstRate != null && <span>GST {item.gstRate}%</span>}
          <span>
            {item.tallySyncedAt
              ? `In Tally since ${formatDate(item.tallySyncedAt)}`
              : "Not in Tally yet"}
          </span>
        </p>
      </header>

      {/* The five numbers that make up the balance, in the order they compose:
          opening, in, out, closing. A reader can check the arithmetic across
          the row, which is the fastest way to trust a computed figure. */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Opening" value={qtyText(position.openingQty, item.unit)} sub={formatMoney(position.openingValue, { paise: false })} />
        <Stat label="Came in" value={qtyText(position.inQty, item.unit)} sub={formatMoney(position.inValue, { paise: false })} tone="in" />
        <Stat label="Went out" value={qtyText(position.outQty, item.unit)} sub={formatMoney(position.outValue, { paise: false })} tone="out" />
        <Stat
          label="On hand"
          value={qtyText(position.closingQty, item.unit)}
          sub={
            position.closingRate != null
              ? `${formatMoney(position.closingValue, { paise: false })} @ ${formatMoney(position.closingRate)}`
              : formatMoney(position.closingValue, { paise: false })
          }
          tone={position.closingQty < 0 ? "bad" : "strong"}
        />
      </div>

      {position.wentNegative && (
        <div
          role="status"
          className="mb-6 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-[var(--spx-text-secondary)]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden="true" />
          <p>
            This item has gone out more than it ever came in. Either the opening stock was never
            entered under <span className="text-[var(--spx-text)]">Items</span>, or its purchases
            are being posted against a different item name. The rows below that carry a warning are
            the ones where the balance was negative.
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-10 text-center">
          <Package className="mx-auto size-8 text-[var(--spx-muted)]" strokeWidth={1.5} />
          <h2 className="mt-3 font-semibold text-[var(--spx-text)]">No movement yet</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-[var(--spx-muted)]">
            No voucher in this workspace has named {item.name}. It will start moving as soon as a
            bill or a sheet row uses that item name — matching is on the name, so a spelling that
            differs posts a plain ledger line and moves nothing.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--spx-border)]">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Every voucher line that moved {item.name}, oldest first, with the running balance
              after each.
            </caption>
            <thead className="bg-[var(--spx-input-bg)] text-left text-[var(--spx-muted)]">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Date</th>
                <th scope="col" className="px-4 py-2 font-medium">Voucher</th>
                <th scope="col" className="px-4 py-2 font-medium">Party</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">In</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Out</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Rate</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Value</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={`${r.voucherId}-${idx}`}
                  className="border-t border-[var(--spx-border)] hover:bg-[var(--spx-hover-bg)]"
                >
                  <td className="whitespace-nowrap px-4 py-2 text-[var(--spx-muted)]">
                    {formatDate(r.date)}
                  </td>
                  <th scope="row" className="px-4 py-2 text-left font-normal">
                    <Link
                      href={`/vouchers/${r.voucherId}`}
                      className="text-[var(--spx-text)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)]"
                    >
                      {TYPE_LABEL[r.voucherType] ?? r.voucherType}
                    </Link>
                    {r.reference && (
                      <span className="ml-2 text-xs text-[var(--spx-muted)]">{r.reference}</span>
                    )}
                    <span
                      className={`ml-2 text-xs ${STATUS_STYLE[r.status] ?? "text-[var(--spx-muted)]"}`}
                    >
                      {r.status === "POSTED" ? "in Tally" : r.status.toLowerCase()}
                    </span>
                    {r.warning === "VALUE_WITHOUT_QTY" && (
                      <span
                        className="ml-2 text-xs text-amber-400"
                        title="This line carries an amount but no quantity, so it moved value and not stock."
                      >
                        no qty
                      </span>
                    )}
                  </th>
                  <td className="px-4 py-2 text-[var(--spx-text-secondary)]">
                    {r.partyName ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-emerald-500">
                    {r.direction === "IN" && r.qty ? formatCount(r.qty) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-rose-400">
                    {r.direction === "OUT" && r.qty ? formatCount(r.qty) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--spx-muted)]">
                    {r.rate != null ? formatMoney(r.rate) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-[var(--spx-text-secondary)]">
                    {formatMoney(r.value, { paise: false })}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-medium tabular-nums ${
                      r.balanceQty < 0 ? "text-red-400" : "text-[var(--spx-text)]"
                    }`}
                  >
                    {qtyText(r.balanceQty, item.unit)}
                    {r.warning === "NEGATIVE_STOCK" && (
                      <AlertTriangle
                        className="ml-1 inline size-3 text-amber-400"
                        aria-label="balance went negative here"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--spx-muted)]">
        Built from {formatCount(rows.length)} voucher line
        {rows.length === 1 ? "" : "s"} in this workspace, valued at weighted average cost. Entries
        made directly in Tally are not counted.
      </p>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "plain" | "in" | "out" | "strong" | "bad";
}) {
  const color =
    tone === "in"
      ? "text-emerald-500"
      : tone === "out"
        ? "text-rose-400"
        : tone === "bad"
          ? "text-red-400"
          : "text-[var(--spx-text)]";

  return (
    <div className="rounded-xl border border-[var(--spx-border)] bg-[var(--spx-card)] p-4">
      <div className="text-xs uppercase tracking-wide text-[var(--spx-muted)]">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-[var(--spx-muted)]">{sub}</div>
    </div>
  );
}
