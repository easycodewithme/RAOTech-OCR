import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    const { docId } = await params;

    const document = await prisma.intakeDocument.findFirst({
      where: {
        id: docId,
        OR: [
          { userId: user.id },
          { client: { userId: user.id } },
          { client: { members: { some: { userId: user.id } } } },
        ],
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            gstin: true,
          },
        },
        intakeLink: {
          select: {
            id: true,
            label: true,
            token: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error) {
    console.error("[INTAKE_DOC_GET]", error);
    return NextResponse.json({ error: "Failed to fetch document" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    const { docId } = await params;
    const body = await req.json().catch(() => ({}));

    const document = await prisma.intakeDocument.findFirst({
      where: {
        id: docId,
        OR: [
          { userId: user.id },
          { client: { userId: user.id } },
          { client: { members: { some: { userId: user.id } } } },
        ],
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const updated = await prisma.intakeDocument.update({
      where: { id: docId },
      data: {
        status: body.status || document.status,
        notes: body.notes !== undefined ? body.notes : document.notes,
      },
    });

    return NextResponse.json({ document: updated });
  } catch (error) {
    console.error("[INTAKE_DOC_PATCH]", error);
    return NextResponse.json({ error: "Failed to update document" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    const { docId } = await params;

    const document = await prisma.intakeDocument.findFirst({
      where: {
        id: docId,
        OR: [
          { userId: user.id },
          { client: { userId: user.id } },
          { client: { members: { some: { userId: user.id } } } },
        ],
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await prisma.intakeDocument.delete({
      where: { id: docId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[INTAKE_DOC_DELETE]", error);
    return NextResponse.json({ error: "Failed to delete document" }, { status: 500 });
  }
}
