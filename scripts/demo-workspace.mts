/**
 * Set up a Tally demo you can actually log in and look at.
 *
 * The E2E harness (`e2e-tally.mts`) creates its own throwaway User with a fake
 * Clerk id, which is right for automated tests and useless for a human — you
 * cannot sign in as it. This attaches a demo *workspace* to a real signed-in
 * account instead, so it shows up in the workspace switcher next to the real
 * ones and every screen behaves exactly as it will for a pilot firm.
 *
 * Real data is untouched: everything lives in its own Client, and `reset`
 * deletes that Client and nothing else.
 *
 *   npx tsx scripts/demo-workspace.mts setup you@example.com
 *   npx tsx scripts/demo-workspace.mts code            # a fresh pairing code
 *   npx tsx scripts/demo-workspace.mts reset
 */
import { PrismaClient, type LedgerGroup, type LedgerType } from "@prisma/client";
import { generatePairingCode, formatPairingCode } from "../src/lib/tally/connectorAuth";
import { buildTallyDeleteXml } from "../src/lib/tally/exportXml";
import { pushToTally, type TallyGateway } from "../src/lib/tally/connector";

const prisma = new PrismaClient();

const CLIENT_NAME = "Tally Demo (RAOTECH)";
const COMPANY = process.env.TALLY_COMPANY || "RAOTECH";
/** Books in RAOTECH begin 2026-04-01; anything on or after that posts. */
const DATE = new Date("2026-08-01T00:00:00");

async function findUser(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const all = await prisma.user.findMany({ select: { email: true } });
    throw new Error(
      `No user with email ${email}.\nKnown users:\n` +
        all.map((u) => "  " + u.email).join("\n")
    );
  }
  return user;
}

const gateway: TallyGateway = {
  host: process.env.TALLY_HOST || "localhost",
  port: Number(process.env.TALLY_PORT || 9000),
  timeoutMs: 30_000,
};

/**
 * Take this workspace's vouchers back out of Tally before dropping the rows.
 *
 * REMOTEID is the only identifier a Tally delete accepts, and ours is derived
 * from the voucher's UUID. Delete the workspace first and those UUIDs are gone
 * for good — the vouchers stay in Tally with no way to address them, short of
 * removing them by hand in the Day Book. Repeated reset/re-seed cycles during
 * development is exactly how a test company silently fills up with orphans.
 *
 * Failure here is reported, never fatal: Tally may simply not be running, and
 * that must not block tearing down the local rows.
 */
async function deleteFromTally(clientId: string, companyName: string) {
  const vouchers = await prisma.voucher.findMany({
    where: { clientId },
    select: { id: true, voucherType: true },
  });
  if (!vouchers.length) return;

  try {
    const r = await pushToTally(
      buildTallyDeleteXml({ companyName, vouchers }),
      gateway
    );
    console.log(`removed ${r.deleted} of ${vouchers.length} voucher(s) from ${companyName}`);
    if (r.deleted < vouchers.length) {
      console.log("  (the rest were never posted, which is the state we wanted anyway)");
    }
  } catch (err) {
    console.log(
      `could not reach Tally to clean up: ${err instanceof Error ? err.message : err}`
    );
    console.log("  vouchers already posted will be left behind — remove them via Day Book");
  }
}

async function dropDemoClient(userId: string) {
  const existing = await prisma.client.findFirst({
    where: { userId, name: CLIENT_NAME },
  });
  if (!existing) return false;

  const company = await prisma.tallyCompany.findUnique({
    where: { clientId: existing.id },
    select: { companyName: true },
  });
  if (company) await deleteFromTally(existing.id, company.companyName);

  // Teardown order is forced by the live database, which does not match
  // schema.prisma: the schema declares Voucher.invoice as onDelete: Cascade,
  // but the actual `Voucher_invoiceId_fkey` constraint in Postgres restricts.
  // That drift predates this work and was deliberately left out of the Tally
  // migration, so unwind by hand: vouchers, then invoices, then the client
  // (which cascades ledgers, company, jobs and syncs).
  await prisma.voucher.deleteMany({ where: { clientId: existing.id } });
  await prisma.invoice.deleteMany({ where: { clientId: existing.id } });
  await prisma.client.delete({ where: { id: existing.id } });
  return true;
}

