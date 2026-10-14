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

    /**
     * Opening stock — what the client held before this app started keeping
     * their books.
     *
     * Editable for the life of the item, unlike the unit. It is not a movement
     * and changing it does not contradict anything already posted: it shifts
     * the starting point every balance is counted from, which is exactly what
     * someone correcting a mis-typed opening quantity means to do.
     *
     * Blank clears it rather than storing zero. "No opening balance recorded"
     * and "opened with nothing" read the same on the summary and mean
     * different things to the person who has to decide whether to go and look
     * it up.
     */
    for (const field of ["openingQty", "openingRate"] as const) {
      if (body[field] === undefined) continue;
      const raw = body[field];
      if (raw === null || raw === "") {
        data[field] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return NextResponse.json(
          {
            error: `${
              field === "openingQty" ? "Opening quantity" : "Opening rate"
            } has to be a number.`,
          },
          { status: 400 }
        );
      }
      if (field === "openingRate" && n < 0) {
        return NextResponse.json(
          { error: "An opening rate cannot be negative." },
          { status: 400 }
        );
      }
      data[field] = n;
    }

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    /**
     * Changing a master here means Tally's copy is now behind ours, so it has
     * to go back into the next MASTER_CREATE. Clearing `tallySyncedAt` is what
     * that queue reads (`buildMasterCreatePayload` selects on it) — and the
     * push is idempotent, so a re-send ALTERs rather than duplicating.
     *
     * Only fields that actually appear in `stockItemXml` count. Opening stock
     * does not: it is an app-side figure the Stock summary counts from and no
     * tag in the master XML carries it, so re-queueing on an opening-stock
     * edit would re-ALTER a master in the client's books to send them bytes
     * identical to the ones already there.
     */
    const TALLY_VISIBLE = ["unit", "hsnCode", "gstRate", "alias"] as const;
    const requeued = !!item.tallySyncedAt && TALLY_VISIBLE.some((f) => f in data);
    if (requeued) data.tallySyncedAt = null;

    const updated = await prisma.stockItem.update({ where: { id: itemId }, data });
    return NextResponse.json({
      item: updated,
      ...(requeued ? { note: "Queued to update in Tally on the next sync." } : {}),
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
