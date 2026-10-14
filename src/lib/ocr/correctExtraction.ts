/**
 * Post-extraction correction layer.
 *
 * The AI/OCR model (Google Gemma-3-12B-IT) makes two systematic errors on
 * Indian tax invoices:
 *
 * 1. GSTIN SWAP & MISASSIGNMENT — It copies the customer's GSTIN into `vendor_gstin` when the
 *    vendor block appears above the consignee/buyer blocks. We detect the swap/misassignment by:
 *    a) Checking state code against vendor address state.
 *    b) Comparing PAN (chars 3-12 of GSTIN) & 5th char of PAN (1st letter of entity name).
 *    c) Searching OCR payload for GSTIN matching vendor name initial when misassigned.
 *
 * 2. AMOUNT TRUNCATION — Indian number formatting uses commas as thousand
 *    separators (e.g. "3,96,190.19"). The model sometimes reads only the last
 *    group after a comma (e.g. 396.19 instead of 3,96,190.19). We detect this
 *    when the extracted numeric total is inconsistent with:
 *      a) The "amount in words" field (parsed to a number), or
 *      b) The sum of line-item prices exceeds the reported total.
 *
 * This module is pure (no IO) and has no external deps beyond the Node stdlib.
 */

// ─── Indian state codes (first 2 digits of GSTIN) ────────────────────────────

const STATE_CODE_MAP: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab",
  "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana", "07": "Delhi",
  "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram",
  "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "25": "Daman and Diu", "26": "Dadra and Nagar Haveli",
  "27": "Maharashtra", "28": "Andhra Pradesh", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

const STATE_KEYWORDS: Record<string, string[]> = {
  "24": ["gujarat", "guj"],
  "27": ["maharashtra", "mah"],
  "07": ["delhi", "new delhi"],
  "09": ["uttar pradesh", "u.p", "up"],
  "29": ["karnataka", "kar"],
  "33": ["tamil nadu", "tamilnadu", "t.n"],
  "36": ["telangana"],
  "28": ["andhra pradesh", "a.p"],
  "19": ["west bengal", "w.b"],
  "20": ["jharkhand"],
  "21": ["odisha", "orissa"],
  "06": ["haryana"],
  "03": ["punjab"],
  "08": ["rajasthan"],
  "32": ["kerala"],
};

function gstinStateCode(gstin: unknown): string | null {
  if (typeof gstin !== "string") return null;
  const clean = gstin.replace(/\s/g, "").toUpperCase();
  if (clean.length < 2) return null;
  const code = clean.slice(0, 2);
  return STATE_CODE_MAP[code] ? code : null;
}

function addressMatchesStateCode(address: unknown, code: string): boolean {
  if (typeof address !== "string" || !address) return false;
  const addr = address.toLowerCase();
  const keywords = STATE_KEYWORDS[code] ?? [STATE_CODE_MAP[code]?.toLowerCase() ?? ""];
  return keywords.some((kw) => addr.includes(kw));
}

function findGstinForEntity(rawObj: unknown, entityInitial: string, excludeGstin?: string): string | null {
  if (!rawObj || !entityInitial) return null;
  try {
    const jsonStr = JSON.stringify(rawObj);
    const matches = jsonStr.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g) ?? [];
    const targetInitial = entityInitial.charAt(0).toUpperCase();

    for (const gstin of matches) {
      if (excludeGstin && gstin.toUpperCase() === excludeGstin.toUpperCase()) continue;
      // 7th char of GSTIN (index 6) matches entity name initial
      if (gstin.charAt(6).toUpperCase() === targetInitial) {
        return gstin.toUpperCase();
      }
    }
  } catch {
    /* ignore JSON stringify errors */
  }
  return null;
}

// ─── Amount-in-words parser ────────────────────────────────────────────────

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MULTIPLIERS: Record<string, number> = {
  hundred: 100, thousand: 1_000, lakh: 1_00_000, lac: 1_00_000,
  crore: 1_00_00_000, million: 1_000_000, billion: 1_000_000_000,
};

