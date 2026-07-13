import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const tasks = await prisma.task.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ tasks });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const body = await req.json();
    const title = String(body.title || "").trim();
    if (!title) return NextResponse.json({ error: "Title required" }, { status: 400 });

    const task = await prisma.task.create({
      data: {
        userId: user.id,
        clientId: client.id,
        title,
        description: body.description || null,
        priority: body.priority != null ? Number(body.priority) : 2,
        status: "OPEN",
      },
    });
    return NextResponse.json({ task });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const body = await req.json();
    const id = String(body.id || "");
    const task = await prisma.task.findFirst({ where: { id, userId: user.id, clientId: client.id } });
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.title ? { title: body.title } : {}),
      },
    });
    return NextResponse.json({ task: updated });
  } catch (error) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
