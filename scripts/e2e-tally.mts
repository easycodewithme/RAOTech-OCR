/**
 * End-to-end harness for the Tally connector.
 *
 * Proves the whole loop against real infrastructure: a real Postgres, the real
 * Next.js routes, the real Go connector binary, and a real TallyPrime. Nothing
 * here is mocked, which is the point — every individual piece already has unit
 * tests, and none of them can tell you the pieces fit together.
 *
 * It works inside an isolated workspace (its own User and Client) so it cannot
 * touch a real firm's books, and `cleanup` removes both the workspace and the
 * vouchers it posted into Tally.
 *
 *   npx tsx scripts/e2e-tally.mts seed      # workspace + approved voucher + pairing code
 *   npx tsx scripts/e2e-tally.mts enqueue   # queue the push job
 *   npx tsx scripts/e2e-tally.mts check     # report sync state, and what Tally holds
 *   npx tsx scripts/e2e-tally.mts cleanup   # remove from Tally, then drop the workspace
 */
import { PrismaClient } from "@prisma/client";
import { buildTallyDeleteXml, remoteIdFor } from "../src/lib/tally/exportXml";
import { pushToTally, type TallyGateway } from "../src/lib/tally/connector";
import {
  enqueueJob,
  buildVoucherPushPayload,
  buildMasterCreatePayload,
} from "../src/lib/tally/syncJobs";
import {
  generatePairingCode,
  formatPairingCode,
} from "../src/lib/tally/connectorAuth";

const prisma = new PrismaClient();

const E2E_EMAIL = "e2e-tally@raotech.local";
const E2E_CLERK = "e2e-tally-clerk-id";
const COMPANY = process.env.TALLY_COMPANY || "RAOTECH";
const gateway: TallyGateway = {
  host: process.env.TALLY_HOST || "localhost",
  port: Number(process.env.TALLY_PORT || 9000),
  timeoutMs: 30_000,
};

/**
 * Tally rejects dates before books-beginning and nothing after, so anchor on
 * the company's own start rather than "today" — which would break the moment
 * this runs against a company whose books start later.
 */
const VOUCHER_DATE = new Date("2026-08-01T00:00:00");

async function findWorkspace() {
  const user = await prisma.user.findUnique({ where: { email: E2E_EMAIL } });
  if (!user) return null;
  const client = await prisma.client.findFirst({ where: { userId: user.id } });
  return client ? { user, client } : null;
}

