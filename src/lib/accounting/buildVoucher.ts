import type {
  LineRole,
  NormalizedInvoice,
  ResolvedLedgers,
  VoucherDraft,
  VoucherLineDraft,
  VoucherType,
} from "./types";

const toPaise = (n: number): number => Math.round((n || 0) * 100);
const toRupees = (p: number): number => Math.round(p) / 100;

interface BuildOptions {
  /** Rounding tolerance in rupees before a warning is raised (default ₹1). */
  roundingTolerance?: number;
  narration?: string | null;
}

/**
 * Pure transform: OCR-derived NormalizedInvoice + resolved ledgers -> a balanced
 * double-entry VoucherDraft.
 *
 * Convention (Indian accounting):
 *  - PURCHASE: party (creditor) is CREDITED with the invoice total; item/expense
 *    and tax (Input) ledgers are DEBITED.
 *  - SALE: party (debtor) is DEBITED with the invoice total; sales and tax
 *    (Output) ledgers are CREDITED.
 *
 * A Round Off line always closes any residual so totalDebit === totalCredit.
 * The draft is never returned unbalanced. `hasUnmapped` (party null or any item
 * null) is what gates approval — it is independent of balance.
 */
export function buildVoucher(
  inv: NormalizedInvoice,
  resolved: ResolvedLedgers,
  voucherType: VoucherType,
  opts: BuildOptions = {}
): VoucherDraft {
  const tolerancePaise = toPaise(opts.roundingTolerance ?? 1.0);
  const isPurchase = voucherType === "PURCHASE";
  // On purchase, non-party lines are debits; on sale, they are credits.
  const nonPartyDebit = isPurchase;

  const lines: VoucherLineDraft[] = [];
  const warnings: string[] = [];
  let sort = 0;

  const push = (
    role: LineRole,
    ledgerId: string | null,
    ledgerName: string | null,
    amountPaise: number,
    debitSide: boolean,
    extra: Partial<VoucherLineDraft> = {}
  ) => {
    if (amountPaise <= 0) return;
    const amt = toRupees(amountPaise);
    lines.push({
      ledgerId: ledgerId || null,
      ledgerNameSnapshot: ledgerName ?? null,
      role,
      debit: debitSide ? amt : 0,
      credit: debitSide ? 0 : amt,
      confidence: extra.confidence ?? null,
      mappedVia: extra.mappedVia ?? null,
      hsnCode: extra.hsnCode ?? null,
      gstRate: extra.gstRate ?? null,
      sortOrder: sort++,
    });
  };

  let hasUnmapped = false;

  // 1) Item / expense lines (net of tax)
  if (inv.items.length > 0) {
    for (const { item, ledger } of resolved.itemLedgers) {
      if (!ledger) hasUnmapped = true;
      push(
        "ITEM",
        ledger?.id ?? null,
        ledger?.name ?? null,
        toPaise(item.price),
        nonPartyDebit,
        {
          confidence: ledger?.confidence ?? null,
          mappedVia: ledger?.via ?? null,
          hsnCode: item.hsnCode,
          gstRate: item.gstRate,
        }
      );
    }
  } else {
    // No line items extracted — synthesize a single net line = subtotal - discount
    const net = toPaise(inv.subtotal) - toPaise(inv.discount);
    const def = resolved.itemLedgers[0]?.ledger ?? null;
    if (!def) hasUnmapped = true;
    push("ITEM", def?.id ?? null, def?.name ?? null, net, nonPartyDebit, {
      confidence: def?.confidence ?? null,
      mappedVia: def?.via ?? "DEFAULT",
    });
  }

  // 2) Discount — sits opposite to items (purchase: a credit that reduces what we owe)
  if (inv.discount > 0 && resolved.discountLedgerId) {
    push(
      "DISCOUNT",
      resolved.discountLedgerId,
      resolved.discountLedgerName ?? null,
      toPaise(inv.discount),
      !nonPartyDebit,
      { mappedVia: "DEFAULT" }
    );
  }

  // 3) Tax lines — interstate (IGST) vs intrastate (CGST+SGST); never both
  if (inv.igst > 0) {
    push("IGST", resolved.igstLedgerId, resolved.igstLedgerName ?? null, toPaise(inv.igst), nonPartyDebit, { mappedVia: "DEFAULT" });
    if (inv.cgst > 0 || inv.sgst > 0) {
      warnings.push("Both IGST and CGST/SGST present — using IGST (interstate). Verify the invoice.");
    }
  } else {
    if (inv.cgst > 0)
      push("CGST", resolved.cgstLedgerId, resolved.cgstLedgerName ?? null, toPaise(inv.cgst), nonPartyDebit, { mappedVia: "DEFAULT" });
    if (inv.sgst > 0)
      push("SGST", resolved.sgstLedgerId, resolved.sgstLedgerName ?? null, toPaise(inv.sgst), nonPartyDebit, { mappedVia: "DEFAULT" });
  }

  // 4) Party line = authoritative invoice total
  if (!resolved.party) hasUnmapped = true;
  push(
    "PARTY",
    resolved.party?.id ?? null,
    resolved.party?.name ?? null,
    toPaise(inv.total),
    !nonPartyDebit,
    { confidence: resolved.party?.confidence ?? null, mappedVia: resolved.party?.via ?? null }
  );

  // 5) Balance with a Round Off line
  const debitPaise = lines.reduce((s, l) => s + toPaise(l.debit), 0);
  const creditPaise = lines.reduce((s, l) => s + toPaise(l.credit), 0);
  const diff = debitPaise - creditPaise; // +ve => need more credit
  let roundOff = 0;
  if (diff !== 0) {
    if (Math.abs(diff) > tolerancePaise) {
      warnings.push(
        `Rounding difference of ₹${toRupees(Math.abs(diff)).toFixed(2)} exceeds tolerance — check the extracted amounts.`
      );
    }
    // diff > 0 => add a credit to balance; diff < 0 => add a debit
    push(
      "ROUND_OFF",
      resolved.roundOffLedgerId,
      resolved.roundOffLedgerName ?? null,
      Math.abs(diff),
      diff < 0,
      { mappedVia: "DEFAULT" }
    );
    roundOff = toRupees(diff);
  }

  const totalDebit = toRupees(lines.reduce((s, l) => s + toPaise(l.debit), 0));
  const totalCredit = toRupees(lines.reduce((s, l) => s + toPaise(l.credit), 0));

  return {
    voucherType,
    date: inv.date,
    narration: opts.narration ?? null,
    lines,
    totalDebit,
    totalCredit,
    roundOff,
    hasUnmapped,
    warnings,
  };
}
