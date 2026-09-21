import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { buildVoucherDeletePayload, enqueueJob } from "@/lib/tally/syncJobs";
import { requireDemoAccess } from "@/lib/demoAccess";
import { recordAuditEvent, vouchersPhrase } from "@/lib/audit";

/**
 * POST /api/tally/delete
 * Body: { voucherIds: string[] }
 *
 * Only vouchers with a POSTED sync row are eligible: a voucher that never
 * reached Tally has no REMOTEID there to resolve, and asking Tally to delete one
 * answers `errors=1, "Voucher does not exist!"` — harmless, but it would show
 * the user a failure for work they never did.
 */
export async function POST(req: Request) {
  try {
    const access = await requireDemoAccess();
    if (access.response) return access.response;
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
    });
    if (!company) {
      return NextResponse.json(
        { error: "No Tally company is registered for this workspace." },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.voucherIds)
      ? body.voucherIds.map(String)
      : [];
    if (!ids.length) {
      return NextResponse.json({ error: "voucherIds is required" }, { status: 400 });
    }

    const syncs = await prisma.voucherSync.findMany({
      where: {
        voucherId: { in: ids },
        tallyCompanyId: company.id,
        state: "POSTED",
        voucher: { userId: user.id, clientId: client.id },
      },
      // `remoteId` comes along for the audit row below. It is the only handle
      // Tally accepts for an existing entry and it exists nowhere but this
      // database — once this delete succeeds and the sync row moves to DELETED,
      // the audit event is the last place the id is written down.
      select: { voucherId: true, remoteId: true },
    });

    if (!syncs.length) {
      return NextResponse.json(
        { error: "None of those vouchers are posted in Tally." },
        { status: 404 }
      );
    }

    const voucherIds = syncs.map((s) => s.voucherId);

    const payload = await buildVoucherDeletePayload(prisma, {
      userId: user.id,
      clientId: client.id,
      tallyCompanyId: company.id,
      companyName: company.companyName,
      voucherIds,
    });

    const job = await enqueueJob(prisma, {
      userId: user.id,
      clientId: client.id,
      tallyCompanyId: company.id,
      kind: "VOUCHER_DELETE",
      payload: { ...payload },
    });

    // SENDING, not QUEUED: the row is already POSTED, and moving it back to
    // QUEUED would read as "waiting to post" in the very UI that just asked for
    // the opposite.
    await prisma.voucherSync.updateMany({
      where: { voucherId: { in: voucherIds }, tallyCompanyId: company.id },
      data: { state: "SENDING", jobId: job.id, lastAttemptAt: new Date() },
    });

    // Deletions were recorded nowhere at all before this. Of everything the app
    // does, removing entries from a client's live books is the one action a firm
    // most needs to be able to name a person for — and it is recorded here at
    // the point the job is *queued*, not when it completes, because the record
    // has to survive the connector never reporting back. The metadata says
    // `queued`, so nobody reads it as proof the entries are gone.
    await recordAuditEvent({
      userId: user.id,
      clientId: client.id,
      action: "VOUCHERS_DELETED_FROM_TALLY",
      entityType: "VOUCHER",
      entityId: voucherIds.length === 1 ? voucherIds[0] : null,
      summary: `Queued deletion of ${vouchersPhrase(voucherIds.length)} from Tally (${
        company.companyName
      }) for ${client.name}`,
      metadata: {
        outcome: "queued",
        jobId: job.id,
        voucherCount: voucherIds.length,
        voucherIds,
        requestedIds: ids,
        tallyCompanyId: company.id,
        tallyCompanyName: company.companyName,
        remoteIds: syncs.map((s) => s.remoteId),
      },
    });

    return NextResponse.json({ jobIds: [job.id], voucherIds });
  } catch (error) {
    console.error("[TALLY_DELETE]", error);
    return NextResponse.json({ error: "Failed to queue delete" }, { status: 500 });
  }
}
