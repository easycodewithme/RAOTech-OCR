import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * Copy the active client's item masters into another of this user's clients.
 *
 * Two companies in the same trade keep close to the same chart of items, and
 * the alternative to this is re-typing forty names with their units and HSN
 * codes — the one genuinely laborious job in Vyapar TaxOne's Master module,
 * which is why they ship the same feature.
 *
 * Three rules, all of them about not moving one company's books into another:
 *
 *  - Only the item's own attributes travel: name, unit, HSN, GST rate, alias.
 *  - Opening stock does not. It is a fact about one godown on one date.
 *  - The Tally identity does not — `tallyGuid`, `tallyCompanyId` and
 *    `tallySyncedAt` are left null so the copies are queued for the target
 *    client's own Tally company. Carrying a GUID across would point the new
 *    rows at a master in a different company's data file, and the first push
 *    would either alter the wrong item or fail on a GUID Tally has never seen.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const targetClientId = String(body.targetClientId ?? "").trim();
    if (!targetClientId) {
      return NextResponse.json({ error: "Pick a client to copy into." }, { status: 400 });
    }
    if (targetClientId === client.id) {
      return NextResponse.json(
        { error: "That is the client these items already belong to." },
        { status: 400 }
      );
    }

    /**
     * Ownership is checked against the same `userId` scope every other
     * client-scoped query uses. Without this, a client id from anywhere could
     * be posted here and items written into a workspace the caller cannot see.
     */
    const target = await prisma.client.findFirst({
      where: { id: targetClientId, userId: user.id },
      select: { id: true, name: true },
    });
    if (!target) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [source, existing] = await Promise.all([
      prisma.stockItem.findMany({
        where: { userId: user.id, clientId: client.id },
        select: { name: true, unit: true, hsnCode: true, gstRate: true, alias: true },
      }),
      prisma.stockItem.findMany({
        where: { userId: user.id, clientId: target.id },
        select: { name: true },
      }),
    ]);

    if (source.length === 0) {
      return NextResponse.json({ error: "There are no items to copy." }, { status: 400 });
    }

    /**
     * Case-insensitive, because StockItem is unique on the exact name and
     * `createMany` would otherwise insert "Widget" beside an existing "widget"
     * — two masters that Tally will treat as one and that nothing here would
     * ever reconcile.
     */
    const taken = new Set(existing.map((e) => e.name.trim().toLowerCase()));
    const fresh = source.filter((s) => !taken.has(s.name.trim().toLowerCase()));

    if (fresh.length === 0) {
      return NextResponse.json({
        created: 0,
        skipped: source.length,
        clientName: target.name,
      });
    }

    const result = await prisma.stockItem.createMany({
      data: fresh.map((s) => ({
        userId: user.id,
        clientId: target.id,
        name: s.name,
        unit: s.unit,
        hsnCode: s.hsnCode,
        gstRate: s.gstRate,
        alias: s.alias,
      })),
      // Belt and braces against a concurrent create between the read above and
      // this write: a copy that lands half-done is worse than one that skips.
      skipDuplicates: true,
    });

    return NextResponse.json({
      created: result.count,
      skipped: source.length - result.count,
      clientName: target.name,
    });
  } catch (error) {
    console.error("[STOCK_ITEMS_CLONE]", error);
    return NextResponse.json({ error: "Failed to copy the stock items" }, { status: 500 });
  }
}
