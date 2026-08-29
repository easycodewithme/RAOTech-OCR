import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import {
  parseTallyImportResponse,
  describeImportResult,
} from "@/lib/tally/importResult";

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
      await prisma.$transaction([
        prisma.tallyExport.update({
          where: { id: exportRow.id },
          data: { status: "POSTED" },
        }),
        prisma.voucher.updateMany({
          where: {
            id: { in: exportRow.voucherIds },
            userId: user.id,
            clientId: client.id,
            status: "EXPORTED_DEMO",
          },
          data: { status: "POSTED" },
        }),
      ]);
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
