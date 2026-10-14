import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import {
  parseTallyImportResponse,
  describeImportResult,
} from "@/lib/tally/importResult";
import { remoteIdFor } from "@/lib/tally/exportXml";

/**
 * POST /api/export/tally/result
 * Body: { exportId: string, response: string }
 *
 * The desktop connector pushes the XML to Tally on the accountant's machine,
 * then reports Tally's reply here. This is where an export stops meaning "a
 * file was generated" and starts meaning "it is in the books" — until now
 * nothing in the codebase ever moved a voucher to POSTED.
 *
 * Only vouchers still sitting at EXPORTED_DEMO are advanced, so a replayed or
 * duplicated callback cannot walk a voucher backwards or disturb one an
 * accountant has since changed.
 *
 * Each advanced voucher also gains a POSTED `VoucherSync` row carrying the
 * `RAO-` REMOTEID the exported XML actually used. Without it the voucher is in
 * the client's books but unreachable from here — see the comment on that write.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const exportId = String(body.exportId ?? "");
    const responseXml = typeof body.response === "string" ? body.response : "";

    if (!exportId) {
      return NextResponse.json({ error: "exportId is required" }, { status: 400 });
    }

    // Scope the lookup to the caller's own workspace.
    const exportRow = await prisma.tallyExport.findFirst({
      where: { id: exportId, userId: user.id, clientId: client.id },
    });
    if (!exportRow) {
      return NextResponse.json({ error: "Export not found" }, { status: 404 });
    }

    const result = parseTallyImportResponse(responseXml);
    const summary = describeImportResult(result);

    if (result.ok) {
      /**
       * POSTED is not just a label, it is a promise that the voucher can still
       * be reached. Delete needs a POSTED `VoucherSync` row to find the
       * REMOTEID, and re-push needs APPROVED; a voucher marked POSTED with no
       * sync row satisfies neither and is frozen — in the client's books, but
       * un-deletable and un-repushable from here. That is what this path used
       * to produce, even though the XML it generated carried a real `RAO-`
       * REMOTEID that Tally would have honoured.
       *
       * The sync row is keyed by TallyCompany, so without one there is nowhere
       * to write it. Inventing a company row is not an option: `companyName` is
       * sent verbatim as <SVCURRENTCOMPANY> and a guessed name is silently
       * treated by Tally as "no such company", so a fabricated row would post a
       * confident-looking handle that resolves to nothing.
       *
       * So the honest move is to refuse the transition rather than complete it
       * badly. Nothing is written: the export stays EXPORTED_DEMO and its
       * vouchers with it, which is the recoverable state — EXPORTED_DEMO is
       * re-exportable, and because the REMOTEID is derived from the voucher id
       * a second import ALTERs the same voucher instead of duplicating it. The
       * user registers the company, replays this callback, and the round trip
       * closes properly.
       */
      const company = await prisma.tallyCompany.findUnique({
        where: { clientId: client.id },
        select: { id: true },
      });

      if (!company) {
        return NextResponse.json(
          {
            ok: false,
            status: "EXPORTED_DEMO",
            code: "NO_TALLY_COMPANY",
            error:
              "Tally accepted the import, but no TallyPrime company is registered for this workspace, so there is nowhere to record the id these vouchers are now addressable by. Register the company (Settings → Tally) and send this result again; nothing has been marked posted, and re-importing the same file alters those vouchers rather than duplicating them.",
            summary,
          },
          { status: 409 }
        );
      }

      await prisma.$transaction(async (tx) => {
        // Read the set *before* the status update, so the sync rows written
        // below are exactly the vouchers this callback advanced. A replayed or
        // duplicated callback finds nothing still at EXPORTED_DEMO and so
        // touches no sync row either — it cannot walk one backwards out of
        // DELETED, which is the state "Delete From Tally" leaves behind.
        const advancing = await tx.voucher.findMany({
          where: {
            id: { in: exportRow.voucherIds },
            userId: user.id,
            clientId: client.id,
            status: "EXPORTED_DEMO",
          },
          select: { id: true },
        });

        await tx.tallyExport.update({
          where: { id: exportRow.id },
          data: { status: "POSTED" },
        });

        if (advancing.length === 0) return;

        const voucherIds = advancing.map((v) => v.id);
        const now = new Date();

        // Two statements rather than an upsert per voucher: a month-end export
        // carries hundreds of vouchers, and a few hundred round trips inside
        // one interactive transaction is how you meet Prisma's five-second
        // limit. `remoteId` is a pure function of the voucher id, so a row that
        // already exists already carries the right one — there is nothing
        // per-row left to rewrite.
        await tx.voucherSync.createMany({
          data: voucherIds.map((voucherId) => ({
            voucherId,
            tallyCompanyId: company.id,
            remoteId: remoteIdFor(voucherId),
            state: "POSTED" as const,
            syncedAt: now,
            lastAttemptAt: now,
          })),
          skipDuplicates: true,
        });

        const marked = await tx.voucherSync.updateMany({
          where: { voucherId: { in: voucherIds }, tallyCompanyId: company.id },
          data: { state: "POSTED", error: null, syncedAt: now, lastAttemptAt: now },
        });

        /**
         * Fail loudly instead of posting something unreachable.
         *
         * `skipDuplicates` also skips a row whose `remoteId` collides globally
         * — which happens when the workspace was repointed at a different Tally
         * company and the old company's row still holds `RAO-<uuid>`. Left
         * alone that voucher would be marked POSTED with no sync row for the
         * company it was actually imported into: the exact frozen state this
         * whole block exists to prevent, only now silent. Throwing rolls the
         * transaction back, so the callback can be replayed once the stale row
         * is dealt with.
         */
        if (marked.count !== voucherIds.length) {
          throw new Error(
            `Only ${marked.count} of ${voucherIds.length} vouchers could be given a sync row for company ${company.id}; refusing to mark the rest posted.`
          );
        }

        // Last, so that even a torn write leaves vouchers at EXPORTED_DEMO with
        // sync rows rather than POSTED with none. Re-running the callback then
        // finishes the job; the reverse would need a hand-written row.
        await tx.voucher.updateMany({
          where: { id: { in: voucherIds } },
          data: { status: "POSTED" },
        });
      });
    } else {
      // Leave the vouchers at EXPORTED_DEMO so the batch can be retried once
      // the underlying problem (missing ledger, date out of range) is fixed.
      await prisma.tallyExport.update({
        where: { id: exportRow.id },
        data: { status: "FAILED" },
      });
    }

    return NextResponse.json({
      ok: result.ok,
      status: result.ok ? "POSTED" : "FAILED",
      summary,
      result: {
        created: result.created,
        altered: result.altered,
        ignored: result.ignored,
        errors: result.errors,
        exceptions: result.exceptions,
        lastVoucherId: result.lastVoucherId,
        lineErrors: result.lineErrors,
      },
    });
  } catch (error) {
    console.error("[TALLY_RESULT]", error);
    return NextResponse.json({ error: "Failed to record import result" }, { status: 500 });
  }
}
