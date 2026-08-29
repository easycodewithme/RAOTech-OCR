import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { buildVoucherDeletePayload, enqueueJob } from "@/lib/tally/syncJobs";

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
      select: { voucherId: true },
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

    return NextResponse.json({ jobIds: [job.id], voucherIds });
  } catch (error) {
    console.error("[TALLY_DELETE]", error);
    return NextResponse.json({ error: "Failed to queue delete" }, { status: 500 });
  }
}
