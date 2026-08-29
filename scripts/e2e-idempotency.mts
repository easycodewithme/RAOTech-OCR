/**
 * The safety property the whole design rests on.
 *
 * Re-posting a voucher must ALTER the one already in Tally, never add a second.
 * Without it every retry, every claim-timeout replay and every "push again after
 * fixing a ledger" would silently double a firm's books — and the connector
 * retries by design, so this is not a rare path.
 *
 * Drives the real connector through the real cloud, and counts what Tally
 * actually holds rather than trusting our own status field.
 */
import { PrismaClient } from "@prisma/client";
import {
  buildVoucherPushPayload,
  buildVoucherDeletePayload,
  enqueueJob,
} from "../src/lib/tally/syncJobs";

const prisma = new PrismaClient();
const COMPANY = "RAOTECH";
const NARRATION = "E2E connector round trip";

async function countInTally(): Promise<number> {
  const xml = await fetch("http://localhost:9000", {
    method: "POST",
    headers: { "Content-Type": "text/xml;charset=utf-8" },
    body:
      "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>" +
      "<TYPE>Collection</TYPE><ID>IdemVch</ID></HEADER><BODY><DESC><STATICVARIABLES>" +
      `<SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>` +
      '<SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20290331</SVTODATE>' +
      '</STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="IdemVch" ISMODIFY="No">' +
      "<TYPE>Voucher</TYPE><NATIVEMETHOD>Narration</NATIVEMETHOD>" +
      "</COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>",
  }).then((r) => r.text());
  return [...xml.matchAll(/<NARRATION[^>]*>([^<]*)<\/NARRATION>/g)].filter((m) =>
    m[1].includes(NARRATION)
  ).length;
}

/** Wait for the connector to drain, rather than guessing at a sleep duration. */
async function waitForQueue(userId: string, label: string) {
  for (let i = 0; i < 60; i++) {
    const pending = await prisma.syncJob.count({
      where: { userId, state: { in: ["QUEUED", "CLAIMED"] } },
    });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label}: connector did not drain the queue in 60s`);
}

const user = await prisma.user.findUniqueOrThrow({
  where: { email: "e2e-tally@raotech.local" },
});
const company = await prisma.tallyCompany.findFirstOrThrow({ where: { userId: user.id } });
const vouchers = await prisma.voucher.findMany({ where: { clientId: company.clientId } });
const voucherIds = vouchers.map((v) => v.id);

const before = await countInTally();
console.log(`in Tally before re-push: ${before}`);

const push = await buildVoucherPushPayload(prisma, {
  userId: user.id,
  clientId: company.clientId,
  tallyCompanyId: company.id,
  companyName: company.companyName,
  voucherIds,
});
await enqueueJob(prisma, {
  userId: user.id,
  clientId: company.clientId,
  tallyCompanyId: company.id,
  kind: "VOUCHER_PUSH",
  payload: { ...push },
});
console.log("re-push queued; waiting for the connector…");
await waitForQueue(user.id, "re-push");

const after = await countInTally();
console.log(`in Tally after re-push:  ${after}`);
console.log(
  after === before
    ? "  IDEMPOTENT — Tally altered the existing voucher"
    : `  DUPLICATED — count moved ${before} -> ${after}`
);

// Now prove the other direction: what we posted, we can take back.
const del = await buildVoucherDeletePayload(prisma, {
  userId: user.id,
  clientId: company.clientId,
  tallyCompanyId: company.id,
  companyName: company.companyName,
  voucherIds,
});
await enqueueJob(prisma, {
  userId: user.id,
  clientId: company.clientId,
  tallyCompanyId: company.id,
  kind: "VOUCHER_DELETE",
  payload: { ...del },
});
console.log("\ndelete queued; waiting…");
await waitForQueue(user.id, "delete");

const afterDelete = await countInTally();
console.log(`in Tally after delete:   ${afterDelete}`);
console.log(afterDelete === 0 ? "  DELETE CONFIRMED" : "  DELETE FAILED");

const syncs = await prisma.voucherSync.findMany({ where: { tallyCompanyId: company.id } });
console.log("\nsync states:", syncs.map((s) => s.state).join(", "));
const finalVouchers = await prisma.voucher.findMany({ where: { clientId: company.clientId } });
console.log("voucher statuses:", finalVouchers.map((v) => v.status).join(", "));

await prisma.$disconnect();
