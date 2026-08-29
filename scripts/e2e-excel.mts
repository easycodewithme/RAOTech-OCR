/**
 * End-to-end: spreadsheet → mapped → draft vouchers → Tally.
 *
 * Drives the same library functions the API routes call, because the routes sit
 * behind a Clerk session a script cannot forge. Everything below the HTTP layer
 * is the real thing: real parser, real mapper, real accounting pipeline, real
 * connector, real TallyPrime.
 *
 *   npx tsx scripts/e2e-excel.mts <login-email>
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseSheet } from "../src/lib/excel/parse";
import { detectLayout } from "../src/lib/excel/detectLayout";
import { suggestMapping } from "../src/lib/excel/suggestMapping";
import { validateRows } from "../src/lib/excel/validate";
import { mapRows } from "../src/lib/excel/mapRows";
import { createDraftVoucherForInvoice } from "../src/lib/accounting/createVoucher";
import {
  buildMasterCreatePayload,
  buildVoucherPushPayload,
  enqueueJob,
} from "../src/lib/tally/syncJobs";

const prisma = new PrismaClient();
const email = process.argv[2] ?? "spotmefy2204@gmail.com";
const SHEET = path.join(process.cwd(), "scripts", "demo-purchase-register.xlsx");
const CLIENT_NAME = "Tally Demo (RAOTECH)";

function head(s: string) {
  console.log("\n" + "=".repeat(66) + "\n" + s + "\n" + "=".repeat(66));
}

const user = await prisma.user.findUniqueOrThrow({ where: { email } });
const client = await prisma.client.findFirstOrThrow({
  where: { userId: user.id, name: CLIENT_NAME },
});
const company = await prisma.tallyCompany.findUniqueOrThrow({
  where: { clientId: client.id },
});

// ---------------------------------------------------------------- 1. parse
head("1. PARSE — a sheet shaped like a real client's, not like our parser");
const parsed = await parseSheet({ path: SHEET, fileName: "demo-purchase-register.xlsx" });
console.log(`sheet            : ${parsed.sheetName}`);
console.log(`header row       : ${parsed.headerRowIndex + 1}  (rows 1-3 are preamble)`);
console.log(`headers          : ${parsed.headers.join(" | ")}`);
console.log(`data rows        : ${parsed.rows.length}`);
console.log(`dropped as total : ${parsed.droppedRowIndexes.length}`);

// ---------------------------------------------------------------- 2. detect
head("2. DETECT + SUGGEST — layout and columns, without being told");
const layout = detectLayout(parsed.headers);
console.log(`tax layout       : ${layout.taxLayout}  (confidence ${layout.confidence.toFixed(2)})`);
console.log(`reason           : ${layout.reason}`);

const suggestion = suggestMapping(parsed.headers, layout, "PURCHASE", "WITHOUT_ITEM", {
  sampleRows: parsed.rows.slice(0, 50),
  headerRowIndex: parsed.headerRowIndex,
});
console.log(`overall confidence: ${suggestion.overall.toFixed(2)}`);
for (const [field, s] of Object.entries(suggestion.fields)) {
  if (s.column === null) continue;
  console.log(
    `  ${field.padEnd(14)} -> ${String(parsed.headers[s.column]).padEnd(16)} (${s.confidence.toFixed(2)})`
  );
}

// Ledgers the mapping posts to. Reuse the demo workspace's own accounts.
const ledgers = await prisma.ledger.findMany({
  where: { userId: user.id, clientId: client.id },
  select: { id: true, name: true, tallyGuid: true },
});
const byName = (n: string) => ledgers.find((l) => l.name === n)?.id ?? null;

const mapping = {
  ...suggestion.mapping,
  ledgers: {
    ...suggestion.mapping.ledgers,
    primaryLedgerId: byName("Demo Purchase A/c"),
    cgstLedgerId: byName("Demo CGST"),
    sgstLedgerId: byName("Demo SGST"),
    igstLedgerId: byName("Demo CGST"), // no IGST ledger seeded; reuse for the test
  },
};

// ------------------------------------------------------------- 3. validate
head("3. VALIDATE + MAP");
const issues = validateRows(parsed, mapping, { booksFrom: company.booksFrom });
const result = mapRows(parsed, mapping, {
  userId: user.id,
  clientId: client.id,
  ledgers,
  issues,
  companyStateCode: client.gstin ?? null,
  booksFrom: company.booksFrom,
});

const blocking = result.issues.filter((i) => i.severity === "error");
console.log(`committable      : ${result.committableCount} of ${parsed.rows.length}`);
console.log(`blocking issues  : ${blocking.length}`);
console.log(`warnings         : ${result.issues.length - blocking.length}`);
for (const i of result.issues.slice(0, 8)) {
  console.log(`  row ${String(i.row + 1).padStart(2)}  ${i.severity.padEnd(7)} ${i.code}: ${i.message}`);
}
console.log(`missing parties  : ${result.missingParties.join(", ") || "(none)"}`);

console.log("\nmapped invoices:");
let sumTaxable = 0;
let sumCgst = 0;
let sumIgst = 0;
for (const r of result.rows) {
  if (!r.invoice) continue;
  const v = r.invoice;
  sumTaxable += v.subtotal;
  sumCgst += v.cgst;
  sumIgst += v.igst;
  const kind = v.igst > 0 ? "interstate" : "intrastate";
  console.log(
    `  ${String(v.invoiceNumber).padEnd(9)} ${v.date.toISOString().slice(0, 10)}  ` +
      `${String(v.vendor).padEnd(24)} taxable ${v.subtotal.toFixed(2).padStart(10)}  ` +
      `cgst ${v.cgst.toFixed(2).padStart(8)}  igst ${v.igst.toFixed(2).padStart(8)}  ${kind}`
  );
}
console.log(`\ntaxable total    : ${sumTaxable.toFixed(2)}   (sheet says 136300.00)`);
console.log(`cgst total       : ${sumCgst.toFixed(2)}`);
console.log(`igst total       : ${sumIgst.toFixed(2)}`);
console.log(
  sumTaxable.toFixed(2) === "136300.00"
    ? "TAXABLE RECONCILES with the sheet's own grand total"
    : "MISMATCH against the sheet's grand total"
);

// --------------------------------------------------- 3b. create missing parties
head("3b. MISSING PARTIES — created explicitly, never silently");
/**
 * The design refuses to invent masters. A party the sheet names but the
 * workspace has never seen resolves to nothing, the voucher line has no ledger,
 * and Tally answers `Ledger 'Unknown' does not exist!`.
 *
 * In the product this is the review step: the wizard lists the missing parties
 * and the user creates them with a group chosen. Here we do the same thing
 * non-interactively. Note what we are NOT doing — pushing anyway and letting
 * Tally auto-create, which is the behaviour their docs label "not recommended".
 */
