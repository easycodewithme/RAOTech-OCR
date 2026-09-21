import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/tally/connectorAuth";
import { applyJobResult, type JobResultBody } from "@/lib/tally/syncJobs";
import { recordAuditEvent, vouchersPhrase } from "@/lib/audit";

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

    /**
     * What Tally actually did, as opposed to what somebody asked for.
     *
     * The push route already records the intent at queue time. On its own that
     * trail answers "who tried", which is not the question a firm gets asked —
     * and a record that reads like proof while only describing an intention is
     * worse than no record. This is the other half: the counts Tally returned,
     * written when the connector reports back.
     *
     * Guarded on `applied`, because a replayed result is normal traffic here
     * (the connector retries, and the reaper can hand one job to two devices).
     * Without the guard the trail would gain a second, contradictory row for
     * the same job.
     *
     * The actor is the paired machine, passed explicitly — there is no Clerk
     * session on a connector callback, and naming the device is the honest
     * answer to "who reported this" anyway.
     */
    if (
      outcome.applied &&
      (job.kind === "VOUCHER_PUSH" || job.kind === "VOUCHER_DELETE") &&
      (outcome.posted || outcome.failed || outcome.unknown)
    ) {
      const deleting = job.kind === "VOUCHER_DELETE";
      const verb = deleting ? "removed" : "accepted";
      const parts = [
        outcome.posted ? `${verb} ${vouchersPhrase(outcome.posted)}` : null,
        outcome.failed ? `rejected ${outcome.failed}` : null,
        outcome.unknown ? `left ${outcome.unknown} unconfirmed` : null,
      ].filter(Boolean);

      await recordAuditEvent({
        userId: job.userId,
        clientId: job.clientId,
        actor: { name: device.deviceName ?? "Connector" },
        action: deleting ? "VOUCHERS_DELETED_FROM_TALLY" : "VOUCHERS_PUSHED",
        entityType: "VOUCHER",
        summary: `Tally ${parts.join(", ")}`,
        metadata: {
          outcome: outcome.state === "DONE" ? "posted" : "failed",
          jobId: job.id,
          jobKind: job.kind,
          posted: outcome.posted ?? 0,
          failed: outcome.failed ?? 0,
          unknown: outcome.unknown ?? 0,
          deviceId: device.id,
          deviceName: device.deviceName,
          tally: body.tally ?? null,
        },
      });
    }

    return NextResponse.json({ ok: true, state: outcome.state });
  } catch (error) {
    console.error("[CONNECTOR_JOB_RESULT]", error);
    return NextResponse.json({ error: "Failed to record job result" }, { status: 500 });
  }
}
