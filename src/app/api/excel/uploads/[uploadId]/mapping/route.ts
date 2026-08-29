import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { mapRows } from "@/lib/excel/mapRows";
import { validateRows } from "@/lib/excel/validate";
import { decodeSheet } from "@/lib/excel/rowStorage";
import type { SheetMapping } from "@/lib/excel/types";

export const maxDuration = 60;

/** How many mapped rows the preview grid renders. */
const PREVIEW_ROWS = 100;

/**
 * POST /api/excel/uploads/{id}/mapping
 * Body: { mapping: SheetMapping }
 *
 * Applies a mapping to the staged rows and returns what *would* be created,
 * without creating it. The user iterates here — adjust a column, look again —
 * which is why the parsed grid is staged rather than re-uploaded each time.
 *
 * Saving the mapping and previewing it are the same call on purpose: a preview
 * the user cannot come back to is a preview they have to redo.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { uploadId } = await params;

    const upload = await prisma.excelUpload.findFirst({
      where: { id: uploadId, userId: user.id, clientId: client.id },
    });
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 });
    }
    if (upload.status === "COMMITTED") {
      return NextResponse.json(
        { error: "This sheet has already been committed. Upload it again to re-map." },
        { status: 409 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const mapping = body.mapping as SheetMapping | undefined;
    if (!mapping) {
      return NextResponse.json({ error: "mapping is required" }, { status: 400 });
    }

    const sheet = decodeSheet(upload.rows);
    if (!sheet) {
      return NextResponse.json(
        { error: "The parsed rows for this upload are no longer available. Upload the file again." },
        { status: 410 }
      );
    }

    // The books-beginning date is the one hard date bound Tally enforces, so
    // preview it here rather than letting the user discover it at push time.
    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
      select: { booksFrom: true, fyStart: true },
    });

    const ledgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: client.id },
      select: { id: true, name: true, tallyGuid: true },
    });

    // Validate once and hand the result to mapRows. It validates for itself
    // when not given issues — correct on its own, but doing both here would
    // report every problem twice.
    const issues = validateRows(sheet, mapping, {
      booksFrom: company?.booksFrom ?? company?.fyStart ?? null,
    });

    const result = mapRows(sheet, mapping, {
      userId: user.id,
      clientId: client.id,
      ledgers,
      issues,
      // Interstate is decided per row by comparing the party's GSTIN state to
      // ours, so the company's own registration has to come along.
      companyStateCode: client.gstin ?? null,
      booksFrom: company?.booksFrom ?? company?.fyStart ?? null,
    });

    const allIssues = result.issues;
    const blocking = allIssues.filter((i) => i.severity === "error");

    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: {
        mapping: mapping as never,
        itemMode: mapping.itemMode,
        docType: mapping.docType,
        issues: allIssues as never,
        status: blocking.length ? "MAPPING" : "READY",
      },
    });

    return NextResponse.json({
      status: blocking.length ? "MAPPING" : "READY",
      committableCount: result.committableCount,
      totalRows: sheet.rows.length,
      blockingCount: blocking.length,
      warningCount: allIssues.length - blocking.length,
      issues: allIssues.slice(0, 500),
      missingParties: result.missingParties,
      preview: result.rows.slice(0, PREVIEW_ROWS),
    });
  } catch (error) {
    console.error("[EXCEL_MAPPING]", error);
    return NextResponse.json({ error: "Failed to apply that mapping" }, { status: 500 });
  }
}
