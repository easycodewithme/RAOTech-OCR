import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { decodeSheet } from "@/lib/excel/rowStorage";
import {
  mapItemMasters,
  mapLedgerMasters,
  suggestMasterMapping,
  type MasterFieldMapping,
} from "@/lib/excel/masters";

export const maxDuration = 60;

/** How many mapped rows the review grid renders. */
const PREVIEW_ROWS = 100;

/**
 * POST /api/excel/uploads/{id}/masters
 * Body: { mapping?: MasterFieldMapping, dryRun?: boolean }
 *
 * Bulk master upload — a chart of accounts or an item list, in whatever shape
 * the client's previous accountant left it.
 *
 * `dryRun` defaults to true, and that default is the point. This writes to the
 * chart of accounts, which everything else in the app resolves against; a bad
 * ledger group here quietly becomes the default posting account for a whole
 * client. So the first call always answers "here is what I would create and
 * what I would refuse", and only an explicit `dryRun: false` writes anything.
 *
 * Nothing is pushed to Tally from here. The rows land locally and the ordinary
 * MASTER_CREATE job carries them across on the next sync, which keeps one path
 * to Tally rather than two — and means a master created here is subject to the
 * same "Tally will not invent one" ordering as every other master.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { uploadId } = await params;

    const upload = await prisma.excelUpload.findFirst({
      where: { id: uploadId, userId: user.id, clientId: client.id },
    });
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    const kind = upload.docType;
    if (kind !== "LEDGER_MASTER" && kind !== "ITEM_MASTER") {
      return NextResponse.json(
        {
          error:
            "This upload is a transaction sheet, not a master list. Masters are uploaded as Ledgers or Items.",
        },
        { status: 400 }
      );
    }
    if (upload.status === "COMMITTED") {
      return NextResponse.json(
        { error: "These masters have already been created. Upload the sheet again to re-map." },
        { status: 409 }
      );
    }

    const sheet = decodeSheet(upload.rows);
    if (!sheet) {
      return NextResponse.json(
        { error: "The parsed rows for this upload are no longer staged. Upload the file again." },
        { status: 410 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      mapping?: MasterFieldMapping;
      dryRun?: boolean;
    };
    const mapping = body.mapping ?? suggestMasterMapping(sheet.headers, kind);
    const dryRun = body.dryRun !== false;

    if (mapping.name == null) {
      return NextResponse.json(
        {
          error:
            kind === "LEDGER_MASTER"
              ? "Say which column holds the ledger name."
              : "Say which column holds the item name.",
          mapping,
        },
        { status: 400 }
      );
    }

    // What the workspace already has, so a re-upload reports skips instead of
    // colliding on the unique index halfway through.
    const existingNames =
      kind === "LEDGER_MASTER"
        ? (
            await prisma.ledger.findMany({
              where: { userId: user.id, clientId: client.id },
              select: { name: true },
            })
          ).map((l) => l.name)
        : (
            await prisma.stockItem.findMany({
              where: { userId: user.id, clientId: client.id },
              select: { name: true },
            })
          ).map((i) => i.name);

    const result =
      kind === "LEDGER_MASTER"
        ? mapLedgerMasters(sheet, mapping, { existingNames })
        : mapItemMasters(sheet, mapping, { existingNames });

    const existingKeys = new Set(existingNames.map((n) => n.trim().toLowerCase()));
    const writable = result.rows.filter(
      (r) =>
        r.draft &&
        !r.issues.some((i) => i.severity === "error") &&
        !existingKeys.has(r.draft.name.trim().toLowerCase())
    );

    const summary = {
      kind,
      sheetName: sheet.sheetName,
      headers: sheet.headers,
      mapping,
      totalRows: sheet.rows.length,
      committableCount: result.committableCount,
      wouldCreate: writable.length,
      skipped: result.committableCount - writable.length,
      blocked: result.rows.length - result.committableCount,
      issues: result.issues.slice(0, 200),
      preview: result.rows.slice(0, PREVIEW_ROWS),
    };

    if (dryRun) return NextResponse.json({ dryRun: true, ...summary });

    if (!writable.length) {
      return NextResponse.json(
        { error: "There is nothing to create — every row is either blocked or already here.", ...summary },
        { status: 422 }
      );
    }

    let created = 0;
    if (kind === "LEDGER_MASTER") {
      for (const r of writable) {
        const d = r.draft as import("@/lib/excel/masters").LedgerMasterDraft;
        // `skipDuplicates` cannot be used with the per-row shape here, and a
        // create-many would abort the whole file on one collision. One upsert
        // per row is slower and finishes.
        await prisma.ledger.upsert({
          where: {
            userId_clientId_name: { userId: user.id, clientId: client.id, name: d.name },
          },
          create: {
            userId: user.id,
            clientId: client.id,
            name: d.name,
            group: d.group,
            ledgerType: d.ledgerType,
            parentGstin: d.gstin,
          },
          // An existing ledger is left exactly as it is. Re-uploading a chart
          // must not silently re-file a ledger someone has since corrected by
          // hand, or move a party that vouchers already post against.
          update: {},
          select: { id: true },
        });
        created++;
      }
    } else {
      for (const r of writable) {
        const d = r.draft as import("@/lib/excel/masters").ItemMasterDraft;
        await prisma.stockItem.upsert({
          where: {
            userId_clientId_name: { userId: user.id, clientId: client.id, name: d.name },
          },
          create: {
            userId: user.id,
            clientId: client.id,
            name: d.name,
            unit: d.unit,
            hsnCode: d.hsnCode,
            gstRate: d.gstRate,
            alias: d.alias,
            openingQty: d.openingQty,
            openingRate: d.openingRate,
          },
          update: {},
          select: { id: true },
        });
        created++;
      }
    }

    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: {
        status: "COMMITTED",
        committedAt: new Date(),
        // The staged grid has done its job; keeping it would pin the whole
        // sheet in the row for no further use.
        rows: Prisma.DbNull,
      },
    });

    return NextResponse.json({
      dryRun: false,
      created,
      ...summary,
      message:
        kind === "LEDGER_MASTER"
          ? `${created} ledger(s) created. They reach Tally on the next sync — nothing is pushed from here.`
          : `${created} stock item(s) created. They reach Tally on the next sync, and vouchers naming them will now move stock.`,
    });
  } catch (error) {
    console.error("[EXCEL_MASTERS]", error);
    return NextResponse.json({ error: "Failed to create the masters" }, { status: 500 });
  }
}
