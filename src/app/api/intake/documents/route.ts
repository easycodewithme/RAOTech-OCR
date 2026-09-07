import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { ensureIntakeTables } from "@/lib/intakeDb";

export async function GET(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    await ensureIntakeTables();

    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId");
    const status = searchParams.get("status");

    const where: Prisma.IntakeDocumentWhereInput = {};

    if (clientId) {
      where.clientId = clientId;
    } else {
      where.userId = user.id;
    }

    if (status) {
      where.status = status;
    }

    const documents = await prisma.intakeDocument.findMany({
      where,
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        mimeType: true,
        status: true,
        notes: true,
        createdAt: true,
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
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    console.error("[INTAKE_DOCUMENTS_GET]", error);
    return NextResponse.json({ error: "Failed to fetch intake documents" }, { status: 500 });
  }
}
