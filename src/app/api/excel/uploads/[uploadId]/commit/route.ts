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
 * Resumable. Each call re-runs the mapper over the whole sheet from row 1 and
 * skips what is already in the database, so a continuation — or a client that
 * retries after a dropped connection — does not re-post work the previous call
 * finished.
 *
 * What "already in the database" means is the sheet ROW, not the invoice
 * number. Every invoice this route writes carries `excel://{uploadId}#{row}`
 * in `fileUrl`, written in the same statement as the row itself, so it is a
 * per-row committed marker that cannot disagree with the table and needs no
 * schema change. The previous guard was `if (inv.invoiceNumber && already
 * seen)`, which meant a row with a blank invoice number — common in the
 * journal and cash-book sheets a CA firm keys from — was never deduped at all
 * and was created afresh by every continuation.
 *
 * The one guarantee this still cannot make is against two callers racing.
 * There is no unique constraint on Invoice(userId, clientId, invoiceNumber)
 * and none on fileUrl, so both the row marker and the invoice-number set are
 * read-then-write: two commits of the same upload running concurrently can
 * both see a row as uncommitted and both create it. Serial retries — which is
 * what the continuation loop and a user pressing the button again both do —
 * are safe; simultaneous ones are not.
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

    /** The row's identity in the database. See the docblock. */
    const rowKeyPrefix = `excel://${upload.id}#`;
    const rowKey = (row: number) => `${rowKeyPrefix}${row}`;

    // Two questions, two queries, each asked once for the whole sheet rather
    // than once per row:
    //
    //  1. Which rows of *this upload* has an earlier batch already written?
    //     Keyed on the row marker, so it covers rows with no invoice number.
    //     `voucher` comes along because an invoice without one is a half-done
    //     row, not a finished one — see the loop.
    //  2. Which invoice numbers already exist from *any* source? Still worth
    //     asking: it catches a row duplicating a bill keyed in by hand or
    //     committed from a different upload of the same sheet.
    const numbers = committable
      .map((r) => r.invoice?.invoiceNumber)
      .filter((n): n is string => !!n);
    const [committedRows, numbered] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          userId: user.id,
          clientId: client.id,
          fileUrl: { startsWith: rowKeyPrefix },
        },
        select: { id: true, fileUrl: true, voucher: { select: { id: true } } },
      }),
      prisma.invoice.findMany({
        where: { userId: user.id, clientId: client.id, invoiceNumber: { in: numbers } },
        select: { invoiceNumber: true },
      }),
    ]);

    const byRow = new Map(committedRows.map((i) => [i.fileUrl, i]));
    const existing = new Set(numbered.map((i) => i.invoiceNumber));

    // The single accounting path. Everything a scanned bill goes through, a
    // spreadsheet row goes through too — same ledger resolution, same voucher
    // construction, same mapping memory learning from it. Hoisted out of the
    // loop because the resume path below calls it for an invoice that already
    // exists, and the two callers must not drift apart.
    const draftVoucherFor = (
      invoiceId: string,
      inv: NormalizedInvoice,
      partyLedgerId: string | null | undefined
    ) =>
      createDraftVoucherForInvoice(user.id, invoiceId, {
        clientId: client.id,
        voucherTypeOverride: voucherType,
        partyLedgerId: partyLedgerId ?? undefined,
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
          cessLedgerId: mapping.ledgers.cessLedgerId,
        },
      });

    let committed = 0;
    let skipped = 0;
    /** Rows an earlier batch of this upload already finished. Not "skipped". */
    let alreadyCommitted = 0;
    /** Rows whose invoice existed but whose voucher did not, now completed. */
    let repaired = 0;
    /** How far down `committable` this call got, for the continuation count. */
    let seen = 0;
    const failures: { row: number; message: string }[] = [];
    /**
     * Warnings the voucher builder raised, deduplicated across rows.
     *
     * The one that matters is an item name matching no stock master: the line
     * posts as a plain ledger entry and moves no stock, silently. A sheet of
     * four hundred rows would otherwise repeat the same sentence four hundred
     * times, so identical warnings collapse and each carries how many rows hit
     * it. Reported here because this is the last moment before the user starts
     * approving — after the push it is a Tally problem, not a mapping one.
     */
    const warningCounts = new Map<string, number>();
    const noteWarnings = (ws: string[] | undefined) => {
      for (const w of ws ?? []) warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1);
    };
    let exhausted = false;

    for (const mapped of committable) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        exhausted = true;
        break;
      }
      seen++;

      const inv = mapped.invoice as NormalizedInvoice;

      const already = byRow.get(rowKey(mapped.row));
      if (already) {
        if (already.voucher) {
          alreadyCommitted++;
          continue;
        }
        // The invoice exists but its voucher does not, so an earlier batch died
        // between the two writes. They are not one transaction and cannot
        // cheaply be: voucher construction resolves ledgers and can take
        // seconds, and holding a transaction open across that on a pooled
        // connection is how this route runs out of connections. Finish the row
        // instead of skipping it forever — a marker alone would leave an
        // invoice that never appears in the transactions list, which is the
        // exact failure this route is supposed to stop having.
        try {
          noteWarnings((await draftVoucherFor(already.id, inv, mapped.partyLedgerId)).warnings);
          repaired++;
        } catch (err) {
          failures.push({
            row: mapped.row,
            message: err instanceof Error ? err.message : "Unknown error",
          });
        }
        continue;
      }

      if (inv.invoiceNumber && existing.has(inv.invoiceNumber)) {
        skipped++;
        continue;
      }

      try {
        const invoice = await prisma.invoice.create({
          data: {
            userId: user.id,
            clientId: client.id,
            fileUrl: rowKey(mapped.row),
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
            // Compensation cess. The mapper reads a cess column and the
            // voucher builder emits a CESS line from it, but this row was
            // written without it — so the books were right while every
            // dashboard total, report and GST reconciliation that reads the
            // Invoice table understated tax by exactly the cess.
            cess: inv.cess ?? null,
            discount: inv.discount,
            totalAmount: inv.total,
            taxAmount: inv.cgst + inv.sgst + inv.igst + (inv.cess ?? 0),
            documentType: mapping.docType,
            items: inv.items as never,
          },
          select: { id: true },
        });

        noteWarnings((await draftVoucherFor(invoice.id, inv, mapped.partyLedgerId)).warnings);

        if (inv.invoiceNumber) existing.add(inv.invoiceNumber);
        committed++;
      } catch (err) {
        failures.push({
          row: mapped.row,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    // Counted off the table, not accumulated across calls: the rows this
    // upload has actually written, plus what this call added. The running
    // total was only ever incremented after *both* writes succeeded, so a
    // batch that created invoices and then died — or one whose voucher build
    // failed — left the counter permanently short of the rows really there,
    // and every continuation inherited the error. This expression cannot
    // drift, because it re-derives the number every time.
    const totalCommitted = committedRows.length + committed;
    const done = !exhausted;

    await prisma.excelUpload.update({
      where: { id: upload.id },
      data: {
        committedRows: totalCommitted,
        // Assigned, not accumulated. Every call walks the sheet from row 1, so
        // `skipped` is already the absolute count of duplicate rows seen from
        // the top — adding it to the previous call's total counted the same
        // rows once per continuation and reported a skip count larger than the
        // sheet.
        skippedRows: Math.max(upload.skippedRows, skipped),
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
      alreadyCommitted,
      repaired,
      failures: failures.slice(0, 50),
      // Most frequent first: on a mixed sheet the one affecting the most rows
      // is the one worth fixing before approving anything.
      warnings: [...warningCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([message, rows]) => ({ message, rows })),
      // Rows of `committable` this call never reached. The old expression
      // subtracted only this call's own creates and skips, which on a
      // continuation ignored everything an earlier batch had done and reported
      // a remaining count larger than the work actually left.
      remaining: done ? 0 : committable.length - seen,
      message: done
        ? `${totalCommitted} voucher${totalCommitted === 1 ? "" : "s"} created as drafts. Review and approve them, then push to Tally.`
        : "Partially committed — call again to continue.",
    });
  } catch (error) {
    console.error("[EXCEL_COMMIT]", error);
    return NextResponse.json({ error: "Failed to commit that sheet" }, { status: 500 });
  }
}