async function setup(email: string) {
  const user = await findUser(email);
  if (await dropDemoClient(user.id)) console.log("removed the previous demo workspace");

  const client = await prisma.client.create({
    data: { userId: user.id, name: CLIENT_NAME, gstin: "29AABCT1332L1ZU" },
  });

  // Left UNSYNCED on purpose: the first thing to do in the UI is Sync Master,
  // and the push screens are gated until it has run. Pre-syncing here would
  // hide the gate that a real firm meets on day one.
  const company = await prisma.tallyCompany.create({
    data: {
      userId: user.id,
      clientId: client.id,
      companyName: COMPANY,
      booksFrom: new Date("2026-04-01T00:00:00"),
      status: "UNSYNCED",
    },
  });

  const mk = (
    name: string,
    group: LedgerGroup,
    ledgerType: LedgerType,
    extra: Record<string, unknown> = {}
  ) =>
    prisma.ledger.create({
      data: {
        userId: user.id,
        clientId: client.id,
        name,
        group,
        ledgerType,
        tallyCompanyId: company.id,
        ...extra,
      },
    });

  const party = await mk("Demo Traders Pvt Ltd", "SUNDRY_CREDITORS", "PARTY");
  const purchase = await mk("Demo Purchase A/c", "PURCHASE_ACCOUNTS", "PURCHASE", {
    gstRate: 18,
  });
  const cgst = await mk("Demo CGST", "DUTIES_AND_TAXES", "TAX_INPUT", { gstRate: 9 });
  const sgst = await mk("Demo SGST", "DUTIES_AND_TAXES", "TAX_INPUT", { gstRate: 9 });

  /**
   * Deliberately broken, so the demo shows a red row and not just happy paths.
   *
   * It carries a GUID that does not exist in Tally. MASTER_CREATE only creates
   * ledgers whose `tallyGuid` is null, so this one is skipped as "already in
   * Tally" and the voucher referencing it comes back
   * `Ledger 'Ghost Supplier Ltd' does not exist!` — the single most common real
   * push failure, reproduced honestly rather than faked.
   */
  const ghost = await mk("Ghost Supplier Ltd", "SUNDRY_CREDITORS", "PARTY", {
    tallyGuid: "00000000-0000-0000-0000-000000000000-deadbeef",
    tallyName: "Ghost Supplier Ltd",
  });

  const bills = [
    { no: "DEMO-1001", party, total: 11800, base: 10000, tax: 900, ok: true },
    { no: "DEMO-1002", party, total: 5900, base: 5000, tax: 450, ok: true },
    { no: "DEMO-1003", party: ghost, total: 2360, base: 2000, tax: 180, ok: false },
  ];

  for (const b of bills) {
    const invoice = await prisma.invoice.create({
      data: {
        userId: user.id,
        clientId: client.id,
        fileUrl: "demo://seeded",
        status: "PROCESSED",
        invoiceNumber: b.no,
        date: DATE,
        vendor: b.party.name,
        totalAmount: b.total,
        subtotal: b.base,
        cgst: b.tax,
        sgst: b.tax,
        documentType: "PURCHASE",
      },
    });

    await prisma.voucher.create({
      data: {
        userId: user.id,
        clientId: client.id,
        invoiceId: invoice.id,
        voucherType: "PURCHASE",
        status: "APPROVED",
        date: DATE,
        narration: `Demo bill ${b.no} from ${b.party.name}`,
        totalDebit: b.total,
        totalCredit: b.total,
        approvedAt: new Date(),
        avgConfidence: 0.94,
        lines: {
          create: [
            {
              ledgerId: purchase.id,
              ledgerNameSnapshot: purchase.name,
              role: "ITEM",
              debit: b.base,
              credit: 0,
              sortOrder: 0,
              gstRate: 18,
            },
            {
              ledgerId: cgst.id,
              ledgerNameSnapshot: cgst.name,
              role: "CGST",
              debit: b.tax,
              credit: 0,
              sortOrder: 1,
            },
            {
              ledgerId: sgst.id,
              ledgerNameSnapshot: sgst.name,
              role: "SGST",
              debit: b.tax,
              credit: 0,
              sortOrder: 2,
            },
            {
              ledgerId: b.party.id,
              ledgerNameSnapshot: b.party.name,
              role: "PARTY",
              debit: 0,
              credit: b.total,
              sortOrder: 3,
            },
          ],
        },
      },
    });
  }

  // Land on the demo workspace at sign-in rather than making you hunt for it.
  await prisma.user.update({
    where: { id: user.id },
    data: { activeClientId: client.id },
  });

  const code = await newCode(user.id);

  console.log(`\ndemo workspace ready for ${email}`);
  console.log(`  workspace   ${CLIENT_NAME}`);
  console.log(`  company     ${COMPANY} (status UNSYNCED — Sync Master is step 1)`);
  console.log(`  ledgers     5 (one is a deliberate failure case)`);
  console.log(`  vouchers    3 APPROVED — 2 will post, 1 will fail visibly`);
  console.log(`\n  PAIRING CODE: ${formatPairingCode(code)}`);
}

async function newCode(userId: string) {
  const code = generatePairingCode();
  await prisma.pairingCode.create({
    data: { code, userId, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) },
  });
  return code;
}

async function code(email: string) {
  const user = await findUser(email);
  console.log("PAIRING CODE:", formatPairingCode(await newCode(user.id)));
}

async function reset(email: string) {
  const user = await findUser(email);
  const removed = await dropDemoClient(user.id);
  await prisma.connectorDevice.deleteMany({ where: { userId: user.id } });
  await prisma.pairingCode.deleteMany({ where: { userId: user.id } });
  console.log(removed ? "demo workspace removed" : "no demo workspace found");
}

const [cmd, email] = process.argv.slice(2);
const commands: Record<string, (e: string) => Promise<void>> = { setup, code, reset };
if (!commands[cmd] || !email) {
  console.error("usage: demo-workspace.mts <setup|code|reset> <your-login-email>");
  process.exit(1);
}
await commands[cmd](email);
await prisma.$disconnect();
