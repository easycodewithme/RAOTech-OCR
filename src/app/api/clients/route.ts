import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import {
  ACTIVE_CLIENT_COOKIE,
  ensureDefaultClient,
  listClientsForUser,
  getActiveClient,
} from "@/lib/clientContext";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";

export async function GET() {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const clients = await listClientsForUser(user.id);
    const ctx = await getActiveClient();
    return NextResponse.json({
      clients,
      activeClientId: ctx?.client.id ?? null,
    });
  } catch (error) {
    console.error("[CLIENTS_GET]", error);
    return NextResponse.json({ error: "Failed to load clients" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    await ensureDefaultClient(user.id);

    const client = await prisma.client.create({
      data: {
        userId: user.id,
        name,
        gstin: body.gstin || null,
        pan: body.pan || null,
        address: body.address || null,
        email: body.email || null,
        phone: body.phone || null,
        tallyCompany: body.tallyCompany || null,
        isDefault: false,
      },
    });

    await seedLedgersForUser(prisma, user.id, client.id);

    return NextResponse.json({ client });
  } catch (error: any) {
    console.error("[CLIENTS_POST]", error);
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "A client with this name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}

/** PATCH: switch active client { clientId } */
export async function PATCH(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const clientId = String(body.clientId ?? "");
    const client = await prisma.client.findFirst({ where: { id: clientId, userId: user.id } });
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    await prisma.user.update({
      where: { id: user.id },
      data: { activeClientId: client.id },
    });

    const res = NextResponse.json({ activeClientId: client.id, client });
    res.cookies.set(ACTIVE_CLIENT_COOKIE, client.id, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (error) {
    console.error("[CLIENTS_PATCH]", error);
    return NextResponse.json({ error: "Failed to switch client" }, { status: 500 });
  }
}
