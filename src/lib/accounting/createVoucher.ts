import { prisma } from "@/lib/prisma";
import { normalizeInvoice } from "./normalize";
import { classifyVoucher } from "./classifyVoucher";
import { resolveLedgersForInvoice } from "./resolveLedger";
import { buildVoucher } from "./buildVoucher";
import { seedLedgersForUser } from "./seedLedgers";
import type { VoucherType } from "./types";

/**
 * Build and persist a DRAFT voucher for an invoice (single workspace).
 *
 * - Seeds the standard chart of accounts on first use.
 * - Idempotent for drafts: an existing DRAFT voucher is rebuilt; an APPROVED /
 *   POSTED voucher is left untouched and returned as-is.
 * - Best-effort caller contract: throws on hard errors; callers that wrap the
 *   invoice-save flow should catch so OCR save never fails because of this.
 */
export async function createDraftVoucherForInvoice(
  userId: string,
  invoiceId: string,
  opts: { voucherTypeOverride?: VoucherType } = {}
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
    include: { voucher: true },
  });
  if (!invoice) throw new Error("Invoice not found");

  if (invoice.voucher && invoice.voucher.status !== "DRAFT") {
    return invoice.voucher; // don't disturb approved/posted vouchers
  }

  // Ensure the chart of accounts exists for this workspace
  await seedLedgersForUser(prisma, userId);

  const extracted = (invoice.extractedData as Record<string, unknown>) ?? {};
  const inv = normalizeInvoice(extracted);
  const voucherType =
    opts.voucherTypeOverride ?? classifyVoucher(inv, invoice.documentType);

  const resolved = await resolveLedgersForInvoice(prisma, userId, inv, voucherType);
  const draft = buildVoucher(inv, resolved, voucherType, {
    narration: invoice.invoiceNumber ? `Inv ${invoice.invoiceNumber}` : null,
  });

  // Replace any existing DRAFT voucher for this invoice
  const result = await prisma.$transaction(async (tx) => {
    if (invoice.voucher) {
      await tx.voucherLine.deleteMany({ where: { voucherId: invoice.voucher.id } });
      await tx.voucher.delete({ where: { id: invoice.voucher.id } });
    }
    return tx.voucher.create({
      data: {
        userId,
        clientId: "",
        invoiceId: invoice.id,
        voucherType: draft.voucherType,
        status: "DRAFT",
        date: draft.date,
        narration: draft.narration,
        totalDebit: draft.totalDebit,
        totalCredit: draft.totalCredit,
        roundOff: draft.roundOff,
        lines: {
          create: draft.lines.map((l) => ({
            ledgerId: l.ledgerId,
            ledgerNameSnapshot: l.ledgerNameSnapshot,
            role: l.role,
            debit: l.debit,
            credit: l.credit,
            confidence: l.confidence,
            mappedVia: l.mappedVia,
            hsnCode: l.hsnCode,
            gstRate: l.gstRate,
            sortOrder: l.sortOrder,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  return result;
}
