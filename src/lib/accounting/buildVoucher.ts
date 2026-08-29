import type {
  NormalizedInvoice,
  ResolvedLedgers,
  VoucherDraft,
  VoucherLineInput,
  VoucherType,
} from "./types";
import { buildVoucherFromLines } from "./buildVoucherLines";
import { matchStockItem, type StockItemIndex } from "./resolveStockItems";

interface BuildOptions {
  /** Rounding tolerance in rupees before a warning is raised (default ₹1). */
  roundingTolerance?: number;
  narration?: string | null;
  /**
   * The client's stock item masters, keyed by folded item name.
   *
   * Omit it and nothing changes: item lines post as plain ledger entries the
   * way they always have. Supply it and any item line whose name matches a
   * master gains an inventory allocation, so the client's stock in Tally moves
   * with the money. See `resolveStockItems.ts` for why this is a lookup rather
   * than a per-client toggle.
   */
  stockItems?: StockItemIndex;
}

/**
 * Invoice -> voucher.
 *
 * This is now an adapter. It turns the invoice shape (subtotal, tax totals,
 * items, a single party) into the flat `(ledger, amount, Dr/Cr)` lines that
 * `buildVoucherFromLines` assembles, and does no arithmetic of its own beyond
 * choosing sides. Balancing, rounding, ordering and the unmapped check all live
 * in one place, so a journal, a bank transaction and a scanned bill cannot
 * drift apart on any of them.
 *
 * Convention (Indian accounting), unchanged:
 *  - PURCHASE: party (creditor) is CREDITED with the invoice total; item/expense
 *    and Input tax ledgers are DEBITED.
 *  - SALE: party (debtor) is DEBITED with the invoice total; sales and Output
 *    tax ledgers are CREDITED.
 */
export function buildVoucher(
  inv: NormalizedInvoice,
  resolved: ResolvedLedgers,
  voucherType: VoucherType,
  opts: BuildOptions = {}
): VoucherDraft {
  // PURCHASE / vendor CREDIT_NOTE (purchase return inverted at classify) —
  // party credited for purchase; party debited for sale / debit note.
  const isPurchase =
    voucherType === "PURCHASE" ||
    voucherType === "CREDIT_NOTE" ||
    voucherType === "PAYMENT";
  const nonParty: "DR" | "CR" = isPurchase ? "DR" : "CR";
  const party: "DR" | "CR" = isPurchase ? "CR" : "DR";

  const lines: VoucherLineInput[] = [];
  const warnings: string[] = [];

  // 1) Item / expense lines, net of tax.
  if (inv.items.length > 0) {
    for (const { item, ledger } of resolved.itemLedgers) {
      // Only if the workspace actually holds a master for this item. No master
      // means no inventory entry, which is the pre-inventory behaviour exactly.
      const stock = opts.stockItems ? matchStockItem(opts.stockItems, item.name) : null;

      lines.push({
        role: "ITEM",
        ledgerId: ledger?.id ?? null,
        ledgerName: ledger?.name ?? null,
        amount: item.price,
        side: nonParty,
        confidence: ledger?.confidence ?? null,
        mappedVia: ledger?.via ?? null,
        hsnCode: item.hsnCode,
        gstRate: item.gstRate,
        ...(stock
          ? {
              stockItemId: stock.id,
              // The master's spelling, not the sheet's: Tally resolves the item
              // by name and its own is the one that will match.
              stockItemName: stock.name,
              quantity: item.qty || null,
              unit: stock.unit,
              rate: item.rate || null,
            }
          : {}),
      });
    }
  } else {
    // No line items extracted — one net line of subtotal less discount.
    const def = resolved.itemLedgers[0]?.ledger ?? null;
    lines.push({
      role: "ITEM",
      ledgerId: def?.id ?? null,
      ledgerName: def?.name ?? null,
      amount: inv.subtotal - inv.discount,
      side: nonParty,
      confidence: def?.confidence ?? null,
      mappedVia: def?.via ?? "DEFAULT",
    });
  }

  // 2) Discount sits opposite the items — on a purchase it reduces what we owe.
  if (inv.discount > 0 && resolved.discountLedgerId) {
    lines.push({
      role: "DISCOUNT",
      ledgerId: resolved.discountLedgerId,
      ledgerName: resolved.discountLedgerName ?? null,
      amount: inv.discount,
      side: party,
      mappedVia: "DEFAULT",
    });
  }

  // 3) Tax. Interstate (IGST) and intrastate (CGST+SGST) are exclusive.
  if (inv.igst > 0) {
    lines.push({
      role: "IGST",
      ledgerId: resolved.igstLedgerId,
      ledgerName: resolved.igstLedgerName ?? null,
      amount: inv.igst,
      side: nonParty,
      mappedVia: "DEFAULT",
    });
    if (inv.cgst > 0 || inv.sgst > 0) {
      warnings.push(
        "Both IGST and CGST/SGST present — using IGST (interstate). Verify the invoice."
      );
    }
  } else {
    if (inv.cgst > 0)
      lines.push({
        role: "CGST",
        ledgerId: resolved.cgstLedgerId,
        ledgerName: resolved.cgstLedgerName ?? null,
        amount: inv.cgst,
        side: nonParty,
        mappedVia: "DEFAULT",
      });
    if (inv.sgst > 0)
      lines.push({
        role: "SGST",
        ledgerId: resolved.sgstLedgerId,
        ledgerName: resolved.sgstLedgerName ?? null,
        amount: inv.sgst,
        side: nonParty,
        mappedVia: "DEFAULT",
      });
  }

  // Compensation cess, when the source found one. Previously there was nowhere
  // to put this and the amount vanished into the round-off residual.
  if ((inv.cess ?? 0) > 0) {
    lines.push({
      role: "CESS",
      ledgerId: resolved.cessLedgerId ?? null,
      ledgerName: resolved.cessLedgerName ?? null,
      amount: inv.cess ?? 0,
      side: nonParty,
      mappedVia: "DEFAULT",
    });
  }

  // 4) Party line carries the authoritative invoice total.
  lines.push({
    role: "PARTY",
    ledgerId: resolved.party?.id ?? null,
    ledgerName: resolved.party?.name ?? null,
    amount: inv.total,
    side: party,
    confidence: resolved.party?.confidence ?? null,
    mappedVia: resolved.party?.via ?? null,
  });

  const draft = buildVoucherFromLines(
    {
      voucherType,
      date: inv.date,
      narration: opts.narration ?? null,
      lines,
      roundOffLedgerId: resolved.roundOffLedgerId,
      roundOffLedgerName: resolved.roundOffLedgerName ?? null,
    },
    { roundingTolerance: opts.roundingTolerance }
  );

  return { ...draft, warnings: [...warnings, ...draft.warnings] };
}
