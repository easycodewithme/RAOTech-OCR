/**
 * End-to-end: stock item masters -> a purchase that moves stock -> TallyPrime.
 *
 * The gap this closes was not a missing feature, it was a silent corruption.
 * A WITH_ITEM spreadsheet parsed its item rows and then posted a ledger-only
 * voucher: the money landed correctly and the quantities never moved, so a
 * client who keeps stock in Tally had their stock reports drift further from
 * reality every month with nothing in either system saying so.
 *
 * Runs the real pipeline below HTTP — real masters, real ledger resolution,
 * real voucher build, real job payloads, real TallyPrime.
 *
 *   npx tsx scripts/e2e-inventory.mts run       # local checks + queue the push
 *   npx tsx scripts/e2e-inventory.mts check     # after the connector drains
 *   npx tsx scripts/e2e-inventory.mts cleanup   # unpost, then drop the rows
 */
import { PrismaClient } from "@prisma/client";
import { createDraftVoucherForInvoice } from "../src/lib/accounting/createVoucher";
import { loadStockItemIndex } from "../src/lib/accounting/resolveStockItems";
import {
  buildMasterCreatePayload,
  buildVoucherDeletePayload,
  buildVoucherPushPayload,
  enqueueJob,
} from "../src/lib/tally/syncJobs";
import type { NormalizedInvoice } from "../src/lib/accounting/types";

const prisma = new PrismaClient();
const EMAIL = process.env.E2E_EMAIL ?? "spotmefy2204@gmail.com";
const CLIENT_NAME = "Tally Demo (RAOTECH)";
const MARKER = "inv-e2e";

function head(s: string) {
  console.log("\n" + "=".repeat(70) + "\n" + s + "\n" + "=".repeat(70));
}

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
  if (!ok) failures++;
}

const ctx = async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const client = await prisma.client.findFirstOrThrow({
    where: { userId: user.id, name: CLIENT_NAME },
  });
  const company = await prisma.tallyCompany.findUniqueOrThrow({
    where: { clientId: client.id },
  });
  return { userId: user.id, clientId: client.id, company };
};

const ITEMS = [
  { name: "RAO Widget 10mm", unit: "Nos", hsnCode: "84719000", gstRate: 18 },
  { name: "RAO Cable 2core", unit: "Mtr", hsnCode: "85444999", gstRate: 18 },
];

