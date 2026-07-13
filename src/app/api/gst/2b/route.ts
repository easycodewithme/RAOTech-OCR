import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { parseGst2bPayload, reconcileGst2b } from "@/lib/gst/reconcile";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const uploads = await prisma.gst2bUpload.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ uploads });
  } catch (error) {
    console.error("[GST2B_LIST]", error);
    return NextResponse.json({ error: "Failed to list uploads" }, { status: 500 });
  }
}

/**
 * POST /api/gst/2b
 * Accepts JSON body: { fileName, period?, data } where data is GSTR-2B JSON or CSV string.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json();
    const fileName = body.fileName || "gstr2b.json";
    const period = body.period || null;
    const rows = parseGst2bPayload(body.data, fileName);

    if (!rows.length) {
      return NextResponse.json({ error: "No GSTR-2B rows parsed" }, { status: 400 });
    }

    // Purchase register for this client
    const books = await prisma.invoice.findMany({
      where: {
        userId: user.id,
        clientId: client.id,
        OR: [{ documentType: "PURCHASE" }, { documentType: null }, { voucher: { voucherType: "PURCHASE" } }],
      },
      select: {
        id: true,
        vendor: true,
        vendorGstin: true,
        invoiceNumber: true,
        date: true,
        subtotal: true,
        taxAmount: true,
        cgst: true,
        sgst: true,
        igst: true,
        totalAmount: true,
      },
    });

    const results = reconcileGst2b(rows, books);

    const matched = results.filter((r) => r.status === "MATCHED").length;
    const mismatched = results.filter((r) => r.status === "VALUE_MISMATCH").length;
    const missingBooks = results.filter((r) => r.status === "MISSING_IN_BOOKS").length;
    const missing2b = results.filter((r) => r.status === "MISSING_IN_2B").length;

    let itcEligible = 0;
    let itcAtRisk = 0;
    for (const r of results) {
      if (r.status === "MATCHED") {
        const row = r.gst2bIndex != null ? rows[r.gst2bIndex] : null;
        itcEligible += row?.totalTax || 0;
      } else if (r.status === "VALUE_MISMATCH" || r.status === "MISSING_IN_2B") {
        itcAtRisk += r.taxDiff || 0;
      } else if (r.status === "MISSING_IN_BOOKS") {
        itcAtRisk += r.taxDiff || 0;
      }
    }

    const upload = await prisma.$transaction(async (tx) => {
      const created = await tx.gst2bUpload.create({
        data: {
          userId: user.id,
          clientId: client.id,
          fileName,
          period,
          rowCount: rows.length,
          matched,
          mismatched,
          missingBooks,
          missing2b,
          itcEligible,
          itcAtRisk,
          rawSummary: { matched, mismatched, missingBooks, missing2b },
        },
      });

      const createdRows = await Promise.all(
        rows.map((r) =>
          tx.gst2bRow.create({
            data: {
              uploadId: created.id,
              supplierGstin: r.supplierGstin,
              supplierName: r.supplierName,
              invoiceNumber: r.invoiceNumber,
              invoiceDate: r.invoiceDate,
              taxableValue: r.taxableValue,
              igst: r.igst,
              cgst: r.cgst,
              sgst: r.sgst,
              cess: r.cess,
              totalTax: r.totalTax,
              invoiceType: r.invoiceType,
              raw: r.raw as any,
            },
          })
        )
      );

      for (const res of results) {
        await tx.gstReconMatch.create({
          data: {
            uploadId: created.id,
            gst2bRowId: res.gst2bIndex != null ? createdRows[res.gst2bIndex]?.id : null,
            invoiceId: res.invoiceId,
            status: res.status,
            taxableDiff: res.taxableDiff,
            taxDiff: res.taxDiff,
            notes: res.notes,
          },
        });
      }

      return created;
    });

    return NextResponse.json({
      upload,
      summary: { matched, mismatched, missingBooks, missing2b, itcEligible, itcAtRisk },
    });
  } catch (error) {
    console.error("[GST2B_UPLOAD]", error);
    return NextResponse.json({ error: "Failed to process GSTR-2B" }, { status: 500 });
  }
}
