import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { saveTemplate, findTemplates } from "@/lib/excel/templates";
import type { ExcelDocType, SheetMapping } from "@/lib/excel/types";

/**
 * GET /api/excel/templates?docType=PURCHASE&headers=a,b,c
 *
 * With headers, ranks saved layouts against this sheet. Without, lists what the
 * workspace has learned.
 *
 * Templates are stored per client but searched across the whole firm: once a
 * firm has mapped one client's Tally export, every other client on the same
 * accounting package is already mapped. That cross-client reuse is the point —
 * month one with a client is expensive, months two onward should be one click.
 */
export async function GET(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const url = new URL(req.url);
    const docType = (url.searchParams.get("docType") ?? "PURCHASE") as ExcelDocType;
    const headersParam = url.searchParams.get("headers");

    if (headersParam) {
      const headers = headersParam.split(",").map((h) => h.trim()).filter(Boolean);
      const matches = await findTemplates(prisma, {
        userId: user.id,
        clientId: client.id,
        docType,
        headers,
      });
      return NextResponse.json({ templates: matches });
    }

    const templates = await prisma.mappingTemplate.findMany({
      where: { userId: user.id },
      orderBy: [{ hitCount: "desc" }, { lastUsedAt: "desc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        docType: true,
        itemMode: true,
        headers: true,
        hitCount: true,
        lastUsedAt: true,
        isBuiltIn: true,
        sourceKey: true,
        clientId: true,
        client: { select: { name: true } },
      },
    });

    return NextResponse.json({
      templates: templates.map((t) => ({
        ...t,
        // Flag the ones learned on a different client, so it is obvious when
        // reuse is crossing a client boundary.
        fromOtherClient: t.clientId !== client.id,
      })),
    });
  } catch (error) {
    console.error("[EXCEL_TEMPLATES_LIST]", error);
    return NextResponse.json({ error: "Failed to list templates" }, { status: 500 });
  }
}

/**
 * POST /api/excel/templates
 * Body: { name, docType, itemMode, headers, mapping, uploadId? }
 *
 * Remembers a mapping the user has just confirmed works.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim();
    const mapping = body.mapping as SheetMapping | undefined;
    const headers: string[] = Array.isArray(body.headers) ? body.headers.map(String) : [];

    if (!name || !mapping || !headers.length) {
      return NextResponse.json(
        { error: "name, headers and mapping are all required" },
        { status: 400 }
      );
    }

    const template = await saveTemplate(prisma, {
      userId: user.id,
      clientId: client.id,
      name,
      docType: mapping.docType,
      itemMode: mapping.itemMode,
      headers,
      mapping,
    });

    if (body.uploadId) {
      await prisma.excelUpload.updateMany({
        where: { id: String(body.uploadId), userId: user.id, clientId: client.id },
        data: { templateId: template.id },
      });
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error("[EXCEL_TEMPLATE_SAVE]", error);
    return NextResponse.json({ error: "Failed to save that template" }, { status: 500 });
  }
}
