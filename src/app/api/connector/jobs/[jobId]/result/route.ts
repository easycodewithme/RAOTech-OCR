import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/tally/connectorAuth";
import { applyJobResult, type JobResultBody } from "@/lib/tally/syncJobs";

export const dynamic = "force-dynamic";

/**
 * POST /api/connector/jobs/{jobId}/result
 *
 * Idempotent by contract. The connector retries a result it could not deliver,
 * and the 5-minute claim reaper can legitimately hand one job to two devices, so
 * a duplicate report is normal traffic rather than abuse. A job already DONE or
 * FAILED answers 200 and changes nothing — the guarded transition inside
 * `applyJobResult` is what enforces that, so a replay cannot walk a voucher
 * backwards out of POSTED.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const device = await authenticateDevice(prisma, req);
    if (!device) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await params;

    // Scoped to the device's own user: a token from one account must not be
    // able to report an outcome for another account's job.
    const job = await prisma.syncJob.findFirst({
      where: { id: jobId, userId: device.userId },
      select: {
        id: true,
        userId: true,
        clientId: true,
        tallyCompanyId: true,
        deviceId: true,
        kind: true,
        payload: true,
        state: true,
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => ({}))) as JobResultBody;

    // The reaper may have requeued this job and another device may have taken
    // it; attribute the outcome to whoever is actually reporting it.
    const outcome = await applyJobResult(
      prisma,
      { ...job, deviceId: job.deviceId ?? device.id },
      body
    );

    return NextResponse.json({ ok: true, state: outcome.state });
  } catch (error) {
    console.error("[CONNECTOR_JOB_RESULT]", error);
    return NextResponse.json({ error: "Failed to record job result" }, { status: 500 });
  }
}
