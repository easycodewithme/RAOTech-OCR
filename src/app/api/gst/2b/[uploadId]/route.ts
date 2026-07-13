import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { uploadId } = await params;

    const upload = await prisma.gst2bUpload.findFirst({
      where: { id: uploadId, userId: user.id, clientId: client.id },
      include: {
        matches: {
          include: {
            gst2bRow: true,
            invoice: {
              select: {
                id: true,
                vendor: true,
                vendorGstin: true,
                invoiceNumber: true,
                subtotal: true,
                taxAmount: true,
                totalAmount: true,
              },
            },
          },
          orderBy: { status: "asc" },
        },
      },
    });

    if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ upload });
  } catch (error) {
    console.error("[GST2B_DETAIL]", error);
    return NextResponse.json({ error: "Failed to load reconciliation" }, { status: 500 });
  }
}
