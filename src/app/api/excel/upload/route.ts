import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { listSheets, parseSheet, ExcelParseError } from "@/lib/excel/parse";
import { headerFingerprint } from "@/lib/excel/detectHeader";
import { detectLayout } from "@/lib/excel/detectLayout";
import { suggestMapping } from "@/lib/excel/suggestMapping";
import { suggestMasterMapping } from "@/lib/excel/masters";
import { findTemplates } from "@/lib/excel/templates";
import { encodeSheet } from "@/lib/excel/rowStorage";
import { MAX_ROWS, type ExcelDocType, type ItemMode } from "@/lib/excel/types";

/** Parsing a large workbook is CPU-bound and can outrun the default budget. */
export const maxDuration = 60;

/** Enough for a 20,000-row export with room to spare; a guard, not a target. */
const MAX_BYTES = 25 * 1024 * 1024;

const DOC_TYPES: ExcelDocType[] = [
  "PURCHASE",
  "PURCHASE_RETURN",
  "SALE",
  "SALE_RETURN",
  "JOURNAL",
  "LEDGER_MASTER",
  "ITEM_MASTER",
];

/** The two that produce masters rather than vouchers. */
const MASTER_TYPES: ExcelDocType[] = ["LEDGER_MASTER", "ITEM_MASTER"];

/**
 * POST /api/excel/upload
 * multipart: file, docType, itemMode?, sheetName?
 *
 * Parses the sheet and returns everything the wizard needs to open on a
 * pre-filled mapping rather than an empty one: detected header row, detected
 * tax layout, a suggested column mapping, and any saved template that matches
 * this header shape.
 *
 * Nothing is committed here. The parsed grid is staged on the upload record so
 * the user can adjust the mapping and re-preview without re-uploading.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_BYTES / 1024 / 1024} MB — split it into smaller sheets and upload them separately.`,
        },
        { status: 413 }
      );
    }

    const docTypeRaw = String(form.get("docType") ?? "PURCHASE") as ExcelDocType;
    const docType = DOC_TYPES.includes(docTypeRaw) ? docTypeRaw : "PURCHASE";
    const itemMode = (String(form.get("itemMode") ?? "WITHOUT_ITEM") === "WITH_ITEM"
      ? "WITH_ITEM"
      : "WITHOUT_ITEM") as ItemMode;
    const requestedSheet = form.get("sheetName");

    const buffer = Buffer.from(await file.arrayBuffer());

    let sheets, parsed;
    try {
      sheets = await listSheets(buffer, file.name);
      parsed = await parseSheet(buffer, {
        fileName: file.name,
        sheetName: typeof requestedSheet === "string" && requestedSheet ? requestedSheet : undefined,
      });
    } catch (err) {
      // Parse failures are the user's problem to fix, not a server fault, and
      // the message is written to be actionable. Anything else is ours.
      if (err instanceof ExcelParseError) {
        return NextResponse.json({ error: err.message }, { status: 422 });
      }
      throw err;
    }

    if (!parsed.rows.length) {
      return NextResponse.json(
        {
          error:
            "No data rows found below the header. Check that the sheet has content and that the header row is not the last row.",
        },
        { status: 422 }
      );
    }

    const fingerprint = headerFingerprint(parsed.headers);
    const isMaster = MASTER_TYPES.includes(docType);

    /**
     * A master sheet skips layout detection and the invoice mapper entirely.
     *
     * `detectLayout` is looking for wide-vs-long GST columns and `suggestMapping`
     * for party / taxable / tax / total — a chart of accounts has none of those,
     * and feeding one through produced confident nonsense: "Opening Balance"
     * mapped to the invoice total, "Under" to the party name. A wrong guess that
     * looks certain is worse than no guess, so masters get their own mapper.
     */
    const layout = isMaster ? null : detectLayout(parsed.headers);
    // Scoring the sampled cells, not just the header text, is what catches a
    // GSTIN column called "Tax ID" and rejects a "Date" column holding serials.
    const suggested =
      isMaster || !layout
        ? null
        : suggestMapping(parsed.headers, layout, docType, itemMode, {
            sampleRows: parsed.rows.slice(0, 50),
            headerRowIndex: parsed.headerRowIndex,
          });
    const masterMapping = isMaster
      ? suggestMasterMapping(parsed.headers, docType as "LEDGER_MASTER" | "ITEM_MASTER")
      : null;
    const templates = isMaster
      ? []
      : await findTemplates(prisma, {
          userId: user.id,
          clientId: client.id,
          docType,
          headers: parsed.headers,
        });

    const upload = await prisma.excelUpload.create({
      data: {
        userId: user.id,
        clientId: client.id,
        fileName: file.name,
        sheetName: parsed.sheetName,
        docType,
        itemMode,
        headerRowIndex: parsed.headerRowIndex,
        headers: parsed.headers,
        headerFingerprint: fingerprint,
        totalRows: parsed.rows.length,
        status: "MAPPING",
        rows: encodeSheet(parsed) as never,
      },
      select: { id: true, fileName: true, sheetName: true, totalRows: true },
    });

    return NextResponse.json({
      upload,
      sheets,
      headers: parsed.headers,
      headerRowIndex: parsed.headerRowIndex,
      droppedRows: parsed.droppedRowIndexes.length,
      totalRows: parsed.rows.length,
      maxRows: MAX_ROWS,
      layout,
      isMaster,
      /** Populated for master sheets; the invoice mapper is skipped for those. */
      masterMapping,
      suggestedMapping: suggested?.mapping ?? null,
      /** Per-field confidence and reasoning, so a guess can be questioned. */
      suggestionDetail: suggested
        ? {
            fields: suggested.fields,
            unmappedColumns: suggested.unmappedColumns,
            overall: suggested.overall,
          }
        : null,
      templates,
      /** A window on the real data, so the user can sanity-check the mapping. */
      preview: parsed.rows.slice(0, 20),
    });
  } catch (error) {
    console.error("[EXCEL_UPLOAD]", error);
    return NextResponse.json({ error: "Failed to read that spreadsheet" }, { status: 500 });
  }
}
