/**
 * Prove the demo kit parses and maps before anyone puts it in front of a client.
 *
 * Runs the real library — same parser, same layout detection, same auto-mapping,
 * same validator, same mapper the upload route calls — and prints what a commit
 * would actually write. No database, no Clerk, no Tally: this answers "is the
 * sheet right", not "is the connector up".
 *
 *   npx tsx scripts/verify-demo-sheets.mts
 */
import path from "node:path";
import { parseSheet } from "../src/lib/excel/parse";
import { detectLayout } from "../src/lib/excel/detectLayout";
import { suggestMapping } from "../src/lib/excel/suggestMapping";
import { validateRows } from "../src/lib/excel/validate";
import { mapRows } from "../src/lib/excel/mapRows";
import { suggestMasterMapping, mapItemMasters } from "../src/lib/excel/masters";

const dir = path.join(process.cwd(), "scripts");
const money = (n: number) => n.toFixed(2).padStart(12);

function head(s: string) {
  console.log("\n" + "=".repeat(70) + "\n" + s + "\n" + "=".repeat(70));
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}

// ---------------------------------------------------------------- item masters
head("ITEM MASTERS — demo-item-masters.xlsx");

const itemsFile = path.join(dir, "demo-item-masters.xlsx");
const itemSheet = await parseSheet({ path: itemsFile, fileName: "demo-item-masters.xlsx" });
console.log(`headers   : ${itemSheet.headers.join(" | ")}`);
console.log(`data rows : ${itemSheet.rows.length}`);

