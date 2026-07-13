import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberNarrationMapping } from "@/lib/accounting/rememberMapping";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { id } = await params;

    const statement = await prisma.bankStatement.findFirst({
      where: { id, userId: user.id, clientId: client.id },
      include: { txns: { orderBy: { sortOrder: "asc" } } },
    });
    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ statement });
  } catch (error) {
    console.error("[BANK_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load statement" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { id } = await params;

    const statement = await prisma.bankStatement.findFirst({
      where: { id, userId: user.id, clientId: client.id },
      include: { txns: true },
    });
    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const validIds = new Set(statement.txns.map((t) => t.id));
    const txnUpdates: Array<{ id: string; ledgerId: string | null; classification?: string }> =
      body.txns ?? [];

    const ledgerIds = txnUpdates.map((u) => u.ledgerId).filter((x): x is string => !!x);
    const ledgers = ledgerIds.length
      ? await prisma.ledger.findMany({
          where: { id: { in: ledgerIds }, userId: user.id, clientId: client.id },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(ledgers.map((l) => [l.id, l.name]));
    const txnById = new Map(statement.txns.map((t) => [t.id, t]));

    await prisma.$transaction([
      ...txnUpdates
        .filter((u) => validIds.has(u.id) && (!u.ledgerId || nameById.has(u.ledgerId)))
        .map((u) =>
          prisma.bankTxn.update({
            where: { id: u.id },
            data: {
              ledgerId: u.ledgerId,
              ledgerNameSnapshot: u.ledgerId ? nameById.get(u.ledgerId) ?? null : null,
              ...(u.classification
                ? { classification: u.classification as any }
                : {}),
            },
          })
        ),
      ...(body.status
        ? [prisma.bankStatement.update({ where: { id }, data: { status: String(body.status) } })]
        : []),
    ]);

    // Learn narration mappings
    for (const u of txnUpdates) {
      if (!u.ledgerId) continue;
      const txn = txnById.get(u.id);
      if (txn?.description) {
        await rememberNarrationMapping(prisma, user.id, client.id, txn.description, u.ledgerId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[BANK_PATCH_ERROR]", error);
    return NextResponse.json({ error: "Failed to update statement" }, { status: 500 });
  }
}