async function seed() {
  await cleanupWorkspace({ quiet: true });

  const user = await prisma.user.create({
    data: { clerkId: E2E_CLERK, email: E2E_EMAIL, name: "E2E Tally" },
  });
  const client = await prisma.client.create({
    data: { userId: user.id, name: "E2E Tally Test", isDefault: true },
  });
  const company = await prisma.tallyCompany.create({
    data: {
      userId: user.id,
      clientId: client.id,
      companyName: COMPANY,
      booksFrom: new Date("2026-04-01T00:00:00"),
      status: "READY",
    },
  });

  // Two ledgers, deliberately NOT carrying a tallyGuid, so the push has to
  // create them in Tally first — exercising the two-phase masters-then-vouchers
  // ordering rather than assuming a master sync has already run.
  const party = await prisma.ledger.create({
    data: {
      userId: user.id,
      clientId: client.id,
      name: "E2E Party Ltd",
      group: "SUNDRY_CREDITORS",
      ledgerType: "PARTY",
      tallyCompanyId: company.id,
    },
  });
  const cgst = await prisma.ledger.create({
    data: {
      userId: user.id,
      clientId: client.id,
      name: "E2E CGST",
      group: "DUTIES_AND_TAXES",
      ledgerType: "TAX_INPUT",
      gstRate: 9,
      tallyCompanyId: company.id,
    },
  });
  const sgst = await prisma.ledger.create({
    data: {
      userId: user.id,
      clientId: client.id,
      name: "E2E SGST",
      group: "DUTIES_AND_TAXES",
      ledgerType: "TAX_INPUT",
      gstRate: 9,
      tallyCompanyId: company.id,
    },
  });
  const purchase = await prisma.ledger.create({
    data: {
      userId: user.id,
      clientId: client.id,
      name: "E2E Purchase A/c",
      group: "PURCHASE_ACCOUNTS",
      ledgerType: "PURCHASE",
      tallyCompanyId: company.id,
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      userId: user.id,
      clientId: client.id,
      fileUrl: "e2e://none",
      status: "PROCESSED",
      invoiceNumber: "E2E-0001",
      date: VOUCHER_DATE,
      vendor: "E2E Party Ltd",
      totalAmount: 1180,
      subtotal: 1000,
      cgst: 90,
      sgst: 90,
      documentType: "PURCHASE",
    },
  });

  const voucher = await prisma.voucher.create({
    data: {
      userId: user.id,
      clientId: client.id,
      invoiceId: invoice.id,
      voucherType: "PURCHASE",
      status: "APPROVED",
      date: VOUCHER_DATE,
      narration: "E2E connector round trip",
      totalDebit: 1180,
      totalCredit: 1180,
      approvedAt: new Date(),
      lines: {
        create: [
          {
            ledgerId: purchase.id,
            ledgerNameSnapshot: purchase.name,
            role: "ITEM",
            debit: 1000,
            credit: 0,
            sortOrder: 0,
          },
          {
            ledgerId: cgst.id,
            ledgerNameSnapshot: cgst.name,
            role: "CGST",
            debit: 90,
            credit: 0,
            sortOrder: 1,
          },
          {
            ledgerId: sgst.id,
            ledgerNameSnapshot: sgst.name,
            role: "SGST",
            debit: 90,
            credit: 0,
            sortOrder: 2,
          },
          {
            ledgerId: party.id,
            ledgerNameSnapshot: party.name,
            role: "PARTY",
            debit: 0,
            credit: 1180,
            sortOrder: 3,
          },
        ],
      },
    },
  });

  const code = generatePairingCode();
  await prisma.pairingCode.create({
    data: {
      code,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // an hour, not ten minutes: a human is driving this
    },
  });

  console.log("workspace ready");
  console.log("  user      ", user.id);
  console.log("  client    ", client.id);
  console.log("  company   ", company.companyName);
  console.log("  voucher   ", voucher.id, `(remoteId ${remoteIdFor(voucher.id)})`);
  console.log("");
  console.log("  PAIRING CODE:", formatPairingCode(code));
  console.log("");
  console.log("  next:  connector.exe -pair", formatPairingCode(code), "-cloud http://localhost:3000");
}

async function enqueue() {
  const ws = await findWorkspace();
  if (!ws) throw new Error("run `seed` first");
  const company = await prisma.tallyCompany.findUniqueOrThrow({
    where: { clientId: ws.client.id },
  });

  const vouchers = await prisma.voucher.findMany({
    where: { clientId: ws.client.id, status: { in: ["APPROVED", "EXPORTED_DEMO"] } },
    select: { id: true },
  });
  if (!vouchers.length) throw new Error("no approved vouchers in the E2E workspace");
  const voucherIds = vouchers.map((v) => v.id);

  // Masters first. A voucher naming a ledger Tally has never heard of comes
  // back "Ledger 'X' does not exist!", and the batch around it partially
  // succeeds — so the ordering is the fix, not a retry.
  const masters = await buildMasterCreatePayload(prisma, {
    userId: ws.user.id,
    clientId: ws.client.id,
    companyName: company.companyName,
  });
  if (masters) {
    const j = await enqueueJob(prisma, {
      userId: ws.user.id,
      clientId: ws.client.id,
      tallyCompanyId: company.id,
      kind: "MASTER_CREATE",
      payload: { ...masters },
    });
    console.log(`queued MASTER_CREATE ${j.id} (${masters.ledgerIds.length} ledger(s))`);
  } else {
    console.log("no ledgers need creating");
  }

  const payload = await buildVoucherPushPayload(prisma, {
    userId: ws.user.id,
    clientId: ws.client.id,
    tallyCompanyId: company.id,
    companyName: company.companyName,
    voucherIds,
  });

  const job = await enqueueJob(prisma, {
    userId: ws.user.id,
    clientId: ws.client.id,
    tallyCompanyId: company.id,
    kind: "VOUCHER_PUSH",
    payload: { ...payload },
  });
  console.log(`queued VOUCHER_PUSH ${job.id} (${payload.vouchers.length} voucher(s))`);
}