export function parseAmountInWords(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  const clean = raw
    .toLowerCase()
    .replace(/\b(rupees?|rs\.?|inr|only|and|paise|paisa|₹|–|-)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;

  const words = clean.split(" ").filter(Boolean);
  let total = 0;
  let current = 0;

  for (const w of words) {
    if (ONES[w] !== undefined) {
      current += ONES[w];
    } else if (TENS[w] !== undefined) {
      current += TENS[w];
    } else if (w === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
    } else if (MULTIPLIERS[w] !== undefined) {
      const mult = MULTIPLIERS[w];
      total += (current === 0 ? 1 : current) * mult;
      current = 0;
    }
  }

  const result = total + current;
  return result > 0 ? result : null;
}

// ─── Main correction function ─────────────────────────────────────────────

type ExtractedData = Record<string, unknown>;

export function correctExtraction(raw: ExtractedData): {
  data: ExtractedData;
  corrections: string[];
} {
  const data: ExtractedData = { ...raw };
  const corrections: string[] = [];

  // ── 1. GSTIN swap & misassignment correction ─────────────────────────────────

  const vendorGstin = typeof data.vendor_gstin === "string" ? data.vendor_gstin.trim().toUpperCase() : null;
  const customerGstin = typeof data.customer_gstin === "string" ? data.customer_gstin.trim().toUpperCase() : null;
  const vendorAddress = typeof data.vendor_address === "string" ? data.vendor_address : null;
  const vendorName = typeof data.vendor === "string" ? data.vendor.trim() : null;
  const customerName = typeof data.customer_name === "string" ? data.customer_name.trim() : null;
  const vendorPan = typeof data.vendor_pan === "string" ? data.vendor_pan.trim().toUpperCase() : null;

  if (vendorGstin && customerGstin) {
    let shouldSwap = false;
    let reason = "";

    // Criteria A: State code mismatch with vendor address
    if (vendorAddress) {
      const vCode = gstinStateCode(vendorGstin);
      const cCode = gstinStateCode(customerGstin);
      if (
        vCode && cCode && vCode !== cCode &&
        !addressMatchesStateCode(vendorAddress, vCode) &&
        addressMatchesStateCode(vendorAddress, cCode)
      ) {
        shouldSwap = true;
        reason = "vendor address state matched customer_gstin";
      }
    }

    // Criteria B: Vendor PAN matches customer GSTIN instead of vendor GSTIN
    if (!shouldSwap && vendorPan) {
      if (!vendorGstin.includes(vendorPan) && customerGstin.includes(vendorPan)) {
        shouldSwap = true;
        reason = `vendor PAN (${vendorPan}) matched customer_gstin`;
      }
    }

    // Criteria C: 7th char of GSTIN (5th char of PAN) matches entity name initial
    if (!shouldSwap && vendorName && customerName && vendorGstin.length >= 7 && customerGstin.length >= 7) {
      const vInitial = vendorName.charAt(0).toUpperCase();
      const cInitial = customerName.charAt(0).toUpperCase();
      const vGstinInitial = vendorGstin.charAt(6); // 7th char
      const cGstinInitial = customerGstin.charAt(6); // 7th char

      if (vGstinInitial === cInitial && cGstinInitial === vInitial && vInitial !== cInitial) {
        shouldSwap = true;
        reason = `GSTIN initial '${vGstinInitial}' matched customer name '${customerName}' and '${cGstinInitial}' matched vendor '${vendorName}'`;
      }
    }

    if (shouldSwap) {
      data.vendor_gstin = customerGstin;
      data.customer_gstin = vendorGstin;
      corrections.push(
        `GSTIN swap corrected: vendor_gstin set to ${customerGstin} (${reason}); customer_gstin set to ${vendorGstin}`
      );
    }
  }

  // Criteria D: If vendor_gstin does not match vendorName initial, but matches customerName initial:
  // Search raw OCR payload for a GSTIN matching vendorName initial (e.g. 'K' for Kalpataru -> 24AATFK1007E1ZO).
  const currentVendorGstin = typeof data.vendor_gstin === "string" ? data.vendor_gstin.trim().toUpperCase() : null;
  if (vendorName && currentVendorGstin && currentVendorGstin.length >= 7) {
    const vInitial = vendorName.charAt(0).toUpperCase();
    const vGstinInitial = currentVendorGstin.charAt(6);
    if (vInitial !== vGstinInitial) {
      const correctVendorGstin = findGstinForEntity(raw, vInitial, currentVendorGstin);
      if (correctVendorGstin) {
        data.vendor_gstin = correctVendorGstin;
        corrections.push(
          `Vendor GSTIN corrected to ${correctVendorGstin} (matched vendor name initial '${vInitial}' from OCR payload)`
        );
      }
    }
  }

  // ── 2. Amount truncation correction ──────────────────────────────────────

  const rawTotal = typeof data.total_amount === "number"
    ? data.total_amount
    : parseFloat(String(data.total_amount ?? "").replace(/[^0-9.]/g, ""));

  if (isFinite(rawTotal) && rawTotal > 0) {
    const wordsTotal = parseAmountInWords(data.amount_in_words as unknown);
    if (wordsTotal !== null && wordsTotal > 0) {
      const ratio = wordsTotal / rawTotal;
      if (ratio >= 2 && Math.round(wordsTotal) !== Math.round(rawTotal)) {
        const scaleFactor = roundFactor(ratio);
        if (scaleFactor >= 2) {
          scaleMonetaryFields(data, scaleFactor);
          corrections.push(
            `Amount scaling ×${scaleFactor} applied: extracted total ₹${rawTotal} corrected to ₹${rawTotal * scaleFactor} based on "amount in words" (${data.amount_in_words})`
          );
        }
      }
    }

    if (Array.isArray(data.items) && data.items.length > 0) {
      let itemSum = 0;
      for (const item of data.items as ExtractedData[]) {
        const p =
          typeof item.amount === "number" ? item.amount :
          typeof item.price === "number" ? item.price :
          parseFloat(String(item.amount ?? item.price ?? "0").replace(/[^0-9.]/g, ""));
        if (isFinite(p)) itemSum += p;
      }
      const currentTotal = typeof data.total_amount === "number" ? data.total_amount : rawTotal;
      if (itemSum > currentTotal * 1.5 && itemSum > 0) {
        const scaleFactor = roundFactor(itemSum / currentTotal);
        if (scaleFactor >= 2 && !corrections.some((c) => c.startsWith("Amount scaling"))) {
          scaleMonetaryFields(data, scaleFactor);
          corrections.push(
            `Amount scaling ×${scaleFactor} applied: line-item sum ₹${itemSum.toFixed(2)} exceeded total ₹${currentTotal}`
          );
        }
      }
    }
  }

  return { data, corrections };
}

function roundFactor(ratio: number): number {
  const candidates = [10, 100, 1_00_000, 1_000];
  for (const c of candidates) {
    if (Math.abs(ratio - c) / c < 0.05) return c;
  }
  return Math.round(ratio);
}

const MONETARY_KEYS = [
  "total_amount", "subtotal", "cgst", "sgst", "igst", "tax",
  "discount", "cess", "tds", "round_off",
];

function scaleMonetaryFields(data: ExtractedData, factor: number): void {
  for (const key of MONETARY_KEYS) {
    if (typeof data[key] === "number") {
      (data as Record<string, unknown>)[key] = (data[key] as number) * factor;
    } else if (typeof data[key] === "string") {
      const n = parseFloat((data[key] as string).replace(/[^0-9.]/g, ""));
      if (isFinite(n)) (data as Record<string, unknown>)[key] = n * factor;
    }
  }

  if (Array.isArray(data.items)) {
    (data as Record<string, unknown>).items = (data.items as ExtractedData[]).map((item) => {
      const scaled = { ...item };
      for (const k of ["amount", "price", "total", "rate"] as const) {
        if (typeof scaled[k] === "number") {
          (scaled as Record<string, unknown>)[k] = (scaled[k] as number) * factor;
        } else if (typeof scaled[k] === "string") {
          const n = parseFloat((scaled[k] as string).replace(/[^0-9.]/g, ""));
          if (isFinite(n)) (scaled as Record<string, unknown>)[k] = n * factor;
        }
      }
      return scaled;
    });
  }
}