const LEDGERS = [
  { name: "RAO Stock Purchase", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE" },
  { name: "RAO Stock Supplier", group: "SUNDRY_CREDITORS", ledgerType: "PARTY" },
  { name: "RAO Stock CGST", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT" },
  { name: "RAO Stock SGST", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT" },
] as const;

/** 10 @ 100 = 1000, 25 @ 40 = 1000. Taxable 2000, 9% + 9% = 360, total 2360. */
const INVOICE: NormalizedInvoice = {
  invoiceNumber: "RAO-STK-1",
  date: new Date("2026-08-06T00:00:00"),
  vendor: "RAO Stock Supplier",
  vendorGstin: null,
  customerName: null,
  customerGstin: null,
  subtotal: 2000,
  cgst: 180,
  sgst: 180,
  igst: 0,
  cess: 0,
  discount: 0,
  roundOff: 0,
  total: 2360,
  items: [
    { name: "RAO Widget 10mm", qty: 10, rate: 100, price: 1000, hsnCode: "84719000", gstRate: 18 },
    { name: "RAO Cable 2core", qty: 25, rate: 40, price: 1000, hsnCode: "85444999", gstRate: 18 },
  ],
} as NormalizedInvoice;

async function run() {
  const { userId, clientId, company } = await ctx();

  head("1. CLEAR THE PREVIOUS RUN");
  const prior = await prisma.invoice.findFirst({
    where: { userId, clientId, fileUrl: { startsWith: `${MARKER}://` } },
    select: { id: true, voucher: { select: { id: true } } },
  });
  if (prior?.voucher) {
    const stuck = await prisma.voucherSync.count({
      where: { voucherId: prior.voucher.id, state: { in: ["POSTED", "SENDING"] } },
    });
    if (stuck) {
      throw new Error(
        "The previous run's voucher may still be in Tally. Run `cleanup` and drain the " +
          "delete job first -- deleting it here would strand it in the client's books."
      );
    }
    await prisma.voucherSync.deleteMany({ where: { voucherId: prior.voucher.id } });
    await prisma.voucherLine.deleteMany({ where: { voucherId: prior.voucher.id } });
    await prisma.voucher.delete({ where: { id: prior.voucher.id } });
  }
  if (prior) await prisma.invoice.delete({ where: { id: prior.id } });
  await prisma.syncJob.deleteMany({
    where: { userId, clientId, state: { in: ["QUEUED", "CLAIMED"] } },
  });
  console.log("cleared");

  head("2. MASTERS -- ledgers and stock items");
  for (const l of LEDGERS) {
    await prisma.ledger.upsert({
      where: { userId_clientId_name: { userId, clientId, name: l.name } },
      create: {
        userId,
        clientId,
        name: l.name,
        group: l.group,
        ledgerType: l.ledgerType,
        tallyCompanyId: company.id,
      },
      update: {},
      select: { id: true },
    });
  }
  for (const i of ITEMS) {
    await prisma.stockItem.upsert({
      where: { userId_clientId_name: { userId, clientId, name: i.name } },
      create: { userId, clientId, ...i, tallyCompanyId: company.id },
      update: {},
      select: { id: true },
    });
  }
  const index = await loadStockItemIndex(prisma, userId, clientId);
  console.log(`stock items known: ${index.size}`);
  check(index.size >= 2, "the stock masters are in the index the builder reads");

  head("3. BUILD -- item lines gain an inventory allocation");
  const invoice = await prisma.invoice.create({
    data: {
      userId,
      clientId,
      fileUrl: `${MARKER}://purchase-1`,
      status: "PROCESSED",
      documentType: "PURCHASE",
      invoiceNumber: INVOICE.invoiceNumber,
      date: INVOICE.date,
      vendor: INVOICE.vendor,
      subtotal: INVOICE.subtotal,
      cgst: INVOICE.cgst,
      sgst: INVOICE.sgst,
      igst: 0,
      totalAmount: INVOICE.total,
      taxAmount: 360,
    },
    select: { id: true },
  });

  const byName = async (n: string) =>
    (await prisma.ledger.findFirstOrThrow({
      where: { userId, clientId, name: n },
      select: { id: true },
    })).id;

  const voucher = await createDraftVoucherForInvoice(userId, invoice.id, {
    clientId,
    voucherTypeOverride: "PURCHASE",
    normalized: INVOICE,
    partyLedgerId: await byName("RAO Stock Supplier"),
    ledgerOverrides: {
      itemLedgerId: await byName("RAO Stock Purchase"),
      cgstLedgerId: await byName("RAO Stock CGST"),
      sgstLedgerId: await byName("RAO Stock SGST"),
    },
  });

  const lines = await prisma.voucherLine.findMany({
    where: { voucherId: voucher.id },
    orderBy: { sortOrder: "asc" },
  });
  for (const l of lines) {
    console.log(
      `  ${l.role.padEnd(6)} ${(l.ledgerNameSnapshot ?? "?").padEnd(22)} ` +
        `dr ${l.debit.toFixed(2).padStart(9)} cr ${l.credit.toFixed(2).padStart(9)}  ` +
        (l.stockItemName ? `${l.stockItemName} ${l.quantity} ${l.unit} @ ${l.rate}` : "")
    );
  }

  const stockLines = lines.filter((l) => l.stockItemName);
  check(stockLines.length === 2, "both item lines carry an allocation", `${stockLines.length}/2`);
  check(
    stockLines.every((l) => l.quantity && l.unit && l.rate),
    "each allocation has a quantity, a unit and a rate"
  );
  check(
    lines.filter((l) => l.role === "CGST" || l.role === "SGST").every((l) => !l.stockItemName),
    "tax lines carry no allocation"
  );
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  check(Math.abs(dr - cr) < 0.005, "the voucher balances", `${dr.toFixed(2)} / ${cr.toFixed(2)}`);

  head("4. ENVELOPE -- the ledger appears once, nested");
  await prisma.voucher.update({
    where: { id: voucher.id },
    data: { status: "APPROVED", approvedAt: new Date() },
  });

  const push = await buildVoucherPushPayload(prisma, {
    userId,
    clientId,
    tallyCompanyId: company.id,
    companyName: company.companyName,
    voucherIds: [voucher.id],
  });
  const xml = push.vouchers[0].xml;

  const countOf = (t: string) => (xml.match(new RegExp(`<${t}>`, "g")) ?? []).length;
  console.log(`  ALLINVENTORYENTRIES : ${countOf("ALLINVENTORYENTRIES.LIST")}`);
  console.log(`  ACCOUNTINGALLOCATIONS: ${countOf("ACCOUNTINGALLOCATIONS.LIST")}`);
  console.log(`  ALLLEDGERENTRIES    : ${countOf("ALLLEDGERENTRIES.LIST")}`);

  check(countOf("ALLINVENTORYENTRIES.LIST") === 2, "one inventory entry per item");
  check(countOf("ACCOUNTINGALLOCATIONS.LIST") === 2, "each has its ledger nested inside");
  check(
    countOf("ALLLEDGERENTRIES.LIST") === 3,
    "party and the two tax ledgers stay ordinary entries",
    `${countOf("ALLLEDGERENTRIES.LIST")}`
  );

  /**
   * The doubling guard, checked on the actual envelope rather than trusted.
   * The purchase ledger nested AND as a sibling is a voucher Tally accepts,
   * that balances, and that debits the client's expense twice.
   */
  const itemLedger = lines.find((l) => l.role === "ITEM")!.ledgerNameSnapshot!;
  // Counted by splitting rather than with a regex: a ledger name is user data
  // and may contain regex metacharacters.
  const mentions = xml.split(itemLedger).length - 1;
  check(
    mentions === 2,
    `"${itemLedger}" is named once per item and never as a sibling entry`,
    `${mentions} mentions, 2 items`
  );
  check(
    itemLedger === "RAO Stock Purchase",
    "the explicit ledger override beat the resolver's guess",
    itemLedger
  );
  check(xml.includes("10 Nos"), "quantity carries its unit");
  check(xml.includes("/Nos"), "rate carries its unit");

  head("5. QUEUE");
  const masters = await buildMasterCreatePayload(prisma, {
    userId,
    clientId,
    companyName: company.companyName,
  });
  if (masters) {
    const j = await enqueueJob(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      kind: "MASTER_CREATE",
      payload: { ...masters },
    });
    console.log(
      `queued MASTER_CREATE ${j.id}  (${masters.ledgerIds.length} ledgers, ` +
        `${masters.stockItemIds.length} stock items)`
    );
    check(masters.stockItemIds.length >= 2, "the stock masters go in the same envelope");
    check(masters.xml.includes("<UNIT NAME="), "units are declared before the items");
    check(!masters.xml.includes("<PARENT>Primary</PARENT>"), "no stock item names a stock group");
  }

  const j = await enqueueJob(prisma, {
    userId,
    clientId,
    tallyCompanyId: company.id,
    kind: "VOUCHER_PUSH",
    payload: { ...push },
  });
  console.log(`queued VOUCHER_PUSH  ${j.id}`);
  console.log("\nrun the connector, then: npx tsx scripts/e2e-inventory.mts check");
}

async function checkState() {
  const { userId, clientId, company } = await ctx();
  head("SYNC STATE");

  const invoice = await prisma.invoice.findFirst({
    where: { userId, clientId, fileUrl: { startsWith: `${MARKER}://` } },
    select: { voucher: { select: { id: true } } },
  });
  if (!invoice?.voucher) {
    console.log("nothing built yet -- run `run` first");
    return;
  }

  const sync = await prisma.voucherSync.findFirst({
    where: { voucherId: invoice.voucher.id, tallyCompanyId: company.id },
    select: { state: true, remoteId: true, error: true },
  });
  console.log(`  ${sync?.state ?? "NOT QUEUED"}  ${sync?.remoteId ?? ""}`);
  if (sync?.error) console.log(`  Tally said: ${sync.error}`);

  const items = await prisma.stockItem.findMany({
    where: { userId, clientId, name: { startsWith: "RAO " } },
    select: { name: true, tallySyncedAt: true },
  });
  for (const i of items) {
    console.log(`  ${i.name.padEnd(22)} ${i.tallySyncedAt ? "master created" : "not yet in Tally"}`);
  }

  check(sync?.state === "POSTED", "the stock voucher reached Tally", sync?.state ?? "none");
}

async function cleanup() {
  const { userId, clientId, company } = await ctx();
  head("CLEANUP");

  const invoice = await prisma.invoice.findFirst({
    where: { userId, clientId, fileUrl: { startsWith: `${MARKER}://` } },
    select: { id: true, voucher: { select: { id: true } } },
  });
  if (!invoice) {
    console.log("nothing to clean up");
    return;
  }

  const voucherId = invoice.voucher?.id;
  if (voucherId && process.env.CONFIRM_DELETE !== "1") {
    const del = await buildVoucherDeletePayload(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      companyName: company.companyName,
      voucherIds: [voucherId],
    });
    const j = await enqueueJob(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      kind: "VOUCHER_DELETE",
      payload: { ...del },
    });
    console.log(`queued VOUCHER_DELETE ${j.id}`);
    console.log("run the connector, then re-run with CONFIRM_DELETE=1");
    return;
  }

  if (process.env.CONFIRM_DELETE === "1") {
    if (voucherId) {
      const stuck = await prisma.voucherSync.count({
        where: { voucherId, state: { in: ["POSTED", "SENDING"] } },
      });
      if (stuck) {
        console.log("REFUSING: the voucher may still be in Tally. Drain the delete job first.");
        failures++;
        return;
      }
      await prisma.voucherSync.deleteMany({ where: { voucherId } });
      await prisma.voucherLine.deleteMany({ where: { voucherId } });
      await prisma.voucher.delete({ where: { id: voucherId } });
    }
    await prisma.invoice.delete({ where: { id: invoice.id } });
    // Stock item masters are left in Tally: an item with movement cannot be
    // deleted there anyway, and they are harmless.
    await prisma.stockItem.deleteMany({
      where: { userId, clientId, name: { startsWith: "RAO " } },
    });
    console.log("local rows removed");
  }
}

const cmd = process.argv[2] ?? "run";
if (cmd === "run") {
  await run();
  head(failures === 0 ? "ALL LOCAL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
} else if (cmd === "check") {
  await checkState();
} else if (cmd === "cleanup") {
  await cleanup();
} else {
  console.error("usage: npx tsx scripts/e2e-inventory.mts <run|check|cleanup>");
}

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
