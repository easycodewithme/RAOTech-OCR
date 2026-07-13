import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import type { LedgerGroup, LedgerType } from "@/lib/accounting/types";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    await seedLedgersForUser(prisma, user.id, client.id);

    const ledgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: [{ group: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ ledgers, clientId: client.id });
  } catch (error) {
    console.error("[LEDGERS_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load ledgers" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const group = (body.group ?? "SUNDRY_CREDITORS") as LedgerGroup;
    const ledgerType = (body.ledgerType ?? "PARTY") as LedgerType;
    const gstRate = body.gstRate != null ? Number(body.gstRate) : null;

    const ledger = await prisma.ledger.upsert({
      where: { userId_clientId_name: { userId: user.id, clientId: client.id, name } },
      update: {},
      create: {
        userId: user.id,
        clientId: client.id,
        name,
        group,
        ledgerType,
        gstRate,
        isSeeded: false,
        isSystem: false,
      },
    });
    return NextResponse.json({ ledger });
  } catch (error) {
    console.error("[LEDGERS_POST_ERROR]", error);
    return NextResponse.json({ error: "Failed to create ledger" }, { status: 500 });
  }
}
