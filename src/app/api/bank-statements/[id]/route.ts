import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";

// GET /api/bank-statements/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const statement = await prisma.bankStatement.findFirst({
      where: { id, userId: user.id },
      include: { txns: { orderBy: { sortOrder: "asc" } } },
    });
    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ statement });
  } catch (error) {
    console.error("[BANK_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load statement" }, { status: 500 });
  }
}

/**
 * PATCH /api/bank-statements/[id]
 *  - { txns: [{id, ledgerId}] } — remap contra ledgers
 *  - { status: "SYNCED" }       — mark synced (frontend Tally action)
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    const statement = await prisma.bankStatement.findFirst({
      where: { id, userId: user.id },
      include: { txns: { select: { id: true } } },
    });
    if (!statement) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const validIds = new Set(statement.txns.map((t) => t.id));
    const txnUpdates: Array<{ id: string; ledgerId: string | null }> = body.txns ?? [];

    const ledgerIds = txnUpdates.map((u) => u.ledgerId).filter((x): x is string => !!x);
    const ledgers = ledgerIds.length
      ? await prisma.ledger.findMany({
          where: { id: { in: ledgerIds }, userId: user.id },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(ledgers.map((l) => [l.id, l.name]));

    await prisma.$transaction([
      ...txnUpdates
        .filter((u) => validIds.has(u.id) && (!u.ledgerId || nameById.has(u.ledgerId)))
        .map((u) =>
          prisma.bankTxn.update({
            where: { id: u.id },
            data: {
              ledgerId: u.ledgerId,
              ledgerNameSnapshot: u.ledgerId ? nameById.get(u.ledgerId) ?? null : null,
            },
          })
        ),
      ...(body.status
        ? [prisma.bankStatement.update({ where: { id }, data: { status: String(body.status) } })]
        : []),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[BANK_PATCH_ERROR]", error);
    return NextResponse.json({ error: "Failed to update statement" }, { status: 500 });
  }
}
