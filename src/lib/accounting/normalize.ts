import type { NormalizedInvoice, NormalizedItem } from "./types";

/** Parse a money-ish value (number or string with currency symbols) to a number. */
export const cleanMoney = (val: unknown): number => {
  if (typeof val === "number") return isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const n = parseFloat(val.replace(/[^0-9.-]+/g, ""));
    return isFinite(n) ? n : 0;
  }
  return 0;
};

/**
 * Parse a date value, handling Indian DD/MM/YYYY and DD-MM-YYYY formats.
 * Falls back to the current date when unparseable (matches prior behaviour).
 */
export const cleanDate = (val: unknown): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (typeof val === "string") {
    const ddmmyyyy = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
      if (!isNaN(d.getTime())) return d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? new Date() : d;
  }
  return new Date();
};

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

/** Normalize a GSTIN for matching: uppercase, strip non-alphanumerics. */
export const normGstin = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const cleaned = s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned.length ? cleaned : null;
};

const LEGAL_SUFFIXES =
  /\b(private|pvt|limited|ltd|llp|inc|incorporated|corporation|corp|co|company|enterprises|enterprise|industries|traders|trading|and|the)\b/g;

/** Normalize a party name for matching: lowercase, drop legal suffixes/punctuation, collapse spaces. */
export const normName = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const cleaned = s
    .toLowerCase()
    .replace(/[.,&'"/\\()-]/g, " ")
    .replace(LEGAL_SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length ? cleaned : null;
};

/** Normalize a free-text keyword used by VENDOR_NAME_CONTAINS rules. */
export const normKeyword = (v: unknown): string => {
  const s = str(v) ?? "";
  return s.toLowerCase().replace(/\s+/g, " ").trim();
};

function normalizeItems(raw: unknown): NormalizedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it): NormalizedItem | null => {
      if (!it || typeof it !== "object") return null;
      const o = it as Record<string, unknown>;
      const name = str(o.name) ?? str(o.description) ?? "Item";
      const qty = cleanMoney(o.qty ?? o.quantity);
      const rate = cleanMoney(o.rate);
      // price/amount/line total — fall back to qty*rate when missing
      let price = cleanMoney(o.price ?? o.amount ?? o.total);
      if (!price && qty && rate) price = qty * rate;
      const hsnCode = str(o.hsn_code ?? o.hsn ?? o.hsnCode);
      const gstRate =
        o.gst_rate != null || o.gstRate != null || o.tax_rate != null
          ? cleanMoney(o.gst_rate ?? o.gstRate ?? o.tax_rate)
          : null;
      return { name, qty, rate, price, hsnCode, gstRate };
    })
    .filter((x): x is NormalizedItem => x !== null);
}

/**
 * Convert the OCR backend's snake_case JSON into a NormalizedInvoice.
 * Pure: no IO. `extractedData` is the `data` object returned by /extract.
 */
export function normalizeInvoice(
  extractedData: Record<string, unknown>
): NormalizedInvoice {
  const d = extractedData ?? {};
  return {
    invoiceNumber: str(d.invoice_number),
    date: cleanDate(d.date),
    vendor: str(d.vendor),
    vendorGstin: normGstin(d.vendor_gstin),
    customerName: str(d.customer_name),
    customerGstin: normGstin(d.customer_gstin),
    subtotal: cleanMoney(d.subtotal),
    cgst: cleanMoney(d.cgst),
    sgst: cleanMoney(d.sgst),
    igst: cleanMoney(d.igst),
    discount: cleanMoney(d.discount),
    total: cleanMoney(d.total_amount),
    items: normalizeItems(d.items),
  };
}
