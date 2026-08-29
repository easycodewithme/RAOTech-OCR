import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * The stock item masters a workspace holds.
 *
 * Bulk upload could create these and nothing could show them, which meant a
 * sheet mapped to the wrong column produced three hundred items called "Nos"
 * and no way to find that out inside the app.
 *
 * These masters also gate the whole inventory feature: a voucher line becomes
 * an inventory allocation only when an item of that name exists here
 * (`resolveStockItems.ts`). So this list is not a reference screen — it is the
 * switch, and it needs to be legible as one.
 */
export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const items = await prisma.stockItem.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        unit: true,
        hsnCode: true,
        gstRate: true,
        alias: true,
        openingQty: true,
        openingRate: true,
        tallySyncedAt: true,
        _count: { select: { lines: true } },
      },
    });

    return NextResponse.json({
      items: items.map((i) => ({
        ...i,
        /**
         * Whether this item has ever been used on a voucher.
         *
         * The UI needs it to decide what may still be edited. Tally refuses to
         * change a stock item's base unit once stock has moved against it, so
         * an item with lines is past the point where a mistyped unit can be
         * corrected — better to say so than to offer a field that will be
         * rejected on the next push.
         */
        usedOnVouchers: i._count.lines,
        _count: undefined,
      })),
      /** Masters the next sync will push. */
      unsyncedCount: items.filter((i) => !i.tallySyncedAt).length,
    });
  } catch (error) {
    console.error("[STOCK_ITEMS_GET]", error);
    return NextResponse.json({ error: "Failed to load stock items" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const unit = String(body.unit ?? "").trim();

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!unit) {
      return NextResponse.json(
        {
          error:
            "A unit is required. Tally cannot change an item's base unit once stock has moved against it, so this is not something to fill in later.",
        },
        { status: 400 }
      );
    }

    const existing = await prisma.stockItem.findFirst({
      where: { userId: user.id, clientId: client.id, name },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `"${name}" already exists in this workspace.` },
        { status: 409 }
      );
    }

    const item = await prisma.stockItem.create({
      data: {
        userId: user.id,
        clientId: client.id,
        name,
        unit,
        hsnCode: String(body.hsnCode ?? "").replace(/\s+/g, "") || null,
        gstRate: body.gstRate == null || body.gstRate === "" ? null : Number(body.gstRate),
        alias: String(body.alias ?? "").trim() || null,
      },
    });

    return NextResponse.json({ item });
  } catch (error) {
    console.error("[STOCK_ITEMS_POST]", error);
    return NextResponse.json({ error: "Failed to create the stock item" }, { status: 500 });
  }
}
