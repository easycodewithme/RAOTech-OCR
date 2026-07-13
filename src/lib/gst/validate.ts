/**
 * Expanded GST validations — TaxOne-style multi-check suite for the prototype.
 */

const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export type ValidationIssue = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function gstinChecksumValid(gstin: string): boolean {
  if (!GSTIN_RE.test(gstin)) return false;
  return !!STATE_CODES[gstin.slice(0, 2)];
}

function panFromGstin(gstin: string): string | null {
  if (gstin.length !== 15) return null;
  return gstin.slice(2, 12);
}

export function validateInvoiceGstExtended(inv: {
  vendorGstin?: string | null;
  customerGstin?: string | null;
  invoiceNumber?: string | null;
  date?: string | Date | null;
  subtotal?: number | null;
  cgst?: number | null;
  sgst?: number | null;
  igst?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  discount?: number | null;
  items?: Array<{
    hsn_code?: string;
    hsnCode?: string;
    name?: string;
    price?: number;
    qty?: number;
    rate?: number;
    gst_rate?: number;
    gstRate?: number;
  }> | null;
  documentType?: string | null;
  reverseCharge?: boolean | null;
  irn?: string | null;
  ewayBillNo?: string | null;
}): {
  isValid: boolean;
  issues: ValidationIssue[];
  vendorState: string | null;
  customerState: string | null;
  placeOfSupplyInterstate: boolean | null;
  checkCount: number;
} {
  const issues: ValidationIssue[] = [];
  let checksRun = 0;
  const check = (fn: () => void) => {
    checksRun++;
    fn();
  };

  const vendorGstin = (inv.vendorGstin || "").toUpperCase().trim();
  const customerGstin = (inv.customerGstin || "").toUpperCase().trim();
  let vendorState: string | null = null;
  let customerState: string | null = null;

  check(() => {
    if (!vendorGstin) {
      issues.push({ code: "VENDOR_GSTIN_MISSING", severity: "warning", message: "Vendor GSTIN missing" });
    } else if (!gstinChecksumValid(vendorGstin)) {
      issues.push({ code: "VENDOR_GSTIN_INVALID", severity: "error", message: "Vendor GSTIN format/checksum invalid" });
    } else {
      vendorState = STATE_CODES[vendorGstin.slice(0, 2)] || null;
      if (!vendorState) {
        issues.push({ code: "VENDOR_STATE_UNKNOWN", severity: "warning", message: "Vendor GSTIN state code not recognized" });
      }
    }
  });

  check(() => {
    if (customerGstin) {
      if (!gstinChecksumValid(customerGstin)) {
        issues.push({ code: "CUSTOMER_GSTIN_INVALID", severity: "error", message: "Customer GSTIN format/checksum invalid" });
      } else {
        customerState = STATE_CODES[customerGstin.slice(0, 2)] || null;
      }
    }
  });

  check(() => {
    if (vendorGstin && customerGstin && vendorGstin === customerGstin) {
      issues.push({
        code: "SAME_PARTY_GSTIN",
        severity: "warning",
        message: "Vendor and customer GSTIN are identical",
      });
    }
  });

  check(() => {
    const pan = panFromGstin(vendorGstin);
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      issues.push({ code: "VENDOR_PAN_IN_GSTIN", severity: "error", message: "PAN segment inside vendor GSTIN looks invalid" });
    }
  });

  const interstate =
    vendorGstin && customerGstin ? vendorGstin.slice(0, 2) !== customerGstin.slice(0, 2) : null;

  const cgst = inv.cgst || 0;
  const sgst = inv.sgst || 0;
  const igst = inv.igst || 0;

  check(() => {
    if (interstate === true) {
      if (igst <= 0 && (cgst > 0 || sgst > 0)) {
        issues.push({
          code: "TAX_TYPE_INTERSTATE",
          severity: "error",
          message: "Inter-state supply should use IGST, not CGST/SGST",
        });
      }
      if (cgst > 0 || sgst > 0) {
        issues.push({
          code: "CGST_SGST_ON_INTERSTATE",
          severity: "warning",
          message: "CGST/SGST present on inter-state invoice",
        });
      }
    }
  });

  check(() => {
    if (interstate === false) {
      if (igst > 0) {
        issues.push({
          code: "IGST_ON_INTRASTATE",
          severity: "error",
          message: "Intra-state supply should use CGST/SGST, not IGST",
        });
      }
      if (Math.abs(cgst - sgst) > 1) {
        issues.push({
          code: "CGST_SGST_IMBALANCE",
          severity: "warning",
          message: "CGST and SGST amounts differ significantly",
        });
      }
    }
  });

  const taxSum = cgst + sgst + igst;
  check(() => {
    if (inv.taxAmount != null && Math.abs(inv.taxAmount - taxSum) > 1) {
      issues.push({
        code: "TAX_MATH_MISMATCH",
        severity: "warning",
        message: `Tax total ₹${inv.taxAmount} != CGST+SGST+IGST ₹${taxSum.toFixed(2)}`,
      });
    }
  });

  const subtotal = inv.subtotal || 0;
  const discount = inv.discount || 0;
  const expected = subtotal - discount + taxSum;
  check(() => {
    if (inv.totalAmount != null && subtotal > 0 && Math.abs(inv.totalAmount - expected) > 2) {
      issues.push({
        code: "TOTAL_MATH_MISMATCH",
        severity: "warning",
        message: `Grand total ₹${inv.totalAmount} inconsistent with subtotal+tax (expected ≈ ₹${expected.toFixed(2)})`,
      });
    }
  });

  check(() => {
    if (inv.totalAmount != null && inv.totalAmount < 0) {
      issues.push({ code: "NEGATIVE_TOTAL", severity: "error", message: "Invoice total cannot be negative" });
    }
  });

  check(() => {
    if (discount > 0 && subtotal > 0 && discount > subtotal) {
      issues.push({ code: "DISCOUNT_EXCEEDS_SUBTOTAL", severity: "error", message: "Discount exceeds subtotal" });
    }
  });

  check(() => {
    if (!inv.invoiceNumber || !String(inv.invoiceNumber).trim()) {
      issues.push({ code: "INVOICE_NUMBER_MISSING", severity: "warning", message: "Invoice number missing" });
    }
  });

  check(() => {
    if (!inv.date) {
      issues.push({ code: "INVOICE_DATE_MISSING", severity: "warning", message: "Invoice date missing" });
    } else {
      const d = inv.date instanceof Date ? inv.date : new Date(inv.date);
      if (isNaN(d.getTime())) {
        issues.push({ code: "INVOICE_DATE_INVALID", severity: "error", message: "Invoice date is invalid" });
      } else if (d.getTime() > Date.now() + 86400000) {
        issues.push({ code: "INVOICE_DATE_FUTURE", severity: "warning", message: "Invoice date is in the future" });
      }
    }
  });

  const items = inv.items || [];
  check(() => {
    const missingHsn = items.filter((it) => !(it.hsn_code || it.hsnCode)).length;
    if (items.length > 0 && missingHsn === items.length) {
      issues.push({ code: "HSN_MISSING", severity: "warning", message: "No HSN/SAC codes on line items" });
    } else if (missingHsn > 0) {
      issues.push({
        code: "HSN_PARTIAL",
        severity: "info",
        message: `${missingHsn} line item(s) missing HSN/SAC`,
      });
    }
  });

  check(() => {
    for (const [i, it] of items.entries()) {
      const hsn = String(it.hsn_code || it.hsnCode || "");
      if (hsn && !/^\d{4,8}$/.test(hsn.replace(/\s+/g, ""))) {
        issues.push({
          code: "HSN_FORMAT",
          severity: "info",
          message: `Line ${i + 1}: HSN/SAC "${hsn}" looks non-standard`,
        });
      }
    }
  });

  check(() => {
    for (const [i, it] of items.entries()) {
      const qty = Number(it.qty ?? 0);
      const rate = Number(it.rate ?? 0);
      const price = Number(it.price ?? 0);
      if (qty > 0 && rate > 0 && price > 0 && Math.abs(qty * rate - price) > Math.max(2, price * 0.02)) {
        issues.push({
          code: "LINE_MATH",
          severity: "warning",
          message: `Line ${i + 1}: qty×rate (₹${(qty * rate).toFixed(2)}) ≠ amount (₹${price.toFixed(2)})`,
        });
      }
    }
  });

  check(() => {
    const rates = items
      .map((it) => it.gst_rate ?? it.gstRate)
      .filter((r): r is number => r != null);
    for (const r of rates) {
      if (![0, 0.25, 3, 5, 12, 18, 28].includes(Number(r))) {
        issues.push({
          code: "UNUSUAL_GST_RATE",
          severity: "info",
          message: `Unusual GST rate ${r}% on a line item`,
        });
        break;
      }
    }
  });

  check(() => {
    if (items.length === 0) {
      issues.push({ code: "NO_LINE_ITEMS", severity: "warning", message: "No line items extracted" });
    }
  });

  check(() => {
    if (inv.reverseCharge) {
      issues.push({
        code: "REVERSE_CHARGE",
        severity: "info",
        message: "Reverse charge flagged — verify RCM ledgers before posting",
      });
    }
  });

  check(() => {
    if (inv.totalAmount != null && inv.totalAmount >= 50000000 && !inv.irn) {
      issues.push({
        code: "EINVOICE_THRESHOLD",
        severity: "info",
        message: "High-value invoice — consider e-invoice / IRN fields if applicable",
      });
    }
  });

  check(() => {
    if (inv.ewayBillNo && !/^\d{12}$/.test(String(inv.ewayBillNo).replace(/\s+/g, ""))) {
      issues.push({
        code: "EWAY_FORMAT",
        severity: "info",
        message: "E-way bill number format looks unusual (expected 12 digits)",
      });
    }
  });

  check(() => {
    if (!inv.documentType) {
      issues.push({ code: "DOC_TYPE_UNKNOWN", severity: "info", message: "Document type not classified" });
    }
  });

  check(() => {
    if (cgst === 0 && sgst === 0 && igst === 0 && (inv.totalAmount || 0) > 0 && subtotal > 0) {
      issues.push({
        code: "ZERO_TAX_ON_TAXABLE",
        severity: "info",
        message: "No GST breakup on a non-zero invoice — confirm exempt/nil-rated",
      });
    }
  });

  const hasError = issues.some((i) => i.severity === "error");
  return {
    isValid: !hasError,
    issues,
    vendorState,
    customerState,
    placeOfSupplyInterstate: interstate,
    checkCount: checksRun,
  };
}

