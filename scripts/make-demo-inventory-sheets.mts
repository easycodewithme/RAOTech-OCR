/**
 * The demo kit for the inventory path: an item-master sheet and a sales
 * register that moves those items.
 *
 * Two files rather than one because `resolveStockItems` is a gate, not a
 * setting — a voucher gets `ALLINVENTORYENTRIES` only if the workspace already
 * holds a `StockItem` whose name folds to the line's item name. Upload the
 * masters first and the same register posts with stock; skip them and it posts
 * as ordinary ledger lines and nothing complains. That is the behaviour worth
 * showing in a demo, so the kit makes both halves explicit.
 *
 * The register is deliberately shaped like one a client would actually send:
 * preamble rows above the headers, a grand-total row at the bottom, day-first
 * dates, several lines to a bill, two GST rates inside one bill, and a mix of
 * intrastate and interstate parties decided by GSTIN state code. Every one of
 * those is a rule the competitor makes the accountant satisfy by hand.
 *
 *   npx tsx scripts/make-demo-inventory-sheets.mts [outDir]
 */
import ExcelJS from "exceljs";
import path from "node:path";
import { writeFile } from "node:fs/promises";

const outDir = process.argv[2] ?? path.join(process.cwd(), "scripts");

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

/**
 * A base unit is permanent once stock has moved against it in Tally, which is
 * why `mapItemMasters` refuses to guess one. Every row here carries its own.
 */
const ITEMS = [
  // name                      unit   hsn     gst  openQty openRate  alias
  ["Ambika Basmati Rice 5kg",  "Bag", "1006",   5,     40,     480, "RICE-5KG"],
  ["Sunflower Oil 1L Pouch",   "Ltr", "1512",   5,    120,     132, "OIL-1L"],
  ["Detergent Powder 1kg",     "Kg",  "3402",  18,     60,      96, "DET-1KG"],
  ["Steel Almirah 6ft",        "Nos", "9403",  18,      5,    8400, "ALM-6FT"],
  ["LED Bulb 9W",              "Nos", "8539",  12,    200,      78, "LED-9W"],
] as const;

const ITEM_HEADERS = [
  "Item Name", "Unit", "HSN", "GST Rate", "Opening Qty", "Opening Rate", "Alias",
];

// ---------------------------------------------------------------------------
// Sales register
// ---------------------------------------------------------------------------

/** Company is in Karnataka (29). A party in 29 is intrastate; anything else is not. */
const COMPANY_STATE = "29";

interface Line {
  item: string;
  hsn: string;
  qty: number;
  rate: number;
  gst: number;
}

interface Bill {
  no: string;
  date: string;
  party: string;
  gstin: string;
  narration: string;
  lines: Line[];
}

const BILLS: Bill[] = [
  {
    no: "INV-3001", date: "03/08/2026",
    party: "Sharma Traders", gstin: "29AABCS1234L1Z5",
    narration: "Monthly grocery supply",
    lines: [
      { item: "Ambika Basmati Rice 5kg", hsn: "1006", qty: 20, rate: 520, gst: 5 },
      { item: "Sunflower Oil 1L Pouch", hsn: "1512", qty: 50, rate: 145, gst: 5 },
    ],
  },
  {
    no: "INV-3002", date: "06/08/2026",
    party: "Delhi Supplies Pvt Ltd", gstin: "07AAACD5678M1Z2",
    narration: "Furniture order",
    lines: [{ item: "Steel Almirah 6ft", hsn: "9403", qty: 2, rate: 9500, gst: 18 }],
  },
  {
    // Two GST rates inside one bill. Their mapping UI has one Amount slot, so
    // this is the case their "sheet modification for multiple GST rates"
    // article exists to work around.
    no: "INV-3003", date: "11/08/2026",
    party: "Bengaluru Print House", gstin: "29AAFCB3456Q1Z1",
    narration: "Mixed-rate order",
    lines: [
      { item: "LED Bulb 9W", hsn: "8539", qty: 100, rate: 85, gst: 12 },
      { item: "Detergent Powder 1kg", hsn: "3402", qty: 30, rate: 110, gst: 18 },
      { item: "Ambika Basmati Rice 5kg", hsn: "1006", qty: 5, rate: 520, gst: 5 },
    ],
  },
  {
    no: "INV-3004", date: "19/08/2026",
    party: "Chennai Logistics", gstin: "33AAGCC7890R1Z4",
    narration: "Bulk despatch",
    lines: [
      { item: "Detergent Powder 1kg", hsn: "3402", qty: 80, rate: 108, gst: 18 },
      { item: "LED Bulb 9W", hsn: "8539", qty: 250, rate: 82, gst: 12 },
    ],
  },
  {
    no: "INV-3005", date: "26/08/2026",
    party: "Nagpur Steel Co", gstin: "27AAECN9012P1Z8",
    narration: "Almirah consignment",
    lines: [{ item: "Steel Almirah 6ft", hsn: "9403", qty: 6, rate: 9200, gst: 18 }],
  },
];

