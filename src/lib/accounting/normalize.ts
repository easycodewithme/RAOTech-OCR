import type { NormalizedInvoice, NormalizedItem } from "./types";

/** Parse a money-ish value (number or string with currency symbols) to a number.
 *
 * Handles:
 *  - Plain numbers: 396190.19
 *  - Indian comma-separated: "3,96,190.19"  → 396190.19
 *  - Currency-prefixed: "₹3,96,190.19"     → 396190.19
 *  - Multiple-dot European: "3.96.190,19"   → 396190.19
 */
export const cleanMoney = (val: unknown): number => {
  if (typeof val === "number") return isFinite(val) ? val : 0;
  if (typeof val === "string") {
    // Strip currency symbols and whitespace
    let s = val.replace(/[₹$€£\s]/g, "").trim();
    if (!s) return 0;

    // Detect European format: "1.234.567,89" (dots as thousands, comma as decimal)
    const euroFormat = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s);
    if (euroFormat) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // Standard / Indian: remove all commas (thousand separators), keep last dot
      // "3,96,190.19" → "396190.19"
      // "3.96.190.19" (multi-dot, no decimal) → treat dots as thousand sep
      const dotCount = (s.match(/\./g) ?? []).length;
      if (dotCount > 1) {
        // More than one dot → all dots are thousand separators, no decimal
        s = s.replace(/[^0-9]/g, "");
      } else {
        s = s.replace(/,/g, "");
      }
    }

    const n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  return 0;
};


/**
 * Parse a date value, handling Indian formats like DD/MM/YYYY, DD-MM-YY, 14-Sep-26, 14-Sep-2026.
 * Falls back to current date when unparseable so Tally dates are never missing or NaN.
 */
export const cleanDate = (val: unknown): Date => {
  if (!val) return new Date();
  if (val instanceof Date) return isNaN(val.getTime()) ? new Date() : val;
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return new Date();

    // 1. DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY or DD/MM/YY (support 2-digit and 4-digit years)
    const ddmmyyyy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
    if (ddmmyyyy) {
      const day = parseInt(ddmmyyyy[1], 10);
      const month = parseInt(ddmmyyyy[2], 10);
      let year = parseInt(ddmmyyyy[3], 10);
      if (year < 100) year += 2000;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime())) return d;
      }
    }

    // 2. DD-MMM-YY or DD-MMM-YYYY (e.g. "14-Sep-26", "14-Sep-2026", "14 Sep 2026")
    const ddmmmyyyy = s.match(/^(\d{1,2})[\/\-\.\s]+([a-zA-Z]{3,9})[\/\-\.\s]+(\d{2,4})$/);
    if (ddmmmyyyy) {
      const day = parseInt(ddmmmyyyy[1], 10);
      const monthStr = ddmmmyyyy[2].toLowerCase();
      let year = parseInt(ddmmmyyyy[3], 10);
      if (year < 100) year += 2000;
      const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const monthIdx = months.findIndex((m) => monthStr.startsWith(m));
      if (monthIdx !== -1 && day >= 1 && day <= 31) {
        const d = new Date(year, monthIdx, day);
        if (!isNaN(d.getTime())) return d;
      }
    }

    // 3. Fallback to standard JS Date parsing
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      if (d.getFullYear() < 1970 && d.getFullYear() >= 1900) {
        d.setFullYear(d.getFullYear() + 100);
      }
      return d;
    }
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
      const name =
        str(o.selected_item_name) ??
        str(o.item_name) ??
        str(o.name) ??
        str(o.description) ??
        "Item";
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
    // Read even though OCR rarely finds one: `buildVoucher` gates its cess line
    // on this value, so leaving it unread meant a scanned invoice that *did*
    // carry compensation cess silently posted without it, leaving the voucher
    // short by that amount.
    cess: cleanMoney(d.cess),
    // The invoice a credit or debit note reverses, when the document says so.
    // Both spellings appear in extractor output depending on the prompt used.
    againstInvoiceNumber: str(d.against_invoice_number ?? d.original_invoice_number),
    againstInvoiceDate: cleanDate(d.against_invoice_date ?? d.original_invoice_date),
    discount: cleanMoney(d.discount),
    total: cleanMoney(d.total_amount),
    items: normalizeItems(d.items),
  };
}

/**
 * The key a bank narration is remembered and looked up under.
 *
 * Lives here, beside `normName`, because it has exactly one job: to be the same
 * string on both sides of `LedgerMapping`. It used to live in `lib/bank/classify.ts`
 * while the writer in `rememberMapping.ts` used plain `normName`, so every
 * narration learned through that writer was stored under a key the reader never
 * asked for. For "UPI/DR/402913844/RELIANCE" the two differ, which is to say
 * they differ for almost every real narration.
 *
 * Beyond `normName`, it strips the parts of a narration that are unique to one
 * transaction and therefore useless as a memory key: runs of six or more digits
 * (reference and UTR numbers) and the rail names UPI / NEFT / IMPS / RTGS /
 * REF / TXN. What is left is the counterparty, which is what the accountant was
 * actually recognising when they chose the ledger.
 */
export const narrationKey = (description: string): string =>
  normName(
    (description || "")
      .replace(/\b\d{6,}\b/g, " ")
      .replace(/\b(upi|neft|imps|rtgs|ref|txn)\b/gi, " ")
  ) || "";
