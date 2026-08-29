import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { decodeSheet } from "@/lib/excel/rowStorage";

/** GET /api/excel/uploads/{id} — the upload, plus a window on its staged rows. */
export async function GET(
  _req: Request,
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
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    const sheet = decodeSheet(upload.rows);

    const { rows: _rows, ...rest } = upload;
    return NextResponse.json({
      upload: rest,
      // Never the whole grid — it is megabytes and the client only draws a page.
      preview: sheet ? sheet.rows.slice(0, 100) : [],
      rowsAvailable: !!sheet,
    });
  } catch (error) {
    console.error("[EXCEL_UPLOAD_GET]", error);
    return NextResponse.json({ error: "Failed to load upload" }, { status: 500 });
  }
}

/**
 * DELETE /api/excel/uploads/{id}
 *
 * Removes the upload record only. Vouchers already committed from it are left
 * alone: they are ordinary vouchers by then, some may already be in Tally, and
 * deleting an import log is not consent to unpost anyone's books. Use
 * Delete From Tally on the transactions screen for that.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { uploadId } = await params;

    const { count } = await prisma.excelUpload.deleteMany({
      where: { id: uploadId, userId: user.id, clientId: client.id },
    });
    if (!count) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[EXCEL_UPLOAD_DELETE]", error);
    return NextResponse.json({ error: "Failed to delete upload" }, { status: 500 });
  }
}
