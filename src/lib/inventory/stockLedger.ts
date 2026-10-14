/**
 * What the client's stock has done, worked out from the vouchers we posted.
 *
 * The app has never been able to answer "how much of this is left?". It writes
 * quantities into Tally and never reads them back, so the only place that
 * knows a closing balance is Tally itself — which means opening Tally to check
 * the work the app just did. Every voucher line that moves stock is already in
 * our database with a quantity, a unit and an amount, so the balance is
 * derivable here and always has been.
 *
 * Two things this is *not*, and both matter enough to say on screen rather
 * than only here:
 *
 *  1. **It is not Tally's stock summary.** It counts the movement this app
 *     posted and nothing else. A client whose staff also punch vouchers
 *     directly into Tally has movement we cannot see, and the two figures will
 *     differ by exactly that. Pulling Tally's own numbers back needs a new
 *     connector job kind (`internal/runner/runner.go` only fetches companies
 *     and ledgers today), so until that exists this is "what we sent", framed
 *     as such.
 *
 *  2. **It is not a costing engine.** Valuation here is weighted average,
 *     because it is the only method that can be computed from what a voucher
 *     line carries. Tally can be set to FIFO or Last Purchase Cost per item,
 *     and where it is, the value below will differ from Tally's while the
 *     *quantity* still agrees. Quantity is the number to trust and the one the
 *     UI leads with.
 */

import type { VoucherStatus, VoucherType } from "@prisma/client";

/**
 * One voucher line that named a stock item.
 *
 * Deliberately a plain shape rather than a Prisma row: the engine is pure so a
 * test can drive it with six literals instead of a database, and so a future
 * caller holding Tally-pulled movement can feed the same function.
 */
export interface StockMovementInput {
  voucherId: string;
  voucherType: VoucherType;
  status: VoucherStatus;
  date: Date;
  /** Narration or the invoice number — whatever names the document on screen. */
  reference?: string | null;
  /** The other side of the entry: the supplier or customer, when there is one. */
  partyName?: string | null;
  /** Absolute quantity. Direction comes from debit/credit, never from a sign here. */
  quantity: number | null;
  /** Exactly one of these is non-zero on a real line. */
  debit: number;
  credit: number;
  rate?: number | null;
}

export interface StockOpening {
  qty: number | null;
  rate: number | null;
}

export type Direction = "IN" | "OUT";

/**
 * Which way a line moves stock.
 *
 * The rule is the one `exportXml.ts` already encodes for `ISDEEMEDPOSITIVE`: a
 * debit stock line is goods coming in, a credit stock line is goods going out.
 * Reading it off debit/credit rather than off `voucherType` is what makes
 * returns fall out for free — a purchase return is a credit line on a
 * DEBIT_NOTE and leaves the building, a sales return is a debit line on a
 * CREDIT_NOTE and comes back — with no list of voucher types to keep in step
 * with the one in the exporter.
 */
export function directionOf(line: Pick<StockMovementInput, "debit" | "credit">): Direction {
  return line.debit > 0 ? "IN" : "OUT";
}

/** The line's own money value, whichever side it sits on. */
export function valueOf(line: Pick<StockMovementInput, "debit" | "credit">): number {
  return line.debit > 0 ? line.debit : line.credit;
}

/**
 * A movement with the running balance as it stood immediately after it.
 *
 * `balanceQty` is cumulative, so the rows are only meaningful in date order
 * and `buildStockLedger` is what guarantees that order.
 */
export interface StockLedgerRow {
  voucherId: string;
  voucherType: VoucherType;
  status: VoucherStatus;
  date: Date;
  reference: string | null;
  partyName: string | null;
  direction: Direction;
  /** Always positive. The direction says which way it went. */
  qty: number | null;
  /** Per-unit rate: the line's own, or derived from value ÷ quantity. */
  rate: number | null;
  value: number;
  balanceQty: number;
  balanceValue: number;
  /**
   * Set when this row made the running balance impossible rather than merely
   * small — stock going out that was never recorded coming in. Surfaced per
   * row because the item-level total says a number is wrong without saying
   * which entry made it wrong.
   */
  warning?: "NEGATIVE_STOCK" | "VALUE_WITHOUT_QTY";
}

