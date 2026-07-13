import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const links = await prisma.intakeLink.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ links });
  } catch (error) {
    console.error("[INTAKE_GET]", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const body = await req.json().catch(() => ({}));

    const link = await prisma.intakeLink.create({
      data: {
        userId: user.id,
        clientId: client.id,
        label: body.label || `${client.name} intake`,
        enabled: true,
      },
    });
    return NextResponse.json({ link });
  } catch (error) {
    console.error("[INTAKE_POST]", error);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}