const SALES_HEADERS = [
  "Invoice No.", "Invoice Date", "Customer Name", "GSTIN",
  "Item Name", "HSN", "Qty", "Rate", "Taxable Value",
  "CGST", "SGST", "IGST", "Invoice Total", "Narration",
];

const r2 = (n: number) => Math.round(n * 100) / 100;

type Cell = string | number | null;

/** One bill -> its rows, with the invoice total on the head row only. */
function billRows(bill: Bill): { rows: Cell[][]; total: number } {
  const interstate = !bill.gstin.startsWith(COMPANY_STATE);
  const rows: Cell[][] = [];
  let total = 0;

  for (const line of bill.lines) {
    const taxable = r2(line.qty * line.rate);
    const tax = r2((taxable * line.gst) / 100);
    const half = r2(tax / 2);
    total = r2(total + taxable + tax);
    rows.push([
      bill.no, bill.date, bill.party, bill.gstin,
      line.item, line.hsn, line.qty, line.rate, taxable,
      interstate ? null : half,
      interstate ? null : half,
      interstate ? tax : null,
      null,
      bill.narration,
    ]);
  }

  // `statedTotalForGroup` takes the single stated value when only one row
  // carries it, which is what a register looks like: the bill total sits on
  // the first line, not repeated down every line.
  rows[0][12] = total;
  return { rows, total };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

function toCsv(rows: Cell[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell == null) return "";
          const text = String(cell);
          return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
        })
        .join(",")
    )
    .join("\r\n");
}

async function write(name: string, sheetName: string, grid: Cell[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of grid) ws.addRow(row as ExcelJS.CellValue[]);
  const xlsx = path.join(outDir, name + ".xlsx");
  const csv = path.join(outDir, name + ".csv");
  await wb.xlsx.writeFile(xlsx);
  await writeFile(csv, toCsv(grid), "utf8");
  console.log("wrote " + xlsx);
  console.log("wrote " + csv);
}

// --- item masters: headers on row 1, nothing clever about it ---------------
await write("demo-item-masters", "Item Masters", [
  ITEM_HEADERS,
  ...ITEMS.map((i) => [...i] as Cell[]),
]);

// --- sales register: preamble, then headers on row 4, then a total row ------
const salesGrid: Cell[][] = [
  ["ACME MANUFACTURING PVT LTD"],
  ["Sales Register — 01/08/2026 to 31/08/2026"],
  [],
  SALES_HEADERS,
];

let gTaxable = 0;
let gCgst = 0;
let gSgst = 0;
let gIgst = 0;
let gTotal = 0;

for (const bill of BILLS) {
  const { rows, total } = billRows(bill);
  for (const row of rows) {
    gTaxable = r2(gTaxable + Number(row[8] ?? 0));
    gCgst = r2(gCgst + Number(row[9] ?? 0));
    gSgst = r2(gSgst + Number(row[10] ?? 0));
    gIgst = r2(gIgst + Number(row[11] ?? 0));
    salesGrid.push(row);
  }
  gTotal = r2(gTotal + total);
}

// The grand-total row their checklist tells the user to delete first.
salesGrid.push([
  "", "", "TOTAL", "", "", "", null, null, gTaxable, gCgst, gSgst, gIgst, gTotal, "",
]);

await write("demo-sales-register-items", "Sales Register", salesGrid);

console.log("");
console.log("items            : " + ITEMS.length);
console.log(
  "bills            : " + BILLS.length +
    " across " + BILLS.reduce((n, b) => n + b.lines.length, 0) + " rows"
);
console.log("intrastate       : " + BILLS.filter((b) => b.gstin.startsWith(COMPANY_STATE)).length);
console.log("interstate       : " + BILLS.filter((b) => !b.gstin.startsWith(COMPANY_STATE)).length);
console.log("expected taxable : " + gTaxable.toFixed(2));
console.log("expected tax     : " + r2(gCgst + gSgst + gIgst).toFixed(2));
console.log("expected total   : " + gTotal.toFixed(2));
