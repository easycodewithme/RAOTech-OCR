import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/tally/connectorAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Protocol bound. Longer holds a serverless invocation open for nothing. */
const MAX_WAIT_SEC = 25;
/** How often the long poll looks again. Tally-side latency dwarfs this. */
const POLL_INTERVAL_MS = 1000;
/**
 * A job left CLAIMED this long is assumed orphaned — the connector was killed,
 * the machine slept, or Windows Update happened mid-push. Re-posting is safe
 * because REMOTEID makes Tally alter rather than duplicate, which is what lets
 * the reaper exist at all.
 */
const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

interface ClaimedJobRow {
  id: string;
  kind: string;
  payload: Prisma.JsonValue;
  attempts: number;
  clientId: string;
  tallyCompanyId: string | null;
}

/**
 * Claim the oldest queued job for this user, atomically.
 *
 * The row moves QUEUED → CLAIMED inside the same statement that selects it.
 * `FOR UPDATE SKIP LOCKED` is what makes two connectors on one account safe:
 * the second one steps over the row the first is taking instead of blocking on
 * it or, worse, reading it as still queued. A read-then-update pair here would
 * hand the same voucher batch to both machines.
 */
async function claimJob(userId: string, deviceId: string) {
  const rows = await prisma.$queryRaw<ClaimedJobRow[]>(Prisma.sql`
    UPDATE "SyncJob" AS j
       SET state = 'CLAIMED'::"SyncJobState",
           "deviceId" = ${deviceId},
           "claimedAt" = (now() at time zone 'utc'),
           attempts = j.attempts + 1
     WHERE j.id = (
       SELECT s.id
         FROM "SyncJob" s
        WHERE s."userId" = ${userId}
          AND s.state = 'QUEUED'::"SyncJobState"
        ORDER BY s."createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
     )
    RETURNING j.id,
              j.kind::text AS kind,
              j.payload,
              j.attempts,
              j."clientId",
              j."tallyCompanyId"
  `);
  return rows[0] ?? null;
}

async function requeueStuckJobs(userId: string) {
  await prisma.syncJob.updateMany({
    where: {
      userId,
      state: "CLAIMED",
      claimedAt: { lt: new Date(Date.now() - CLAIM_TIMEOUT_MS) },
    },
    data: { state: "QUEUED", deviceId: null, claimedAt: null },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/connector/jobs?wait=25
 *
 * Returns at most one job, which keeps ordering strict and the desktop runner
 * trivial — it never has to decide what to do first. `{ job: null }` after the
 * wait elapses is the normal, expected answer.
 */
export async function GET(req: Request) {
  try {
    const device = await authenticateDevice(prisma, req);
    if (!device) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const requested = Number(url.searchParams.get("wait") ?? MAX_WAIT_SEC);
    const waitSec = Number.isFinite(requested)
      ? Math.min(MAX_WAIT_SEC, Math.max(0, Math.floor(requested)))
      : MAX_WAIT_SEC;

    // Polling is presence: a connector that is asking for work is online, even
    // if its heartbeat is in the gap between two 30s ticks.
    await prisma.connectorDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date() },
    });

    // Once per poll, not once per second — this is a scan, and a job stranded
    // by a killed connector can wait one more long-poll cycle.
    await requeueStuckJobs(device.userId);

    const deadline = Date.now() + waitSec * 1000;

    for (;;) {
      const job = await claimJob(device.userId, device.id);
      if (job) {
        const payload = (job.payload ?? {}) as {
          companyName?: string;
          vouchers?: { voucherId: string }[];
        };

        // Grey → orange the moment a device takes the work, so the UI can tell
        // "nobody has picked this up" from "a machine is talking to Tally right
        // now" — which are the two things a user waiting on a push wants
        // distinguished.
        if (payload.vouchers?.length && job.tallyCompanyId) {
          await prisma.voucherSync.updateMany({
            where: {
              voucherId: { in: payload.vouchers.map((v) => v.voucherId) },
              tallyCompanyId: job.tallyCompanyId,
              state: { in: ["QUEUED", "SENDING"] },
            },
            data: { state: "SENDING", jobId: job.id, lastAttemptAt: new Date() },
          });
        }

        return NextResponse.json({
          job: {
            id: job.id,
            kind: job.kind,
            companyName: payload.companyName ?? null,
            attempt: job.attempts,
            payload: job.payload,
          },
        });
      }

      // The connector hung up, or the platform is about to time the invocation
      // out. Either way there is nothing to hand back.
      if (req.signal.aborted || Date.now() >= deadline) break;

      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }

    return NextResponse.json({ job: null });
  } catch (error) {
    console.error("[CONNECTOR_JOBS]", error);
    return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
  }
}