export interface StockPosition {
  openingQty: number;
  openingValue: number;
  inQty: number;
  inValue: number;
  outQty: number;
  outValue: number;
  closingQty: number;
  closingValue: number;
  /** Weighted average cost of what is left, or null when nothing is left. */
  closingRate: number | null;
  movements: number;
  lastMovedAt: Date | null;
  /** Rows whose quantity is missing, so value moved and quantity did not. */
  valueOnlyLines: number;
  /** True once the running quantity has been below zero at any point. */
  wentNegative: boolean;
}

/** A quantity that is zero for every practical purpose, after float drift. */
const EPSILON = 1e-9;

function clean(n: number): number {
  return Math.abs(n) < EPSILON ? 0 : n;
}

/**
 * Order movements the way a ledger reads.
 *
 * Date alone is not a total order — a day's purchases and sales all carry
 * midnight — so `voucherId` breaks ties. It is arbitrary but stable, which is
 * what stops the running balance column from reshuffling between two loads of
 * the same page.
 */
function chronological(a: StockMovementInput, b: StockMovementInput): number {
  const d = a.date.getTime() - b.date.getTime();
  if (d !== 0) return d;
  return a.voucherId < b.voucherId ? -1 : a.voucherId > b.voucherId ? 1 : 0;
}

/**
 * Replay every movement against the opening balance.
 *
 * Weighted average, and the averaging only happens on the way out: goods
 * coming in carry their own cost, goods going out are relieved at the average
 * of what is on hand. That is the standard treatment, and it is also the only
 * one available — a voucher line records what this consignment cost, not which
 * earlier consignment it came from, so FIFO is not reconstructable from it.
 */
export function buildStockLedger(
  opening: StockOpening,
  movements: StockMovementInput[]
): { rows: StockLedgerRow[]; position: StockPosition } {
  const openingQty = clean(opening.qty ?? 0);
  const openingValue = clean(openingQty * (opening.rate ?? 0));

  let qty = openingQty;
  let value = openingValue;

  let inQty = 0;
  let inValue = 0;
  let outQty = 0;
  let outValue = 0;
  let valueOnlyLines = 0;
  let wentNegative = false;
  let lastMovedAt: Date | null = null;

  const rows: StockLedgerRow[] = [];

  for (const m of [...movements].sort(chronological)) {
    const direction = directionOf(m);
    const lineValue = clean(valueOf(m));
    const q = m.quantity == null ? null : Math.abs(m.quantity);

    let warning: StockLedgerRow["warning"];

    if (q == null || q === 0) {
      /**
       * A line with money and no quantity. It happens when a sheet mapped an
       * amount column and no quantity column, and it is worth counting rather
       * than dropping: the value is real and belongs in the total, but a
       * closing quantity computed as if these lines did not exist would be
       * quietly short. Tally has the same entry with the same missing
       * quantity, so this is a faithful reading, not a defect here.
       */
      valueOnlyLines += 1;
      warning = "VALUE_WITHOUT_QTY";
      if (direction === "IN") {
        value = clean(value + lineValue);
        inValue = clean(inValue + lineValue);
      } else {
        value = clean(value - lineValue);
        outValue = clean(outValue + lineValue);
      }
    } else if (direction === "IN") {
      qty = clean(qty + q);
      value = clean(value + lineValue);
      inQty = clean(inQty + q);
      inValue = clean(inValue + lineValue);
    } else {
      /**
       * Relieve at the average held *before* this issue, not after — using the
       * post-issue average would make the cost of a sale depend on itself.
       *
       * With nothing on hand there is no average to relieve at, so the line's
       * own rate stands in. That keeps the value column honest about the money
       * while the quantity column goes negative and says so.
       */
      const avg = qty > EPSILON ? value / qty : null;
      const relief = avg != null ? clean(q * avg) : lineValue;

      qty = clean(qty - q);
      value = clean(value - relief);
      outQty = clean(outQty + q);
      outValue = clean(outValue + relief);

      if (qty < -EPSILON) {
        wentNegative = true;
        warning = "NEGATIVE_STOCK";
      }
    }

    lastMovedAt = m.date;

    rows.push({
      voucherId: m.voucherId,
      voucherType: m.voucherType,
      status: m.status,
      date: m.date,
      reference: m.reference ?? null,
      partyName: m.partyName ?? null,
      direction,
      qty: q,
      rate: m.rate ?? (q && q > 0 ? clean(lineValue / q) : null),
      value: lineValue,
      balanceQty: qty,
      balanceValue: value,
      ...(warning ? { warning } : {}),
    });
  }

  return {
    rows,
    position: {
      openingQty,
      openingValue,
      inQty,
      inValue,
      outQty,
      outValue,
      closingQty: qty,
      closingValue: value,
      closingRate: qty > EPSILON ? clean(value / qty) : null,
      movements: rows.length,
      lastMovedAt,
      valueOnlyLines,
      wentNegative,
    },
  };
}

