import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import type { LedgerGroup, LedgerType } from "@/lib/accounting/types";

// GET /api/ledgers — list the chart of accounts (seeds the standard chart on first call)
export async function GET() {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await seedLedgersForUser(prisma, user.id);

    const ledgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: [{ group: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ ledgers });
  } catch (error) {
    console.error("[LEDGERS_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load ledgers" }, { status: 500 });
  }
}

// POST /api/ledgers — create a ledger on the fly during mapping
export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const group = (body.group ?? "SUNDRY_CREDITORS") as LedgerGroup;
    const ledgerType = (body.ledgerType ?? "PARTY") as LedgerType;
    const gstRate = body.gstRate != null ? Number(body.gstRate) : null;

    const ledger = await prisma.ledger.upsert({
      where: { userId_clientId_name: { userId: user.id, clientId: "", name } },
      update: {},
      create: {
        userId: user.id,
        clientId: "",
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