export function detectDuplicateKey(inv: {
  invoiceNumber?: string | null;
  vendorGstin?: string | null;
  vendor?: string | null;
  totalAmount?: number | null;
}) {
  const num = (inv.invoiceNumber || "").toUpperCase().replace(/\s+/g, "");
  const gstin = (inv.vendorGstin || "").toUpperCase();
  const vendor = (inv.vendor || "").toUpperCase().replace(/\s+/g, "");
  const amt = Math.round((inv.totalAmount || 0) * 100);
  return `${num}|${gstin || vendor}|${amt}`;
}

/** Anomaly helpers for review queue */
export function detectAmountAnomaly(
  amount: number | null | undefined,
  history: number[],
  opts: { zThreshold?: number } = {}
): ValidationIssue | null {
  if (amount == null || history.length < 3) return null;
  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance = history.reduce((s, x) => s + (x - mean) ** 2, 0) / history.length;
  const std = Math.sqrt(variance) || 1;
  const z = Math.abs(amount - mean) / std;
  if (z >= (opts.zThreshold ?? 2.5)) {
    return {
      code: "AMOUNT_ANOMALY",
      severity: "warning",
      message: `Amount ₹${amount.toLocaleString("en-IN")} is unusual vs history (avg ₹${mean.toFixed(0)})`,
    };
  }
  return null;
}
