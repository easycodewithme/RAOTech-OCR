import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { mapRows } from "@/lib/excel/mapRows";
import { decodeSheet } from "@/lib/excel/rowStorage";
import { createDraftVoucherForInvoice } from "@/lib/accounting/createVoucher";
import type { SheetMapping } from "@/lib/excel/types";
import type { NormalizedInvoice } from "@/lib/accounting/types";

export const maxDuration = 60;

/**
 * Stop well short of `maxDuration` and hand back a continuation.
 *
 * A thousand-row sheet is a thousand invoices each needing a ledger resolution
 * and a voucher build. Rather than guess a batch size that fits, we work until
 * the budget is nearly spent and report how far we got; the client calls again.
 * Being resumable also means a dropped connection costs one batch, not the
 * whole sheet.
 */
const TIME_BUDGET_MS = 45_000;

const VOUCHER_TYPE: Record<string, "PURCHASE" | "SALE" | "CREDIT_NOTE" | "DEBIT_NOTE" | "JOURNAL"> = {
  PURCHASE: "PURCHASE",
  PURCHASE_RETURN: "DEBIT_NOTE",
  SALE: "SALE",
  SALE_RETURN: "CREDIT_NOTE",
  JOURNAL: "JOURNAL",
};

/**
 * POST /api/excel/uploads/{id}/commit
 *
 * Turns mapped rows into Invoice rows and DRAFT vouchers, then stops. From
 * here the sheet's rows are ordinary vouchers: the existing review, approve,
 * push and per-voucher Tally status screens already handle them, and there is
 * no separate spreadsheet status machine to keep in sync.
 *
 * Resumable and idempotent. A row already committed by an earlier call is
 * skipped on its invoice number, so calling this twice cannot double-post.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  const startedAt = Date.now();
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { uploadId } = await params;

    const upload = await prisma.excelUpload.findFirst({
      where: { id: uploadId, userId: user.id, clientId: client.id },
    });
    if (!upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });

    if (upload.status === "COMMITTED") {
      return NextResponse.json({
        done: true,
        committed: upload.committedRows,
        skipped: upload.skippedRows,
        message: "Already committed",
      });
    }

    const mapping = upload.mapping as unknown as SheetMapping | null;
    const sheet = decodeSheet(upload.rows);
    if (!mapping || !sheet) {
      return NextResponse.json(
        { error: "This upload has no mapping, or its rows have expired. Upload the file again." },
        { status: 409 }
      );
    }

    const ledgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: client.id },
      select: { id: true, name: true, tallyGuid: true },
    });

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
      select: { booksFrom: true, fyStart: true },
    });

    const result = mapRows(sheet, mapping, {
      userId: user.id,
      clientId: client.id,
      ledgers,
      companyStateCode: client.gstin ?? null,
      booksFrom: company?.booksFrom ?? company?.fyStart ?? null,
    });

    // Only rows that map cleanly are written. A row with a blocking issue is
    // reported and left behind rather than half-created — a half-created
    // voucher is worse than an uncreated one.
    const committable = result.rows.filter(
      (r) => r.invoice && !r.issues.some((i) => i.severity === "error")
    );

    const voucherType = VOUCHER_TYPE[mapping.docType] ?? "PURCHASE";

    // One query instead of one per row: which invoice numbers are already in.
    const numbers = committable
      .map((r) => r.invoice?.invoiceNumber)
      .filter((n): n is string => !!n);
    const existing = new Set(
      (
        await prisma.invoice.findMany({
          where: { userId: user.id, clientId: client.id, invoiceNumber: { in: numbers } },
          select: { invoiceNumber: true },
        })
      ).map((i) => i.invoiceNumber)
    );

    let committed = 0;
    let skipped = 0;
    const failures: { row: number; message: string }[] = [];
    let exhausted = false;

    for (const mapped of committable) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        exhausted = true;
        break;
      }

      const inv = mapped.invoice as NormalizedInvoice;
      if (inv.invoiceNumber && existing.has(inv.invoiceNumber)) {
        skipped++;
        continue;
      }

      try {
        const invoice = await prisma.invoice.create({
          data: {
            userId: user.id,
            clientId: client.id,
            fileUrl: `excel://${upload.id}#${mapped.row}`,
            status: "PROCESSED",
            invoiceNumber: inv.invoiceNumber,
            date: inv.date,
            vendor: inv.vendor,
            vendorGstin: inv.vendorGstin,
            customerName: inv.customerName,
            customerGstin: inv.customerGstin,
            subtotal: inv.subtotal,
            cgst: inv.cgst,
            sgst: inv.sgst,
            igst: inv.igst,
            discount: inv.discount,
            totalAmount: inv.total,
            taxAmount: inv.cgst + inv.sgst + inv.igst,
            documentType: mapping.docType,
            items: inv.items as never,
          },
          select: { id: true },
        });

        // The single accounting path. Everything a scanned bill goes through,
        // a spreadsheet row goes through too — same ledger resolution, same
        // voucher construction, same mapping memory learning from it.
        await createDraftVoucherForInvoice(user.id, invoice.id, {
          clientId: client.id,
          voucherTypeOverride: voucherType,
          partyLedgerId: mapped.partyLedgerId ?? undefined,
          // The row already produced this; re-deriving it from `extractedData`
          // would find nothing, because a spreadsheet has no OCR payload.
          normalized: inv,
          // Stage 3 of the wizard exists to choose these. Letting automatic
          // resolution win instead would discard the user's answer.
          ledgerOverrides: {
            itemLedgerId: mapping.ledgers.primaryLedgerId,
            cgstLedgerId: mapping.ledgers.cgstLedgerId,
            sgstLedgerId: mapping.ledgers.sgstLedgerId,
            igstLedgerId: mapping.ledgers.igstLedgerId,
            roundOffLedgerId: mapping.ledgers.roundOffLedgerId,
            discountLedgerId: mapping.ledgers.discountLedgerId,
          },
        });

        if (inv.invoiceNumber) existing.add(inv.invoiceNumber);
        committed++;
      } catch (err) {
        failures.push({
          row: mapped.row,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const totalCommitted = upload.committedRows + committed;
    const done = !exhausted;

    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: {
        committedRows: totalCommitted,
        skippedRows: upload.skippedRows + skipped,
        status: done ? "COMMITTED" : "READY",
        committedAt: done ? new Date() : null,
        // Once the rows are vouchers the staged grid is a second copy of the
        // same data with no owner, so drop it — but only on the final batch,
        // because a continuation still needs it. Prisma.DbNull writes a real
        // SQL NULL; a bare `null` on a Json column means "JSON null" instead.
        ...(done ? { rows: Prisma.DbNull } : {}),
      },
    });

    return NextResponse.json({
      done,
      committed: totalCommitted,
      skipped,
      failures: failures.slice(0, 50),
      remaining: done ? 0 : committable.length - committed - skipped,
      message: done
        ? `${totalCommitted} voucher${totalCommitted === 1 ? "" : "s"} created as drafts. Review and approve them, then push to Tally.`
        : "Partially committed — call again to continue.",
    });
  } catch (error) {
    console.error("[EXCEL_COMMIT]", error);
    return NextResponse.json({ error: "Failed to commit that sheet" }, { status: 500 });
  }
}
