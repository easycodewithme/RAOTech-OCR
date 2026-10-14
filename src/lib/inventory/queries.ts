import type { PrismaClient, VoucherStatus } from "@prisma/client";
import {
  buildPositions,
  buildStockLedger,
  findExceptions,
  type StockException,
  type StockLedgerRow,
  type StockMovementInput,
  type StockPosition,
} from "./stockLedger";

/**
 * Reading the stock position out of the database.
 *
 * Kept apart from `stockLedger.ts` so the arithmetic stays testable without a
 * database, and apart from the route handlers so the summary page and the
 * per-item page cannot drift into computing a closing balance two different
 * ways.
 */

/**
 * Which vouchers count as stock that has actually moved.
 *
 * `POSTED` is the only status Tally has seen, so it is the only one whose
 * numbers can be compared with Tally's own stock summary. Everything else is
 * work in progress here: real enough to want to see, not real enough to call a
 * balance. The screens offer both and label which is which, because a firm
 * checking their work against Tally needs the first and a firm deciding what
 * to push needs the second.
 */
export type StockBasis = "POSTED" | "ALL";

const STATUSES: Record<StockBasis, VoucherStatus[]> = {
  POSTED: ["POSTED"],
  ALL: ["POSTED", "APPROVED", "DRAFT", "EXPORTED_DEMO"],
};

export interface StockItemRow {
  id: string;
  name: string;
  unit: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  alias: string | null;
  openingQty: number | null;
  openingRate: number | null;
  tallySyncedAt: Date | null;
  usedOnVouchers: number;
}

export interface InventoryOverview {
  items: StockItemRow[];
  positions: Map<string, StockPosition>;
  exceptions: StockException[];
  basis: StockBasis;
}

/**
 * Every item, with what it is worth and what is wrong with it.
 *
 * One query for the masters and one for the movement, rather than a position
 * query per item: a trader's client list runs to a few hundred items, and the
 * per-item version was a few hundred round trips to render one table.
 */
export async function getInventoryOverview(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  basis: StockBasis = "POSTED"
): Promise<InventoryOverview> {
  const [items, lines] = await Promise.all([
    prisma.stockItem.findMany({
      where: { userId, clientId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        hsnCode: true,
        gstRate: true,
        alias: true,
        openingQty: true,
        openingRate: true,
        tallySyncedAt: true,
        _count: { select: { lines: true } },
      },
    }),
    prisma.voucherLine.findMany({
      where: {
        stockItemId: { not: null },
        voucher: { userId, clientId, status: { in: STATUSES[basis] } },
      },
      select: {
        stockItemId: true,
        quantity: true,
        debit: true,
        credit: true,
        rate: true,
        voucher: {
          select: { id: true, voucherType: true, status: true, date: true },
        },
      },
    }),
  ]);

  const byItem = new Map<string, StockMovementInput[]>();
  for (const l of lines) {
    if (!l.stockItemId) continue;
    const list = byItem.get(l.stockItemId) ?? [];
    list.push({
      voucherId: l.voucher.id,
      voucherType: l.voucher.voucherType,
      status: l.voucher.status,
      date: l.voucher.date,
      quantity: l.quantity,
      debit: l.debit,
      credit: l.credit,
      rate: l.rate,
    });
    byItem.set(l.stockItemId, list);
  }

  const rows: StockItemRow[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    hsnCode: i.hsnCode,
    gstRate: i.gstRate,
    alias: i.alias,
    openingQty: i.openingQty,
    openingRate: i.openingRate,
    tallySyncedAt: i.tallySyncedAt,
    usedOnVouchers: i._count.lines,
  }));

  const positions = buildPositions(rows, byItem);

  return { items: rows, positions, exceptions: findExceptions(rows, positions), basis };
}

export interface ItemLedgerResult {
  item: StockItemRow;
  rows: StockLedgerRow[];
  position: StockPosition;
}

/**
 * One item's movement, in the order it happened.
 *
 * Unlike the overview this always reads every status: the point of opening a
 * single item is to see what has touched it, and hiding the drafts would make
 * a closing balance that disagrees with the summary screen for no visible
 * reason. Each row carries its own status so the screen can say which.
 */
export async function getItemLedger(
  prisma: PrismaClient,
  userId: string,
  clientId: string,
  itemId: string
): Promise<ItemLedgerResult | null> {
  const item = await prisma.stockItem.findFirst({
    where: { id: itemId, userId, clientId },
    select: {
      id: true,
      name: true,
      unit: true,
      hsnCode: true,
      gstRate: true,
      alias: true,
      openingQty: true,
      openingRate: true,
      tallySyncedAt: true,
      _count: { select: { lines: true } },
    },
  });
  if (!item) return null;

  const lines = await prisma.voucherLine.findMany({
    where: { stockItemId: itemId, voucher: { userId, clientId } },
    select: {
      quantity: true,
      debit: true,
      credit: true,
      rate: true,
      voucher: {
        select: {
          id: true,
          voucherType: true,
          status: true,
          date: true,
          narration: true,
          invoice: { select: { invoiceNumber: true, vendor: true } },
          lines: {
            where: { role: "PARTY" },
            select: { ledgerNameSnapshot: true, ledger: { select: { name: true } } },
            take: 1,
          },
        },
      },
    },
  });

  const movements: StockMovementInput[] = lines.map((l) => {
    const party = l.voucher.lines[0];
    return {
      voucherId: l.voucher.id,
      voucherType: l.voucher.voucherType,
      status: l.voucher.status,
      date: l.voucher.date,
      reference: l.voucher.invoice?.invoiceNumber ?? l.voucher.narration ?? null,
      /**
       * The party ledger names the other side of the entry — the supplier a
       * purchase came from, the customer a sale went to. Falling back to the
       * invoice's vendor covers vouchers whose party line was never resolved
       * to a ledger, which is exactly the case someone opening this screen is
       * most likely trying to chase down.
       */
      partyName:
        party?.ledger?.name ?? party?.ledgerNameSnapshot ?? l.voucher.invoice?.vendor ?? null,
      quantity: l.quantity,
      debit: l.debit,
      credit: l.credit,
      rate: l.rate,
    };
  });

  const { rows, position } = buildStockLedger(
    { qty: item.openingQty, rate: item.openingRate },
    movements
  );

  return {
    item: {
      id: item.id,
      name: item.name,
      unit: item.unit,
      hsnCode: item.hsnCode,
      gstRate: item.gstRate,
      alias: item.alias,
      openingQty: item.openingQty,
      openingRate: item.openingRate,
      tallySyncedAt: item.tallySyncedAt,
      usedOnVouchers: item._count.lines,
    },
    rows,
    position,
  };
}
