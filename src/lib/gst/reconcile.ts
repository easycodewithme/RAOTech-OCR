import { normGstin, normName } from "../accounting/normalize";

export type Gst2bParsedRow = {
  supplierGstin: string | null;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  totalTax: number;
  invoiceType: string | null;
  raw: Record<string, unknown>;
};

export type BookInvoice = {
  id: string;
  vendor: string | null;
  vendorGstin: string | null;
  invoiceNumber: string | null;
  date: Date | null;
  subtotal: number | null;
  taxAmount: number | null;
  cgst: number | null;
  sgst: number | null;
  igst: number | null;
  totalAmount: number | null;
};

export type ReconResult = {
  status: "MATCHED" | "VALUE_MISMATCH" | "MISSING_IN_2B" | "MISSING_IN_BOOKS" | "DUPLICATE";
  gst2bIndex: number | null;
  invoiceId: string | null;
  taxableDiff: number;
  taxDiff: number;
  notes: string;
};

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v.replace(/[^0-9.-]+/g, "")) || 0;
  return 0;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v).trim();
  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]) - 1;
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    return new Date(y, mo, d);
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt;
}

function keyOf(gstin: string | null, invNo: string | null) {
  return `${(gstin || "").toUpperCase()}|${(invNo || "").toUpperCase().replace(/\s+/g, "")}`;
}

/** Parse GSTR-2B JSON (portal style) or CSV text into normalized rows. */
export function parseGst2bPayload(payload: unknown, fileName?: string): Gst2bParsedRow[] {
  if (typeof payload === "string") {
    // CSV
    const lines = payload.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    return lines.slice(1).map((line) => {
      const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"')) || [];
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = cols[i] || "";
      });
      const igst = num(obj.igst || obj["igst amount"]);
      const cgst = num(obj.cgst || obj["cgst amount"]);
      const sgst = num(obj.sgst || obj["sgst amount"]);
      const cess = num(obj.cess);
      return {
        supplierGstin: normGstin(obj.gstin || obj["supplier gstin"] || obj["ctin"] || null),
        supplierName: obj["trade/legal name"] || obj.supplier || obj["supplier name"] || null,
        invoiceNumber: obj["invoice number"] || obj.invoicenumber || obj["invoice no"] || obj.inum || null,
        invoiceDate: parseDate(obj["invoice date"] || obj.invoicedate || obj.idt),
        taxableValue: num(obj["taxable value"] || obj.taxable || obj.txval),
        igst,
        cgst,
        sgst,
        cess,
        totalTax: igst + cgst + sgst + cess,
        invoiceType: obj["invoice type"] || obj.inv_typ || "B2B",
        raw: obj,
      };
    });
  }

  // JSON — support portal GSTR-2B shape or flat array
  const root = payload as any;
  const rows: Gst2bParsedRow[] = [];

  if (Array.isArray(root)) {
    for (const r of root) {
      const igst = num(r.igst ?? r.iamt);
      const cgst = num(r.cgst ?? r.camt);
      const sgst = num(r.sgst ?? r.samt);
      const cess = num(r.cess ?? r.csamt);
      rows.push({
        supplierGstin: normGstin(r.ctin || r.gstin || r.supplierGstin || null),
        supplierName: r.trdnm || r.supplierName || r.vendor || null,
        invoiceNumber: r.inum || r.invoiceNumber || r.invoice_number || null,
        invoiceDate: parseDate(r.idt || r.invoiceDate || r.date),
        taxableValue: num(r.txval ?? r.taxableValue ?? r.subtotal),
        igst,
        cgst,
        sgst,
        cess,
        totalTax: igst + cgst + sgst + cess,
        invoiceType: r.inv_typ || r.invoiceType || "B2B",
        raw: r,
      });
    }
    return rows;
  }

  // Portal: docdata.b2b[].inv[]
  const b2b = root?.data?.docdata?.b2b || root?.docdata?.b2b || root?.b2b || [];
  for (const party of b2b) {
    const gstin = normGstin(party.ctin || null);
    const name = party.trdnm || null;
    for (const inv of party.inv || []) {
      const igst = num(inv.igst || inv.iamt);
      const cgst = num(inv.cgst || inv.camt);
      const sgst = num(inv.sgst || inv.samt);
      const cess = num(inv.cess || inv.csamt);
      rows.push({
        supplierGstin: gstin,
        supplierName: name,
        invoiceNumber: inv.inum || null,
        invoiceDate: parseDate(inv.idt),
        taxableValue: num(inv.txval),
        igst,
        cgst,
        sgst,
        cess,
        totalTax: igst + cgst + sgst + cess,
        invoiceType: inv.inv_typ || "B2B",
        raw: inv,
      });
    }
  }

  if (!rows.length && fileName) {
    // empty ok
  }
  return rows;
}

