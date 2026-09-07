import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const [clients, links, totalDocs, pendingDocs] = await Promise.all([
      prisma.client.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          name: true,
          gstin: true,
          email: true,
          phone: true,
          _count: {
            select: {
              intakeDocuments: true,
              intakeLinks: true,
            },
          },
        },
        orderBy: { name: "asc" },
      }),
      prisma.intakeLink.findMany({
        where: { userId: user.id },
        include: {
          client: {
            select: { id: true, name: true, gstin: true },
          },
          _count: {
            select: { documents: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.intakeDocument.count({
        where: { userId: user.id },
      }),
      prisma.intakeDocument.count({
        where: { userId: user.id, status: "PENDING" },
      }),
    ]);

    return NextResponse.json({
      activeClientId: client.id,
      clients,
      links,
      stats: {
        totalLinks: links.length,
        totalDocs,
        pendingDocs,
      },
    });
  } catch (error) {
    console.error("[INTAKE_GET]", error);
    return NextResponse.json({ error: "Failed to fetch intake data" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const body = await req.json().catch(() => ({}));

    const targetClientId = body.clientId || client.id;

    // Verify ownership of the client
    const targetClient = await prisma.client.findFirst({
      where: { id: targetClientId, userId: user.id },
    });

    if (!targetClient) {
      return NextResponse.json({ error: "Selected client not found" }, { status: 404 });
    }

    const link = await prisma.intakeLink.create({
      data: {
        userId: user.id,
        clientId: targetClient.id,
        label: body.label?.trim() || `${targetClient.name} Document Intake`,
        enabled: true,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
      include: {
        client: {
          select: { id: true, name: true, gstin: true },
        },
        _count: {
          select: { documents: true },
        },
      },
    });

    return NextResponse.json({ link });
  } catch (error) {
    console.error("[INTAKE_POST]", error);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}
