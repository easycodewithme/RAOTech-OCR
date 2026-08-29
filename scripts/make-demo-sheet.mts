/**
 * Generate a purchase register that looks like one a CA firm would actually be
 * handed, rather than one shaped to suit our parser.
 *
 * Deliberately awkward, because each awkwardness is a rule the competitor makes
 * the accountant satisfy by hand and we claim to absorb:
 *
 *   - a title row and a date-range row above the headers (their rule: headers
 *     must be in row 1)
 *   - a grand-total row at the bottom (their rule: remove total rows)
 *   - `DD/MM/YYYY` dates, day-first as India writes them
 *   - amounts as text with Indian lakh grouping and a rupee symbol
 *   - blanks written as "NA" rather than left empty (their rule: leave blank)
 *   - a mix of intrastate and interstate parties, decided by GSTIN state code,
 *     because a real register contains both
 *
 *   npx tsx scripts/make-demo-sheet.mts [outPath]
 */
import ExcelJS from "exceljs";
import path from "node:path";

const out =
  process.argv[2] ??
  path.join(process.cwd(), "scripts", "demo-purchase-register.xlsx");

/** Company is in Karnataka (29). A party in 29 is intrastate; anything else is not. */
const ROWS = [
  ["INV-2001", "05/08/2026", "Sharma Traders", "29AABCS1234L1Z5", 10000, 18],
  ["INV-2002", "07/08/2026", "Delhi Supplies Pvt Ltd", "07AAACD5678M1Z2", 25000, 18],
  ["INV-2003", "11/08/2026", "Sharma Traders", "29AABCS1234L1Z5", 4500, 5],
  ["INV-2004", "14/08/2026", "Nagpur Steel Co", "27AAECN9012P1Z8", 78000, 28],
  ["INV-2005", "18/08/2026", "Bengaluru Print House", "29AAFCB3456Q1Z1", 3200, 12],
  ["INV-2006", "22/08/2026", "Chennai Logistics", "33AAGCC7890R1Z4", 15600, 18],
];

/** 1,23,456.78 — lakh grouping, not the thousands grouping most parsers assume. */
function indianNumber(n: number): string {
  const [whole, frac = "00"] = n.toFixed(2).split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3
    : last3;
  return `₹ ${grouped}.${frac}`;
}

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Purchase Register");

// Two rows of preamble, exactly the sort of thing an accounting package emits.
ws.addRow(["ACME MANUFACTURING PVT LTD"]);
ws.addRow(["Purchase Register — 01/08/2026 to 31/08/2026"]);
ws.addRow([]);

ws.addRow([
  "Bill No.",
  "Bill Date",
  "Supplier Name",
  "GSTIN",
  "Taxable Value",
  "GST Rate",
  "CGST",
  "SGST",
  "IGST",
  "Invoice Total",
  "Narration",
]);

let tTaxable = 0;
let tCgst = 0;
let tSgst = 0;
let tIgst = 0;
let tTotal = 0;

for (const [no, date, party, gstin, taxable, rate] of ROWS as [
  string,
  string,
  string,
  string,
  number,
  number,
][]) {
  const interstate = !String(gstin).startsWith("29");
  const tax = (taxable * rate) / 100;
  const cgst = interstate ? 0 : tax / 2;
  const sgst = interstate ? 0 : tax / 2;
  const igst = interstate ? tax : 0;
  const total = taxable + tax;

  tTaxable += taxable;
  tCgst += cgst;
  tSgst += sgst;
  tIgst += igst;
  tTotal += total;

  ws.addRow([
    no,
    date,
    party,
    gstin,
    indianNumber(taxable),
    rate,
    cgst ? indianNumber(cgst) : "NA",
    sgst ? indianNumber(sgst) : "NA",
    igst ? indianNumber(igst) : "NA",
    indianNumber(total),
    `Purchase from ${party}`,
  ]);
}

// The grand-total row their docs tell users to delete before uploading.
ws.addRow([
  "",
  "",
  "TOTAL",
  "",
  indianNumber(tTaxable),
  "",
  indianNumber(tCgst),
  indianNumber(tSgst),
  indianNumber(tIgst),
  indianNumber(tTotal),
  "",
]);

await wb.xlsx.writeFile(out);

console.log(`wrote ${out}`);
console.log(`  ${ROWS.length} bills + 1 grand-total row`);
console.log(`  headers on row 4; rows 1-3 are preamble`);
console.log(`  intrastate: ${ROWS.filter((r) => String(r[3]).startsWith("29")).length}`);
console.log(`  interstate: ${ROWS.filter((r) => !String(r[3]).startsWith("29")).length}`);
console.log(`  expected taxable total: ${tTaxable.toFixed(2)}`);
