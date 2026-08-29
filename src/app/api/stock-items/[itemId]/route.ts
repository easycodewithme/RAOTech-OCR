import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * PATCH — correct a master before it has been used.
 * DELETE — remove one that never was.
 *
 * Both are deliberately narrow, because a stock master stops being ours the
 * moment Tally has it: Tally will not let a base unit change once stock has
 * moved, and a rename here would create a *second* item there rather than
 * renaming the first (we match items by name, not GUID — see the note in
 * `buildMasterCreatePayload`). Offering an edit that silently forks the
 * client's item list would be worse than offering none.
 */

async function owned(itemId: string) {
  const ctx = await getActiveClient();
  if (!ctx) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { user, client } = ctx;

  const item = await prisma.stockItem.findFirst({
    where: { id: itemId, userId: user.id, clientId: client.id },
    select: {
      id: true,
      name: true,
      tallySyncedAt: true,
      _count: { select: { lines: true } },
    },
  });
  if (!item) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { userId: user.id, clientId: client.id, item };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const ctx = await owned(itemId);
    if ("error" in ctx) return ctx.error;
    const { item } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const used = item._count.lines > 0;

    const data: Record<string, unknown> = {};

    if (body.unit !== undefined) {
      const unit = String(body.unit ?? "").trim();
      if (!unit) return NextResponse.json({ error: "A unit is required." }, { status: 400 });
      if (used) {
        return NextResponse.json(
          {
            error: `"${item.name}" is already on ${item._count.lines} voucher line(s), so its unit cannot be changed. Tally refuses to alter a base unit once stock has moved against the item — changing it here would only make the next push fail. Create a new item with the right unit instead.`,
          },
          { status: 409 }
        );
      }
      data.unit = unit;
    }

    if (body.hsnCode !== undefined) {
      data.hsnCode = String(body.hsnCode ?? "").replace(/\s+/g, "") || null;
    }
    if (body.gstRate !== undefined) {
      data.gstRate = body.gstRate === null || body.gstRate === "" ? null : Number(body.gstRate);
    }
    if (body.alias !== undefined) {
      data.alias = String(body.alias ?? "").trim() || null;
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    /**
     * Changing a master here means Tally's copy is now behind ours, so it has
     * to go back into the next MASTER_CREATE. Clearing `tallySyncedAt` is what
     * that queue reads (`buildMasterCreatePayload` selects on it) — and the
     * push is idempotent, so a re-send ALTERs rather than duplicating.
     */
    if (item.tallySyncedAt) data.tallySyncedAt = null;

    const updated = await prisma.stockItem.update({ where: { id: itemId }, data });
    return NextResponse.json({
      item: updated,
      ...(item.tallySyncedAt
        ? { note: "Queued to update in Tally on the next sync." }
        : {}),
    });
  } catch (error) {
    console.error("[STOCK_ITEM_PATCH]", error);
    return NextResponse.json({ error: "Failed to update the stock item" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const ctx = await owned(itemId);
    if ("error" in ctx) return ctx.error;
    const { item } = ctx;

    if (item._count.lines > 0) {
      return NextResponse.json(
        {
          error: `"${item.name}" is on ${item._count.lines} voucher line(s) and cannot be removed. Deleting it would leave those vouchers naming an item nothing here knows about.`,
        },
        { status: 409 }
      );
    }

    /**
     * Local only. If Tally already has this item we do not try to delete it
     * there: Tally refuses to remove a master with movement anyway, and a
     * master the client can still see is a great deal less harmful than one
     * silently removed from their books because someone tidied a list here.
     */
    await prisma.stockItem.delete({ where: { id: itemId } });
    return NextResponse.json({
      success: true,
      ...(item.tallySyncedAt
        ? { note: "Removed here. It stays in Tally — masters are never deleted there from this screen." }
        : {}),
    });
  } catch (error) {
    console.error("[STOCK_ITEM_DELETE]", error);
    return NextResponse.json({ error: "Failed to delete the stock item" }, { status: 500 });
  }
}