const itemMapping = suggestMasterMapping(itemSheet.headers, "ITEM_MASTER");
console.log(
  "auto-map  : " +
    Object.entries(itemMapping)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=col${(v as number) + 1}`)
      .join("  ")
);

const itemResult = mapItemMasters(itemSheet, itemMapping);
console.log("");
for (const row of itemResult.rows) {
  const d = row.draft;
  console.log(
    d
      ? `  ${d.name.padEnd(26)} ${String(d.unit).padEnd(4)} hsn ${String(d.hsnCode).padEnd(6)} ${String(d.gstRate)}%  opening ${d.openingQty} @ ${d.openingRate}`
      : `  row ${row.row + 1}: ${row.issues.map((i) => i.message).join("; ")}`
  );
}
console.log("");
check("every item row committable", itemResult.committableCount === itemSheet.rows.length,
  `${itemResult.committableCount}/${itemSheet.rows.length}`);
check("no blocking issues", itemResult.issues.filter((i) => i.severity === "error").length === 0,
  itemResult.issues.map((i) => i.code).join(",") || "none");
check("every item has a unit", itemResult.rows.every((r) => r.draft?.unit));

// ---------------------------------------------------------------- sales register
head("SALES REGISTER — demo-sales-register-items.xlsx");

const salesFile = path.join(dir, "demo-sales-register-items.xlsx");
const parsed = await parseSheet({
  path: salesFile,
  fileName: "demo-sales-register-items.xlsx",
});
console.log(`sheet            : ${parsed.sheetName}`);
console.log(`header row       : ${parsed.headerRowIndex + 1}  (rows 1-3 are preamble)`);
console.log(`data rows        : ${parsed.rows.length}`);
console.log(`dropped as total : ${parsed.droppedRowIndexes.length}`);

const layout = detectLayout(parsed.headers);
console.log(`tax layout       : ${layout.taxLayout} (confidence ${layout.confidence.toFixed(2)})`);
console.log(`reason           : ${layout.reason}`);

const suggestion = suggestMapping(parsed.headers, layout, "SALE", "WITH_ITEM", {
  sampleRows: parsed.rows.slice(0, 50),
  headerRowIndex: parsed.headerRowIndex,
});
console.log(`overall conf.    : ${suggestion.overall.toFixed(2)}`);
console.log("");
for (const [field, s] of Object.entries(suggestion.fields)) {
  if (s.column === null) continue;
  console.log(
    `  ${field.padEnd(14)} -> col ${String(s.column + 1).padStart(2)} "${parsed.headers[s.column]}"` +
      `   ${s.confidence.toFixed(2)}`
  );
}
if (suggestion.unmappedColumns.length) {
  console.log(
    "  unclaimed      : " +
      suggestion.unmappedColumns.map((c) => `"${parsed.headers[c]}"`).join(", ")
  );
}

const mapping = suggestion.mapping;
// `requireLedgerMapping: false` is what `mapRows` itself defaults to and what
// the wizard passes: which sales and GST ledgers the lines post to is stage 3
// of the wizard, chosen against the client's own synced chart of accounts, and
// is not something a sheet can carry or a fixture can know.
const issues = validateRows(parsed, mapping, {
  booksFrom: null,
  requireLedgerMapping: false,
});
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");

const result = mapRows(parsed, mapping, {
  issues,
  companyStateCode: "29",
  ledgers: [],
});

console.log("");
console.log(`documents        : ${result.rows.length}`);
console.log(`committable      : ${result.committableCount}`);
console.log(`errors           : ${errors.length}`);
console.log(`warnings         : ${warnings.length}`);
for (const i of [...errors, ...warnings].slice(0, 10)) {
  console.log(`    row ${i.row + 1} ${i.severity} ${i.code}: ${i.message}`);
}

console.log("");
console.log("  invoice     date        party                     subtotal      cgst      sgst      igst       total  items");
let sumTotal = 0;
let sumTaxable = 0;
for (const row of result.rows) {
  const inv = row.invoice;
  if (!inv) continue;
  sumTotal += inv.total;
  sumTaxable += inv.subtotal;
  console.log(
    `  ${String(inv.invoiceNumber).padEnd(10)} ${inv.date.toISOString().slice(0, 10)}  ` +
      `${String(inv.vendor).padEnd(24)}${money(inv.subtotal)}${money(inv.cgst)}${money(inv.sgst)}` +
      `${money(inv.igst)}${money(inv.total)}  ${inv.items.length}`
  );
  for (const item of inv.items) {
    console.log(
      `      ${item.name.padEnd(28)} ${String(item.qty).padStart(6)} x ${String(item.rate).padStart(8)} = ${money(item.price)}  hsn ${item.hsnCode ?? "-"}  ${item.gstRate ?? "-"}%`
    );
  }
}

console.log("");
check("grand-total row dropped", parsed.droppedRowIndexes.length === 1);
check("9 line rows survived", parsed.rows.length === 9, String(parsed.rows.length));
check("fanned in to 5 bills", result.rows.length === 5, String(result.rows.length));
check("all 5 committable", result.committableCount === 5, String(result.committableCount));
check("no blocking errors", errors.length === 0, errors.map((e) => e.code).join(",") || "none");
check("layout detected LONG", layout.taxLayout === "LONG");
check("taxable reconciles to 135390.00", Math.abs(sumTaxable - 135390) < 0.01, sumTaxable.toFixed(2));
check("total reconciles to 155387.70", Math.abs(sumTotal - 155387.7) < 0.01, sumTotal.toFixed(2));
check(
  "9 item lines across the 5 bills",
  result.rows.reduce((n, r) => n + (r.invoice?.items.length ?? 0), 0) === 9
);
check(
  "interstate bills carry IGST only",
  result.rows.every((r) => {
    const inv = r.invoice;
    if (!inv) return false;
    const inter = !String(inv.vendorGstin).startsWith("29");
    return inter ? inv.cgst === 0 && inv.igst > 0 : inv.igst === 0 && inv.cgst > 0;
  })
);
check(
  "mixed-rate bill kept both rates",
  (() => {
    const inv = result.rows.find((r) => r.invoice?.invoiceNumber === "INV-3003")?.invoice;
    if (!inv) return false;
    return new Set(inv.items.map((i) => i.gstRate)).size === 3;
  })()
);
check("every party is NOT_IN_TALLY (no ledgers passed)",
  result.missingParties.length === 5, result.missingParties.join(", "));

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
