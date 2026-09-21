import type {
  BillRefType,
  NormalizedInvoice,
  ResolvedLedgers,
  VoucherDraft,
  VoucherLineInput,
  VoucherType,
} from "./types";
import { buildVoucherFromLines } from "./buildVoucherLines";
import { normName } from "./normalize";
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

  /**
   * How the party line allocates against a bill.
   *
   * An invoice *opens* an outstanding, so `New Ref` named after itself is
   * right — that is what every voucher used to emit unconditionally, and for a
   * purchase or a sale it was never wrong.
   *
   * A credit or debit note is the opposite document: it exists to cancel some
   * or all of an invoice that already exists. Posted as `New Ref` it opens a
   * *second* reference next to the one it was meant to settle, so the client's
   * ageing shows the original still 100% outstanding with an unapplied credit
   * sitting beside it, and Tally will never knock the two together on its own.
   * `Agst Ref` named after the original is the entry an accountant would key by
   * hand, and it is the only form that actually reduces the outstanding.
   *
   * The fallback matters as much as the rule: a return whose original nobody
   * recorded still has to post. We cannot allocate it — there is no reference
   * to name — so it behaves exactly as it did before. Refusing to post it, or
   * inventing a reference for it, would both be worse than an unallocated
   * credit note the accountant can settle in Tally.
   */
  const isReturn = voucherType === "CREDIT_NOTE" || voucherType === "DEBIT_NOTE";
  const against = inv.againstInvoiceNumber?.trim() || null;
  const partyBillRefType: BillRefType = isReturn && against ? "Agst Ref" : "New Ref";
  const partyBillRefName = isReturn && against ? against : inv.invoiceNumber?.trim() || null;

  const lines: VoucherLineInput[] = [];
  const warnings: string[] = [];

  /**
   * The gate from `resolveStockItems.ts`, made explicit so the warning below
   * can respect it.
   *
   * An absent or empty index means the workspace keeps no stock masters at all
   * — a services client, or a firm that has simply never uploaded any. For them
   * a ledger-only item line is the *correct* posting, and a warning on every
   * line would be noise that teaches people to ignore the warnings that matter.
   * Once there is at least one master, though, "this line moved no stock" stops
   * being the normal case and becomes the thing nobody was told: the item is
   * misspelt against the master, or the master was never created. That silence
   * is the corruption this feature exists to prevent, so from that point on it
   * is reported.
   */
  const stockIndex = opts.stockItems && opts.stockItems.size > 0 ? opts.stockItems : null;
  /**
   * Unmatched item names for the warning text: folded key -> first spelling
   * seen. Folded, because "Bolt M6" and "bolt  m6" are the same missing master
   * — listing both would read as two separate problems with two separate fixes.
   */
  const unmatchedNames = new Map<string, string>();
  let unmatchedLines = 0;
  let itemLines = 0;

  // 1) Item / expense lines, net of tax.
  if (inv.items.length > 0) {
    for (const { item, ledger } of resolved.itemLedgers) {
      // Only if the workspace actually holds a master for this item. No master
      // means no inventory entry, which is the pre-inventory behaviour exactly.
      const stock = stockIndex ? matchStockItem(stockIndex, item.name) : null;

      if (stockIndex) {
        itemLines += 1;
        if (!stock) {
          unmatchedLines += 1;
          const label = item.name?.trim();
          const key = normName(label ?? "");
          // A blank name is already MISSING_REQUIRED_FIELD / a bad extraction;
          // naming it as `""` in this warning would only obscure the real ones.
          if (label && key && !unmatchedNames.has(key)) unmatchedNames.set(key, label);
        }
      }

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

    if (unmatchedNames.size > 0) {
      // Name the items. "Some items did not match" is unactionable; the fix is
      // always either "create this master" or "this cell is misspelt", and both
      // need the spelling the sheet actually used. Capped so a 500-line bill
      // does not produce a warning nobody can read.
      const SHOWN = 8;
      const names = [...unmatchedNames.values()];
      const shown = names.slice(0, SHOWN).map((n) => `"${n}"`).join(", ");
      const more = names.length > SHOWN ? ` and ${names.length - SHOWN} more` : "";
      warnings.push(
        `${unmatchedLines} of ${itemLines} item line(s) matched no stock item master, so they post as ledger entries only and move no stock in Tally: ${shown}${more}. Create the master, or correct the spelling in the source, if this client's inventory should move.`
      );
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
    billRefType: partyBillRefType,
    billRefName: partyBillRefName,
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

  /**
   * Re-attach the allocation the shared assembler does not carry.
   *
   * `buildVoucherFromLines` copies each draft line field by field, so anything
   * it has not been told about is dropped on the way through — and it is
   * deliberately ignorant of what a party or a bill is, which is the whole
   * reason a journal, a bank row and a scanned bill can share it. So the
   * allocation is matched back on by role rather than pushed down into it. An
   * invoice voucher has exactly one PARTY line, by construction above; a
   * zero-total invoice has none, and then this is a no-op.
   */
  const allocatedLines = draft.lines.map((l) =>
    l.role === "PARTY"
      ? { ...l, billRefType: partyBillRefType, billRefName: partyBillRefName }
      : l
  );

  return {
    ...draft,
    lines: allocatedLines,
    warnings: [...warnings, ...draft.warnings],
  };
}
