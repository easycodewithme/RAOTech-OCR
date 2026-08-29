import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * GET /api/excel/uploads
 *
 * The upload history for the active workspace. `rows` is deliberately not
 * selected — it is the staged cell grid and can be megabytes.
 */
export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const uploads = await prisma.excelUpload.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        fileName: true,
        sheetName: true,
        docType: true,
        itemMode: true,
        totalRows: true,
        committedRows: true,
        skippedRows: true,
        status: true,
        error: true,
        createdAt: true,
        committedAt: true,
        template: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ uploads });
  } catch (error) {
    console.error("[EXCEL_UPLOADS_LIST]", error);
    return NextResponse.json({ error: "Failed to list uploads" }, { status: 500 });
  }
}
