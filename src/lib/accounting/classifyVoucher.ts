import type { NormalizedInvoice, VoucherType } from "./types";

/**
 * Heuristic classification of a document as a PURCHASE or SALE voucher.
 *
 * The current product is vendor-bill centric (invoices the firm *receives*),
 * so the default is PURCHASE. An explicit hint (e.g. a persisted documentType
 * from OCR or a user choice) always wins. The voucher type is user-editable on
 * the review screen, so this only needs to be a good default.
 */
export function classifyVoucher(
  _inv: NormalizedInvoice,
  hint?: string | null
): VoucherType {
  const h = (hint ?? "").trim().toUpperCase();
  if (h === "SALE" || h === "SALES" || h === "OUTWARD") return "SALE";
  if (h === "CREDIT_NOTE" || h === "CREDITNOTE" || h === "CN") return "CREDIT_NOTE";
  if (h === "DEBIT_NOTE" || h === "DEBITNOTE" || h === "DN") return "DEBIT_NOTE";
  if (h === "PURCHASE" || h === "INWARD" || h === "EXPENSE") return "PURCHASE";
  return "PURCHASE";
}