for (const name of result.missingParties) {
  const existing = await prisma.ledger.findFirst({
    where: { userId: user.id, clientId: client.id, name },
    select: { id: true },
  });
  if (existing) continue;
  await prisma.ledger.create({
    data: {
      userId: user.id,
      clientId: client.id,
      name,
      group: "SUNDRY_CREDITORS",
      ledgerType: "PARTY",
      tallyCompanyId: company.id,
    },
  });
}
console.log(`created ${result.missingParties.length} party ledgers locally (no Tally GUID yet)`);

// Re-map so the rows pick up the ledgers that now exist.
const ledgers2 = await prisma.ledger.findMany({
  where: { userId: user.id, clientId: client.id },
  select: { id: true, name: true, tallyGuid: true },
});
const result2 = mapRows(parsed, mapping, {
  userId: user.id,
  clientId: client.id,
  ledgers: ledgers2,
  issues,
  companyStateCode: client.gstin ?? null,
  booksFrom: company.booksFrom,
});
console.log(`still missing after creation: ${result2.missingParties.join(", ") || "(none)"}`);

// ---------------------------------------------------------------- 4. commit
head("4. COMMIT — into the existing accounting pipeline");
let created = 0;
for (const r of result2.rows) {
  if (!r.invoice || r.issues.some((i) => i.severity === "error")) continue;
  const v = r.invoice;
  const exists = await prisma.invoice.findFirst({
    where: { userId: user.id, clientId: client.id, invoiceNumber: v.invoiceNumber },
    select: { id: true },
  });
  if (exists) continue;

  const invoice = await prisma.invoice.create({
    data: {
      userId: user.id,
      clientId: client.id,
      fileUrl: `excel://e2e#${r.row}`,
      status: "PROCESSED",
      invoiceNumber: v.invoiceNumber,
      date: v.date,
      vendor: v.vendor,
      vendorGstin: v.vendorGstin,
      subtotal: v.subtotal,
      cgst: v.cgst,
      sgst: v.sgst,
      igst: v.igst,
      discount: v.discount,
      totalAmount: v.total,
      taxAmount: v.cgst + v.sgst + v.igst,
      documentType: "PURCHASE",
      items: v.items as never,
    },
    select: { id: true },
  });

  const party =
    r.partyLedgerId ??
    ledgers2.find((l) => l.name === v.vendor)?.id ??
    undefined;

  await createDraftVoucherForInvoice(user.id, invoice.id, {
    clientId: client.id,
    voucherTypeOverride: "PURCHASE",
    partyLedgerId: party,
    normalized: v,
    ledgerOverrides: {
      itemLedgerId: mapping.ledgers.primaryLedgerId,
      cgstLedgerId: mapping.ledgers.cgstLedgerId,
      sgstLedgerId: mapping.ledgers.sgstLedgerId,
      igstLedgerId: mapping.ledgers.igstLedgerId,
    },
  });
  created++;
}
console.log(`draft vouchers created: ${created}`);

// ---------------------------------------------------------------- 5. approve
head("5. APPROVE + QUEUE FOR TALLY");
const drafts = await prisma.voucher.findMany({
  where: { clientId: client.id, status: "DRAFT" },
  select: { id: true },
});
await prisma.voucher.updateMany({
  where: { id: { in: drafts.map((d) => d.id) } },
  data: { status: "APPROVED", approvedAt: new Date() },
});
console.log(`approved: ${drafts.length}`);

const masters = await buildMasterCreatePayload(prisma, {
  userId: user.id,
  clientId: client.id,
  companyName: company.companyName,
});
if (masters) {
  const j = await enqueueJob(prisma, {
    userId: user.id,
    clientId: client.id,
    tallyCompanyId: company.id,
    kind: "MASTER_CREATE",
    payload: { ...masters },
  });
  console.log(`queued MASTER_CREATE ${j.id} (${masters.ledgerIds.length} ledgers)`);
}

const approved = await prisma.voucher.findMany({
  where: { clientId: client.id, status: "APPROVED" },
  select: { id: true },
});
const push = await buildVoucherPushPayload(prisma, {
  userId: user.id,
  clientId: client.id,
  tallyCompanyId: company.id,
  companyName: company.companyName,
  voucherIds: approved.map((v) => v.id),
});
const job = await enqueueJob(prisma, {
  userId: user.id,
  clientId: client.id,
  tallyCompanyId: company.id,
  kind: "VOUCHER_PUSH",
  payload: { ...push },
});
console.log(`queued VOUCHER_PUSH ${job.id} (${push.vouchers.length} vouchers)`);
console.log("\nthe connector will drain these; run `check` next");

await prisma.$disconnect();