/**
 * Match GSTR-2B rows against purchase-register invoices.
 * Tolerance defaults: ₹1 on taxable and tax.
 */
export function reconcileGst2b(
  rows2b: Gst2bParsedRow[],
  books: BookInvoice[],
  opts: { taxableTolerance?: number; taxTolerance?: number } = {}
): ReconResult[] {
  const taxableTol = opts.taxableTolerance ?? 1;
  const taxTol = opts.taxTolerance ?? 1;

  const bookMap = new Map<string, BookInvoice[]>();
  for (const b of books) {
    const k = keyOf(normGstin(b.vendorGstin), b.invoiceNumber);
    if (!bookMap.has(k)) bookMap.set(k, []);
    bookMap.get(k)!.push(b);
  }

  const usedBooks = new Set<string>();
  const results: ReconResult[] = [];

  rows2b.forEach((row, idx) => {
    const k = keyOf(row.supplierGstin, row.invoiceNumber);
    const candidates = (bookMap.get(k) || []).filter((b) => !usedBooks.has(b.id));

    if (!candidates.length) {
      // try fuzzy: same GSTIN + similar invoice number
      const soft = books.filter(
        (b) =>
          !usedBooks.has(b.id) &&
          normGstin(b.vendorGstin) === row.supplierGstin &&
          normName(b.invoiceNumber) === normName(row.invoiceNumber)
      );
      if (!soft.length) {
        results.push({
          status: "MISSING_IN_BOOKS",
          gst2bIndex: idx,
          invoiceId: null,
          taxableDiff: row.taxableValue,
          taxDiff: row.totalTax,
          notes: "Present in GSTR-2B but not found in purchase register",
        });
        return;
      }
      candidates.push(...soft);
    }

    const book = candidates[0];
    usedBooks.add(book.id);

    const bookTaxable = book.subtotal ?? (book.totalAmount || 0) - (book.taxAmount || 0);
    const bookTax = book.taxAmount ?? (book.cgst || 0) + (book.sgst || 0) + (book.igst || 0);
    const taxableDiff = Math.abs(bookTaxable - row.taxableValue);
    const taxDiff = Math.abs(bookTax - row.totalTax);

    if (taxableDiff <= taxableTol && taxDiff <= taxTol) {
      results.push({
        status: "MATCHED",
        gst2bIndex: idx,
        invoiceId: book.id,
        taxableDiff,
        taxDiff,
        notes: "Matched",
      });
    } else {
      results.push({
        status: "VALUE_MISMATCH",
        gst2bIndex: idx,
        invoiceId: book.id,
        taxableDiff,
        taxDiff,
        notes: `Taxable Δ ₹${taxableDiff.toFixed(2)}, Tax Δ ₹${taxDiff.toFixed(2)}`,
      });
    }
  });

  // Books missing in 2B
  for (const b of books) {
    if (usedBooks.has(b.id)) continue;
    results.push({
      status: "MISSING_IN_2B",
      gst2bIndex: null,
      invoiceId: b.id,
      taxableDiff: b.subtotal || 0,
      taxDiff: b.taxAmount || 0,
      notes: "Present in books but missing in GSTR-2B",
    });
  }

  return results;
}
