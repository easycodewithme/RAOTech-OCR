import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { decodeSheet, encodeSheet, applyEdits } from "@/lib/excel/rowStorage";

/**
 * PATCH /api/excel/uploads/{id}/rows
 *
 * Accepts sparse cell edits and applies them to the staged row grid. This is
 * what makes the data editable between upload and commit — fixing a typo in an
 * invoice number or correcting a date without re-uploading the whole file.
 *
 * Only works while the upload is still in MAPPING or READY status; once
 * committed the rows have become Invoices and Vouchers and should be edited
 * through those screens instead.
 */
export async function PATCH(
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
        { error: "This sheet has already been committed. Edit the vouchers directly instead." },
        { status: 409 }
      );
    }

    const sheet = decodeSheet(upload.rows);
    if (!sheet) {
      return NextResponse.json(
        { error: "The parsed rows for this upload are no longer available. Upload the file again." },
        { status: 410 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const edits = body.edits;
    if (!Array.isArray(edits) || edits.length === 0) {
      return NextResponse.json({ error: "edits array is required" }, { status: 400 });
    }

    const updated = applyEdits(sheet, edits);

    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: {
        rows: encodeSheet(updated) as never,
      },
    });

    return NextResponse.json({ updated: edits.length });
  } catch (error) {
    console.error("[EXCEL_ROWS_PATCH]", error);
    return NextResponse.json({ error: "Failed to update rows" }, { status: 500 });
  }
}
