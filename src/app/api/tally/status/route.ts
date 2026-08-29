import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * GET /api/tally/status?voucherIds=a,b,c&jobId=…
 *
 * What the UI polls while a push is in flight. Returns the per-voucher sync
 * rows — grey QUEUED, orange SENDING, green POSTED, red FAILED with Tally's own
 * words — plus the job those rows belong to, so a spinner can be stopped by the
 * job reaching a terminal state even when every voucher in it failed.
 *
 * `voucherIds` may be omitted, in which case the most recent job for the
 * workspace is reported on its own; that is what "Test Connection" polls.
 */
export async function GET(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const url = new URL(req.url);
    const ids = (url.searchParams.get("voucherIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const jobId = url.searchParams.get("jobId")?.trim() || null;

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
      select: { id: true, status: true, companyName: true, lastSyncedAt: true, ledgerCount: true },
    });

    const [syncs, job] = await Promise.all([
      ids.length && company
        ? prisma.voucherSync.findMany({
            where: {
              voucherId: { in: ids },
              tallyCompanyId: company.id,
              voucher: { userId: user.id, clientId: client.id },
            },
            select: {
              voucherId: true,
              state: true,
              error: true,
              tallyVoucherNumber: true,
              syncedAt: true,
              lastAttemptAt: true,
            },
          })
        : Promise.resolve([]),
      jobId
        ? prisma.syncJob.findFirst({
            where: { id: jobId, userId: user.id, clientId: client.id },
            select: {
              id: true,
              kind: true,
              state: true,
              error: true,
              attempts: true,
              createdAt: true,
              finishedAt: true,
            },
          })
        : prisma.syncJob.findFirst({
            where: { userId: user.id, clientId: client.id },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              kind: true,
              state: true,
              error: true,
              attempts: true,
              createdAt: true,
              finishedAt: true,
            },
          }),
    ]);

    return NextResponse.json({ syncs, job, company });
  } catch (error) {
    console.error("[TALLY_STATUS]", error);
    return NextResponse.json({ error: "Failed to load sync status" }, { status: 500 });
  }
}
