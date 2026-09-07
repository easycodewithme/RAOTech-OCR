import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { ensureIntakeTables } from "@/lib/intakeDb";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    // Self-heal tables if missing in current database
    await ensureIntakeTables();

    // 1. Fetch all clients associated with this user (owned, membership, or active)
    const dbClients = await prisma.client.findMany({
      where: {
        OR: [
          { userId: user.id },
          { members: { some: { userId: user.id } } },
          { id: client.id },
        ],
      },
      select: {
        id: true,
        name: true,
        gstin: true,
        email: true,
        phone: true,
      },
      orderBy: { name: "asc" },
    });

    // Ensure we always have at least the active client in the list
    const clientList =
      dbClients.length > 0
        ? dbClients
        : [
            {
              id: client.id,
              name: client.name,
              gstin: client.gstin,
              email: client.email,
              phone: client.phone,
            },
          ];

    const clientIds = clientList.map((c) => c.id);

    // 2. Safely query links and counts
    let links: Array<{
      id: string;
      token: string;
      label: string | null;
      enabled: boolean;
      createdAt: Date;
      clientId: string;
      client: { id: string; name: string; gstin: string | null };
      _count: { documents: number };
    }> = [];

    let totalDocs = 0;
    let pendingDocs = 0;
    const docCounts: Record<string, number> = {};

    try {
      const [fetchedLinks, docsCount, pDocsCount, groupedDocs] = await Promise.all([
        prisma.intakeLink.findMany({
          where: {
            OR: [
              { userId: user.id },
              { clientId: { in: clientIds } },
            ],
          },
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
          where: {
            OR: [
              { userId: user.id },
              { clientId: { in: clientIds } },
            ],
          },
        }),
        prisma.intakeDocument.count({
          where: {
            OR: [
              { userId: user.id },
              { clientId: { in: clientIds } },
            ],
            status: "PENDING",
          },
        }),
        prisma.intakeDocument.groupBy({
          by: ["clientId"],
          _count: { id: true },
          where: { clientId: { in: clientIds } },
        }),
      ]);

      links = fetchedLinks;
      totalDocs = docsCount;
      pendingDocs = pDocsCount;
      for (const g of groupedDocs) {
        docCounts[g.clientId] = g._count.id;
      }
    } catch (queryErr) {
      console.error("[INTAKE_DATA_QUERY_WARN]", queryErr);
    }

    const clientsWithCount = clientList.map((c) => ({
      ...c,
      _count: {
        intakeDocuments: docCounts[c.id] || 0,
        intakeLinks: links.filter((l) => l.clientId === c.id).length,
      },
    }));

    return NextResponse.json({
      activeClientId: client.id,
      clients: clientsWithCount,
      links,
      stats: {
        totalLinks: links.length,
        totalDocs,
        pendingDocs,
      },
    });
  } catch (error) {
    console.error("[INTAKE_GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch intake data" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const body = await req.json().catch(() => ({}));

    await ensureIntakeTables();

    const targetClientId = body.clientId || client.id;

    // Verify client exists
    let targetClient = await prisma.client.findFirst({
      where: {
        id: targetClientId,
      },
    });

    if (!targetClient) {
      targetClient = await prisma.client.findFirst({
        where: {
          id: client.id,
        },
      });
    }

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
      },
    });

    return NextResponse.json({
      link: {
        ...link,
        _count: { documents: 0 },
      },
    });
  } catch (error) {
    console.error("[INTAKE_POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create link" },
      { status: 500 }
    );
  }
}