/**
 * The same replay, for many items at once.
 *
 * The summary screen needs a position per item and none of the individual
 * rows, so this throws the rows away rather than holding a few thousand
 * objects to compute a dozen numbers.
 */
export function buildPositions(
  items: { id: string; openingQty: number | null; openingRate: number | null }[],
  movementsByItem: Map<string, StockMovementInput[]>
): Map<string, StockPosition> {
  const out = new Map<string, StockPosition>();
  for (const item of items) {
    const { position } = buildStockLedger(
      { qty: item.openingQty, rate: item.openingRate },
      movementsByItem.get(item.id) ?? []
    );
    out.set(item.id, position);
  }
  return out;
}

/**
 * Why an item would be refused by Tally, or would post something wrong.
 *
 * This is the list the old Stock Items tab reduced to two counters in a
 * coloured pill. Naming the item and the fix is the difference between "3 with
 * no unit" and knowing which three.
 */
export type StockExceptionKind =
  | "NO_UNIT"
  | "NOT_SYNCED"
  | "NEGATIVE_STOCK"
  | "VALUE_WITHOUT_QTY"
  | "NEVER_USED";

export interface StockException {
  itemId: string;
  itemName: string;
  kind: StockExceptionKind;
  /** What goes wrong, in the order of how much it costs to leave alone. */
  severity: "BLOCKING" | "WARNING" | "INFO";
  message: string;
}

const SEVERITY_RANK: Record<StockException["severity"], number> = {
  BLOCKING: 0,
  WARNING: 1,
  INFO: 2,
};

export function findExceptions(
  items: {
    id: string;
    name: string;
    unit: string | null;
    tallySyncedAt: Date | null;
    usedOnVouchers: number;
  }[],
  positions: Map<string, StockPosition>
): StockException[] {
  const out: StockException[] = [];

  for (const item of items) {
    const p = positions.get(item.id);

    if (!item.unit) {
      out.push({
        itemId: item.id,
        itemName: item.name,
        kind: "NO_UNIT",
        severity: "BLOCKING",
        message:
          "No base unit. Tally rejects a stock item master with no unit, so every voucher naming this item will fail until one is set.",
      });
    }

    if (!item.tallySyncedAt) {
      out.push({
        itemId: item.id,
        itemName: item.name,
        kind: "NOT_SYNCED",
        severity: item.usedOnVouchers > 0 ? "BLOCKING" : "INFO",
        message:
          item.usedOnVouchers > 0
            ? "Not in Tally yet, and already on a voucher. The push creates the master first, so this resolves itself — unless the master create fails, in which case the voucher fails with it."
            : "Not in Tally yet. The next sync creates it.",
      });
    }

    if (p?.wentNegative) {
      out.push({
        itemId: item.id,
        itemName: item.name,
        kind: "NEGATIVE_STOCK",
        severity: "WARNING",
        message:
          "More has gone out than ever came in. Either the opening stock was never entered, or purchases for this item are being posted somewhere else — Tally will accept the vouchers and show a negative balance.",
      });
    }

    if (p && p.valueOnlyLines > 0) {
      out.push({
        itemId: item.id,
        itemName: item.name,
        kind: "VALUE_WITHOUT_QTY",
        severity: "WARNING",
        message: `${p.valueOnlyLines} line${
          p.valueOnlyLines === 1 ? "" : "s"
        } carry an amount but no quantity, so they move value without moving stock. Usually a sheet mapped without a quantity column.`,
      });
    }

    if (item.usedOnVouchers === 0 && item.tallySyncedAt) {
      out.push({
        itemId: item.id,
        itemName: item.name,
        kind: "NEVER_USED",
        severity: "INFO",
        message: "In Tally, but no voucher here has ever named it.",
      });
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.itemName.localeCompare(b.itemName)
  );
}
