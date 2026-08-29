import type { PrismaClient } from "@prisma/client";
import { normName } from "./normalize";

/**
 * Item name -> the client's stock item master, when they keep one.
 *
 * This is the gate on the whole inventory feature, and it is deliberately a
 * gate rather than a setting. A voucher gets inventory entries only if the
 * workspace actually has a `StockItem` master matching the line's item name.
 * A firm doing a services client's books never creates stock items, so nothing
 * about their vouchers changes; a firm doing a trader's books uploads the item
 * masters once and every subsequent purchase moves the right quantities.
 *
 * The alternative — a per-client "track inventory" toggle — would be a setting
 * someone has to know to find, and getting it wrong in either direction is
 * silent: off, and the client's stock reports drift; on with no masters, and
 * every voucher is rejected with `Stock Item 'X' does not exist!`.
 *
 * Matching folds the name the same way party matching does, so "Widget 10mm"
 * and "widget  10mm" are the same item. Nothing is ever auto-created here: an
 * item the sheet names and the workspace does not have simply posts as an
 * ordinary ledger line, exactly as it did before this feature existed.
 */

export interface StockItemRef {
  id: string;
  name: string;
  unit: string | null;
}

export type StockItemIndex = Map<string, StockItemRef>;

/** Build the lookup once per voucher batch rather than per line. */
export async function loadStockItemIndex(
  prisma: PrismaClient,
  userId: string,
  clientId: string
): Promise<StockItemIndex> {
  const rows = await prisma.stockItem.findMany({
    where: { userId, clientId },
    select: { id: true, name: true, unit: true },
  });

  const index: StockItemIndex = new Map();
  for (const r of rows) {
    const key = normName(r.name);
    if (key) index.set(key, { id: r.id, name: r.name, unit: r.unit });
  }
  return index;
}

/** The master for an item name, or null when the workspace has none. */
export function matchStockItem(
  index: StockItemIndex,
  itemName: string | null | undefined
): StockItemRef | null {
  const key = normName(itemName ?? "");
  if (!key) return null;
  return index.get(key) ?? null;
}
