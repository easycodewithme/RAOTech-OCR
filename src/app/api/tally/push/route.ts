import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { recordAuditEvent, vouchersPhrase } from "@/lib/audit";
import {
  VOUCHERS_PER_JOB,
  buildMasterCreatePayload,
  buildVoucherPushPayload,
  chunk,
  enqueueJob,
  hasBlockingPushIssues,
  preflightForPush,
} from "@/lib/tally/syncJobs";

/**
 * A stock item id that exists in no workspace. See its use below: it is how
 * this route says "this batch needs no stock masters" to a builder whose only
 * vocabulary for that is an id filter.
 */
const NO_STOCK_ITEMS = "__no_stock_items__";

/**
 * Building the payload is the slow part of this route: one query for the
 * vouchers plus a small fixed number of writes per chunk, each a round trip to
 * a pooler measured at ~160-290ms. Capped at `VOUCHERS_PER_JOB` a chunk, the
 * largest realistic push is a few dozen round trips, so the ceiling is set well
 * above the expected cost rather than at it — a push that has already written
 * some of its sync rows and then times out is the state this whole route is
 * being fixed to avoid.
 */
export const maxDuration = 60;

/**
 * POST /api/tally/push
 * Body: { voucherIds?: string[] } — omitted means every approved voucher.
 *
 * Order matters and is not negotiable: MASTER_CREATE before VOUCHER_PUSH,
 * because a voucher naming a ledger Tally has never heard of is rejected with
 * `Ledger 'X' does not exist!` and the batch around it partially succeeds. Both
 * go on the same FIFO queue, so the connector drains them in that order.
 *
 * Ordering is not the same thing as a dependency, and the difference is a real
 * failure we have seen: if MASTER_CREATE *fails*, nothing cancels the push
 * behind it. The connector simply claims the next queued job and posts every
 * voucher against ledgers and stock items that were never created, so the whole
 * batch comes back `Ledger 'X' does not exist!` / `Stock Item 'X' does not
 * exist!` — a wall of per-voucher failures whose single cause is one job
 * earlier in the queue that nobody is looking at.
 *
 * What this route does about that is stamp the push with the id of the master
 * job it depends on (`payload.dependsOnJobId`, below); the claim query in
 * `src/app/api/connector/jobs/route.ts` enforces it by refusing to hand out a
 * job whose dependency has not reached DONE.
 *
 * A push is not necessarily one job. Above `VOUCHERS_PER_JOB` vouchers it is
 * split into several, each carrying the same master dependency — see the loop
 * below for why a single job could not be built at all at month-end volume.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
    });

    // The deliberate hard gate. Without a master pull we have no GUIDs, no book
    // period to date-check against, and no evidence the company name we hold
    // matches anything Tally will open — so a push would be a guess with real
    // consequences in someone's books.
    if (!company || company.status === "UNSYNCED") {
      return NextResponse.json(
        {
          error:
            "Sync masters from Tally before posting. Until the ledgers have been read back, nothing here can be matched to a ledger in Tally.",
          status: company?.status ?? null,
        },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body.voucherIds)
      ? body.voucherIds.map(String)
      : undefined;

    const vouchers = await prisma.voucher.findMany({
      where: {
        userId: user.id,
        clientId: client.id,
        status: { in: ["APPROVED", "EXPORTED_DEMO"] },
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        invoice: { select: { invoiceNumber: true } },
      },
      orderBy: { date: "asc" },
    });

    if (!vouchers.length) {
      return NextResponse.json({ error: "No approved vouchers to post" }, { status: 404 });
    }

    // Only the lower bound is enforced, and only from booksFrom — Tally applies
    // no upper bound at all, and its reported EndingAt is not the end of the
    // postable range. See `preflightForPush`.
    const issues = preflightForPush(
      vouchers.map((v) => ({
        id: v.id,
        date: v.date,
        invoiceNumber: v.invoice?.invoiceNumber,
        lines: v.lines.map((l) => ({
          ledgerName: l.ledgerNameSnapshot,
          debit: l.debit,
          credit: l.credit,
        })),
      })),
      { booksFrom: company.booksFrom ?? company.fyStart }
    );

    if (hasBlockingPushIssues(issues)) {
      return NextResponse.json(
        {
          error: "Some vouchers would be rejected by Tally",
          issues: issues.filter((i) => i.severity === "error"),
          warnings: issues.filter((i) => i.severity === "warning"),
        },
        { status: 422 }
      );
    }

    const jobIds: string[] = [];
    const voucherIds = vouchers.map((v) => v.id);

    const ledgerIds = [
      ...new Set(
        vouchers.flatMap((v) => v.lines.map((l) => l.ledgerId).filter(Boolean) as string[])
      ),
    ];

    // The same collection, for the same reason, for the other master type.
    // `buildMasterCreatePayload` applies its stock filter only when it is given
    // ids; without them it selects *every* item in the workspace with
    // `tallySyncedAt: null` and puts them all in the envelope. Masters are
    // batched (they are addressed by name, so Tally's aggregate reply is enough
    // for them), which means one item Tally refuses — a missing base unit, a
    // name it will not take — fails the envelope for all of them, and fails it
    // again on every retry, for a batch of vouchers that need none of them.
    const stockItemIds = [
      ...new Set(
        vouchers.flatMap((v) => v.lines.map((l) => l.stockItemId).filter(Boolean) as string[])
      ),
    ];

    const masters = await buildMasterCreatePayload(prisma, {
      userId: user.id,
      clientId: client.id,
      companyName: company.companyName,
      ledgerIds,
      // An *empty* array would not do: `buildMasterCreatePayload` tests
      // `stockItemIds?.length`, so `[]` reads as "not given" and falls straight
      // back to the whole workspace — the same sweep, for the batch that needs
      // it least. A trader's journal or expense batch references no items and
      // must therefore create none, so an id that cannot match says that. The
      // tidier fix is `!== undefined` in `syncJobs.ts`, which this route does
      // not own; the ids are TEXT, so a sentinel is safe against the column.
      stockItemIds: stockItemIds.length ? stockItemIds : [NO_STOCK_ITEMS],
    });

    let masterJobId: string | null = null;
    if (masters) {
      const job = await enqueueJob(prisma, {
        userId: user.id,
        clientId: client.id,
        tallyCompanyId: company.id,
        kind: "MASTER_CREATE",
        payload: { ...masters },
      });
      masterJobId = job.id;
      jobIds.push(job.id);
    }

    /**
     * One job per `VOUCHERS_PER_JOB` vouchers, not one job for the lot.
     *
     * Omitting `voucherIds` from the body means "every approved voucher", which
     * at month-end for a real firm is several hundred. All of them used to go
     * into a single job: one payload holding one full XML envelope per voucher,
     * built inside this request and then handed back whole in one response by
     * `GET /api/connector/jobs`. Past a few hundred vouchers the request
     * exceeded the serverless limit while building it, so the push failed
     * before anything was queued — and the bigger the backlog, the more
     * certainly it failed, which is precisely backwards.
     *
     * Splitting is safe because the vouchers are independent: the connector
     * takes one job at a time and each envelope is imported and reported on its
     * own. The chunks are contiguous slices of the date-ordered list, so a
     * half-drained queue is "everything up to 12 August is in", not a random
     * scatter. See `VOUCHERS_PER_JOB` for how the size was chosen.
     */
    const batches = chunk(voucherIds, VOUCHERS_PER_JOB);
    const voucherPushJobIds: string[] = [];

    for (const batch of batches) {
      const payload = await buildVoucherPushPayload(prisma, {
        userId: user.id,
        clientId: client.id,
        tallyCompanyId: company.id,
        companyName: company.companyName,
        voucherIds: batch,
      });

      const pushJob = await enqueueJob(prisma, {
        userId: user.id,
        clientId: client.id,
        tallyCompanyId: company.id,
        kind: "VOUCHER_PUSH",
        // `dependsOnJobId` is the half of REL-07 that lives here: the push
        // records *which* master job has to have succeeded before it means
        // anything. It goes in the payload rather than in a column deliberately —
        // `payload` is already Json, so this needs no migration, and migrations
        // in this repo are hand-written against a database shared with an
        // unrelated project.
        //
        // Every chunk carries it, not just the first. The claim query in
        // `src/app/api/connector/jobs/route.ts` now enforces the key by
        // refusing to hand out a job whose dependency is not DONE, and it
        // enforces it per job — so a chunk without the key would be claimed
        // whatever the master create did, and its every voucher would come back
        // `Ledger 'X' does not exist!`. The chunks do not depend on each other:
        // they are independent batches of independent vouchers, and one failing
        // must not strand the rest.
        payload: { ...payload, ...(masterJobId ? { dependsOnJobId: masterJobId } : {}) },
      });
      jobIds.push(pushJob.id);
      voucherPushJobIds.push(pushJob.id);
    }

    /**
     * Who sent this to a client's live books.
     *
     * Recorded at *queue* time, and the metadata says `outcome: "queued"` for
     * exactly that reason: nothing here proves Tally accepted anything, and a
     * trail that reads as proof when it is only intent is worse than no trail.
     * Closing the loop belongs where the connector reports back.
     *
     * The master create is a separate event because it fails separately — when
     * it does, the push behind it returns N identical `Ledger 'X' does not
     * exist!` failures whose single cause is one job earlier in the queue.
     */
    if (masterJobId) {
      await recordAuditEvent({
        userId: user.id,
        clientId: client.id,
        action: "MASTERS_CREATED",
        entityType: "TALLY_COMPANY",
        entityId: company.id,
        summary: `Queued creation of ${ledgerIds.length} ledger${
          ledgerIds.length === 1 ? "" : "s"
        } and ${stockItemIds.length} stock item${
          stockItemIds.length === 1 ? "" : "s"
        } in Tally (${company.companyName}) for ${client.name}`,
        metadata: {
          outcome: "queued",
          jobId: masterJobId,
          ledgerIds,
          stockItemIds,
          tallyCompanyId: company.id,
          tallyCompanyName: company.companyName,
        },
      });
    }

    await recordAuditEvent({
      userId: user.id,
      clientId: client.id,
      action: "VOUCHERS_PUSHED",
      entityType: "VOUCHER",
      entityId: voucherIds.length === 1 ? voucherIds[0] : null,
      summary: `Queued push of ${vouchersPhrase(voucherIds.length)} to Tally (${
        company.companyName
      }) for ${client.name}`,
      metadata: {
        outcome: "queued",
        voucherCount: voucherIds.length,
        voucherIds,
        jobIds,
        masterJobId,
        // Every chunk, not just the first: a 237-voucher push is three jobs,
        // and reading the trail later means knowing all of them.
        voucherPushJobIds,
        tallyCompanyId: company.id,
        tallyCompanyName: company.companyName,
        warnings: issues.filter((i) => i.severity === "warning"),
      },
    });

    return NextResponse.json({
      jobIds,
      // Named separately so a caller can report "the masters failed" rather
      // than N identical `does not exist!` voucher failures.
      masterJobId,
      voucherPushJobIds,
      // Kept for callers written when a push was always exactly one job. It is
      // the first chunk, which is no longer the whole push — `jobIds` and
      // `voucherPushJobIds` are.
      voucherPushJobId: voucherPushJobIds[0] ?? null,
      voucherIds,
      warnings: issues.filter((i) => i.severity === "warning"),
    });
  } catch (error) {
    console.error("[TALLY_PUSH]", error);
    return NextResponse.json({ error: "Failed to queue push" }, { status: 500 });
  }
}