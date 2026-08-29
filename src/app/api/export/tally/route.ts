import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { buildTallyXml } from "@/lib/tally/exportXml";
import { preflightVouchers, hasBlockingIssues } from "@/lib/tally/preflight";
import { withRouteLogging } from "@/lib/trace";

/**
 * POST /api/export/tally
 * Body: { voucherIds?: string[] } — if omitted, exports all APPROVED vouchers for active client.
 * Returns Tally XML download and marks vouchers EXPORTED_DEMO.
 */
async function postTallyExport(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body.voucherIds) ? body.voucherIds : undefined;

    const vouchers = await prisma.voucher.findMany({
      where: {
        userId: user.id,
        clientId: client.id,
        status: { in: ["APPROVED", "EXPORTED_DEMO"] },
        ...(ids?.length ? { id: { in: ids } } : {}),
      },
      include: {
        lines: { orderBy: { sortOrder: "asc" } },
        invoice: { select: { vendor: true, invoiceNumber: true, vendorGstin: true } },
      },
      orderBy: { date: "asc" },
    });

    if (!vouchers.length) {
      return NextResponse.json({ error: "No approved vouchers to export" }, { status: 404 });
    }

    // Tally reports import failures only in Tally.imp or an All Exceptions
    // report, so catch what we can before the file leaves here.
    const issues = preflightVouchers(
      vouchers.map((v) => ({
        id: v.id,
        date: v.date,
        invoiceNumber: v.invoice?.invoiceNumber,
        lines: v.lines.map((l) => ({
          ledgerName: l.ledgerNameSnapshot,
          debit: l.debit,
          credit: l.credit,
        })),
      }))
    );

    if (hasBlockingIssues(issues)) {
      return NextResponse.json(
        {
          error: "Some vouchers would be rejected by Tally",
          issues: issues.filter((i) => i.severity === "error"),
          warnings: issues.filter((i) => i.severity === "warning"),
        },
        { status: 422 }
      );
    }

    const ledgerIds = [
      ...new Set(vouchers.flatMap((v) => v.lines.map((l) => l.ledgerId).filter(Boolean) as string[])),
    ];
    const ledgers = await prisma.ledger.findMany({
      where: { id: { in: ledgerIds }, userId: user.id, clientId: client.id },
    });

    const xml = buildTallyXml({
      companyName: client.tallyCompany || client.name,
      ledgers: ledgers.map((l) => ({
        name: l.name,
        group: l.group,
        ledgerType: l.ledgerType,
        gstRate: l.gstRate,
        gstin: l.parentGstin,
      })),
      vouchers: vouchers.map((v) => ({
        id: v.id,
        voucherType: v.voucherType,
        date: v.date,
        narration: v.narration,
        partyName: v.invoice?.vendor,
        invoiceNumber: v.invoice?.invoiceNumber,
        lines: v.lines.map((l) => ({
          ledgerName: l.ledgerNameSnapshot || "Unknown",
          role: l.role,
          debit: l.debit,
          credit: l.credit,
          hsnCode: l.hsnCode,
          gstRate: l.gstRate,
        })),
      })),
    });

    const fileName = `tally_export_${client.name.replace(/\s+/g, "_")}_${new Date()
      .toISOString()
      .slice(0, 10)}.xml`;

    const [exportRow] = await prisma.$transaction([
      prisma.tallyExport.create({
        data: {
          userId: user.id,
          clientId: client.id,
          voucherIds: vouchers.map((v) => v.id),
          fileName,
          voucherCount: vouchers.length,
          ledgerCount: ledgers.length,
          status: "EXPORTED_DEMO",
        },
      }),
      prisma.voucher.updateMany({
        where: { id: { in: vouchers.map((v) => v.id) } },
        data: { status: "EXPORTED_DEMO", exportedAt: new Date() },
      }),
    ]);

    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "X-Export-Count": String(vouchers.length),
        "X-Export-Warnings": String(issues.length),
        // The connector reports Tally's verdict back against this id via
        // POST /api/export/tally/result. Without it the round trip cannot close.
        "X-Export-Id": exportRow.id,
        "Access-Control-Expose-Headers": "X-Export-Id, X-Export-Count, X-Export-Warnings",
      },
    });
  } catch (error) {
    console.error("[TALLY_EXPORT_ERROR]", error);
    return NextResponse.json({ error: "Tally export failed" }, { status: 500 });
  }
}

async function listTallyExports() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const exports = await prisma.tallyExport.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ exports });
  } catch (error) {
    console.error("[TALLY_EXPORT_LIST]", error);
    return NextResponse.json({ error: "Failed to list exports" }, { status: 500 });
  }
}

export const POST = withRouteLogging("api:/export/tally", "POST", postTallyExport);
export const GET = withRouteLogging("api:/export/tally", "GET", async () => listTallyExports());
