import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BankStatementNotReadyError,
  buildVouchersForStatement,
} from "@/lib/bank/bankVouchers";
import {
  buildMasterCreatePayload,
  buildVoucherPushPayload,
  enqueueJob,
  hasBlockingPushIssues,
  preflightForPush,
} from "@/lib/tally/syncJobs";
import { readIds, requireStatement } from "../../../_shared";

/**
 * POST /api/bank/statements/{id}/build
 * Body: { txnIds?: string[], push?: boolean }
 *
 * Turn saved rows into vouchers, then queue them for Tally.
 *
 * The queueing half is deliberately the same code `/api/tally/push` runs, not a
 * copy of it: `preflightForPush`, `buildMasterCreatePayload`,
 * `buildVoucherPushPayload` and `enqueueJob` from `syncJobs.ts`, in that order.
 * A bank voucher is an ordinary voucher the moment it exists, and a second
 * queueing path would be a second place for the MASTER_CREATE-before-
 * VOUCHER_PUSH ordering to be got wrong, a second place to forget that Tally
 * reports business rejections as EXCEPTIONS rather than ERRORS, and a second
 * set of `VoucherSync` rows to keep honest.
 *
 * The route is not the reusable unit — a server-side `fetch` of our own POST
 * handler would lose the session cookie and cost a round trip — but everything
 * inside it that matters is.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireStatement(id);
    if ("error" in ctx) return ctx.error;
    const { userId, clientId, statement } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
      txnIds?: unknown;
      push?: unknown;
    };
    const txnIds = readIds(body.txnIds);
    const wantsPush = body.push !== false;

    let result;
    try {
      result = await buildVouchersForStatement(prisma, {
        userId,
        clientId,
        statementId: statement.id,
        ...(txnIds.length ? { txnIds } : {}),
      });
    } catch (err) {
      if (err instanceof BankStatementNotReadyError) {
        // 409, the same status `/api/tally/push` uses for "go and fix a
        // precondition first", so the client can treat both the same way.
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      throw err;
    }

    if (!result.built.length && !result.voucherIds.length) {
      return NextResponse.json(
        {
          error:
            result.failed.length > 0
              ? "None of the selected rows could be built. See the per-row reasons."
              : "Nothing to build. Save the rows you want to post first.",
          ...result,
        },
        { status: result.failed.length ? 422 : 404 }
      );
    }

    if (!wantsPush) {
      return NextResponse.json({ ...result, jobIds: [], pushed: false });
    }

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId },
    });

    // The same hard gate as the invoice push. Without a master pull there are
    // no GUIDs, no book period to date-check against, and no evidence the
    // company name we hold opens anything.
    if (!company || company.status === "UNSYNCED") {
      return NextResponse.json(
        {
          ...result,
          error:
            "The vouchers were built, but nothing can be posted until masters have been synced from Tally. Sync masters, then send them.",
          status: company?.status ?? null,
        },
        { status: 409 }
      );
    }

    const vouchers = await prisma.voucher.findMany({
      where: {
        id: { in: result.voucherIds },
        userId,
        clientId,
        status: { in: ["APPROVED", "EXPORTED_DEMO"] },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
      orderBy: { date: "asc" },
    });

    if (!vouchers.length) {
      return NextResponse.json({ ...result, jobIds: [], pushed: false });
    }

    const issues = preflightForPush(
      vouchers.map((v) => ({
        id: v.id,
        date: v.date,
        // A bank voucher has no voucher number and never will — the statement
        // does not carry one. The exporter falls back to `RAO-<id>`.
        invoiceNumber: null,
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
          ...result,
          error: "Some of these vouchers would be rejected by Tally",
          issues: issues.filter((i) => i.severity === "error"),
          warnings: issues.filter((i) => i.severity === "warning"),
        },
        { status: 422 }
      );
    }

    const jobIds: string[] = [];
    const voucherIds = vouchers.map((v) => v.id);

    // Masters first, always. A voucher naming a ledger Tally has never heard of
    // comes back as `Ledger 'X' does not exist!` and the batch around it
    // partially succeeds.
    const ledgerIds = [
      ...new Set(
        vouchers.flatMap((v) => v.lines.map((l) => l.ledgerId).filter(Boolean) as string[])
      ),
    ];
    const masters = await buildMasterCreatePayload(prisma, {
      userId,
      clientId,
      companyName: company.companyName,
      ledgerIds,
    });
    if (masters) {
      const job = await enqueueJob(prisma, {
        userId,
        clientId,
        tallyCompanyId: company.id,
        kind: "MASTER_CREATE",
        payload: { ...masters },
      });
      jobIds.push(job.id);
    }

    const payload = await buildVoucherPushPayload(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      companyName: company.companyName,
      voucherIds,
    });

    const pushJob = await enqueueJob(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      kind: "VOUCHER_PUSH",
      payload: { ...payload },
    });
    jobIds.push(pushJob.id);

    // The statement stops being a draft once any of it is on its way. It is not
    // marked "SYNCED" here — that is Tally's answer to give, and it arrives per
    // voucher through `applyJobResult`, not per statement.
    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: { status: "SYNCED" },
    });

    return NextResponse.json({
      ...result,
      voucherIds,
      jobIds,
      pushed: true,
      warnings: issues.filter((i) => i.severity === "warning"),
    });
  } catch (error) {
    console.error("[BANK_BUILD_POST]", error);
    return NextResponse.json({ error: "Failed to build vouchers" }, { status: 500 });
  }
}