async function check() {
  const ws = await findWorkspace();
  if (!ws) throw new Error("run `seed` first");

  const devices = await prisma.connectorDevice.findMany({ where: { userId: ws.user.id } });
  console.log("devices:");
  for (const d of devices) {
    console.log(
      `  ${d.deviceName}  token ${d.tokenPrefix}…  lastSeen ${d.lastSeenAt?.toISOString() ?? "never"}` +
        `  tally=${d.tallyReachable ?? "?"} ${d.tallyMessage ?? ""}`
    );
  }

  const jobs = await prisma.syncJob.findMany({
    where: { userId: ws.user.id },
    orderBy: { createdAt: "asc" },
  });
  console.log("jobs:");
  for (const j of jobs) {
    console.log(`  ${j.kind.padEnd(14)} ${j.state.padEnd(9)} attempts=${j.attempts} ${j.error ?? ""}`);
  }

  const syncs = await prisma.voucherSync.findMany({
    where: { tallyCompany: { clientId: ws.client.id } },
  });
  console.log("voucher syncs:");
  for (const s of syncs) {
    console.log(
      `  ${s.remoteId}  ${s.state.padEnd(8)} vchNo=${s.tallyVoucherNumber ?? "-"}  ${s.error ?? ""}`
    );
  }

  const vouchers = await prisma.voucher.findMany({ where: { clientId: ws.client.id } });
  console.log("voucher statuses:", vouchers.map((v) => v.status).join(", "));

  // The only claim that actually matters: is it in Tally?
  const probe = await fetch(`http://${gateway.host}:${gateway.port}`, {
    method: "POST",
    headers: { "Content-Type": "text/xml;charset=utf-8" },
    body:
      "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>" +
      "<TYPE>Collection</TYPE><ID>E2EVch</ID></HEADER><BODY><DESC><STATICVARIABLES>" +
      `<SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>` +
      '<SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20290331</SVTODATE>' +
      '</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="E2EVch" ISMODIFY="No">' +
      "<TYPE>Voucher</TYPE><NATIVEMETHOD>VoucherNumber</NATIVEMETHOD>" +
      "<NATIVEMETHOD>Narration</NATIVEMETHOD><NATIVEMETHOD>Amount</NATIVEMETHOD>" +
      "</COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>",
  }).then((r) => r.text());

  const narrations = [...probe.matchAll(/<NARRATION[^>]*>([^<]*)<\/NARRATION>/g)].map((m) => m[1]);
  const e2e = narrations.filter((n) => /E2E connector round trip/.test(n));
  console.log(`\nin Tally: ${e2e.length} voucher(s) narrated "E2E connector round trip"`);
  console.log(e2e.length ? "  ROUND TRIP CONFIRMED" : "  not found in Tally yet");
}

async function cleanupWorkspace(opts: { quiet?: boolean } = {}) {
  const ws = await findWorkspace();
  if (!ws) {
    if (!opts.quiet) console.log("no E2E workspace to remove");
    return;
  }
  // Order matters. Client cascades to its invoices, ledgers, vouchers, company
  // and jobs, but Invoice -> User is a plain reference with no cascade, so
  // deleting the user first trips Invoice_userId_fkey. Take the workspace out
  // from under the user, then the user.
  await prisma.client.deleteMany({ where: { userId: ws.user.id } });
  await prisma.connectorDevice.deleteMany({ where: { userId: ws.user.id } });
  await prisma.user.delete({ where: { id: ws.user.id } });
  if (!opts.quiet) console.log("workspace removed");
}

async function cleanup() {
  const ws = await findWorkspace();
  if (ws) {
    const vouchers = await prisma.voucher.findMany({ where: { clientId: ws.client.id } });
    if (vouchers.length) {
      const r = await pushToTally(
        buildTallyDeleteXml({
          companyName: COMPANY,
          vouchers: vouchers.map((v) => ({ id: v.id, voucherType: v.voucherType })),
        }),
        gateway
      );
      console.log(`removed ${r.deleted} of ${vouchers.length} voucher(s) from Tally`);
    }
  }
  await cleanupWorkspace();
}

const cmd = process.argv[2];
const commands: Record<string, () => Promise<void>> = { seed, enqueue, check, cleanup };
if (!commands[cmd]) {
  console.error(`usage: npx tsx scripts/e2e-tally.mts <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
await commands[cmd]();
await prisma.$disconnect();
