import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { enqueueJob } from "@/lib/tally/syncJobs";

/**
 * POST /api/tally/sync-master
 *
 * The gate everything else sits behind. Until Tally's ledgers have been read
 * into the workspace we hold no GUIDs, and posting against names alone is the
 * failure this whole integration exists to avoid — so nothing transactional is
 * permitted before this has succeeded once.
 *
 * SYNCING is set here rather than when the connector claims the job, so the UI
 * shows the pull as in-flight even while it is still sitting in the queue
 * waiting for a device to wake up.
 */
export async function POST() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
    });
    if (!company) {
      return NextResponse.json(
        { error: "Register a Tally company for this workspace first." },
        { status: 409 }
      );
    }

    const job = await enqueueJob(prisma, {
      userId: user.id,
      clientId: client.id,
      tallyCompanyId: company.id,
      kind: "MASTER_PULL",
      payload: { companyName: company.companyName },
    });

    await prisma.tallyCompany.update({
      where: { id: company.id },
      data: { status: "SYNCING" },
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("[TALLY_SYNC_MASTER]", error);
    return NextResponse.json({ error: "Failed to queue master sync" }, { status: 500 });
  }
}
