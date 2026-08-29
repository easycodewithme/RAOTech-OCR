import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import {
  buildMasterCreatePayload,
  buildVoucherPushPayload,
  enqueueJob,
  hasBlockingPushIssues,
  preflightForPush,
} from "@/lib/tally/syncJobs";

/**
 * POST /api/tally/push
 * Body: { voucherIds?: string[] } — omitted means every approved voucher.
 *
 * Order matters and is not negotiable: MASTER_CREATE before VOUCHER_PUSH,
 * because a voucher naming a ledger Tally has never heard of is rejected with
 * `Ledger 'X' does not exist!` and the batch around it partially succeeds. Both
 * go on the same FIFO queue, so the connector drains them in that order.
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

    const masters = await buildMasterCreatePayload(prisma, {
      userId: user.id,
      clientId: client.id,
      companyName: company.companyName,
      ledgerIds,
    });

    if (masters) {
      const job = await enqueueJob(prisma, {
        userId: user.id,
        clientId: client.id,
        tallyCompanyId: company.id,
        kind: "MASTER_CREATE",
        payload: { ...masters },
      });
      jobIds.push(job.id);
    }

    const payload = await buildVoucherPushPayload(prisma, {
      userId: user.id,
      clientId: client.id,
      tallyCompanyId: company.id,
      companyName: company.companyName,
      voucherIds,
    });

    const pushJob = await enqueueJob(prisma, {
      userId: user.id,
      clientId: client.id,
      tallyCompanyId: company.id,
      kind: "VOUCHER_PUSH",
      payload: { ...payload },
    });
    jobIds.push(pushJob.id);

    return NextResponse.json({
      jobIds,
      voucherIds,
      warnings: issues.filter((i) => i.severity === "warning"),
    });
  } catch (error) {
    console.error("[TALLY_PUSH]", error);
    return NextResponse.json({ error: "Failed to queue push" }, { status: 500 });
  }
}
