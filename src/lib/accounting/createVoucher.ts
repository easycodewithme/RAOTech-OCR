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
  opts: {
    voucherTypeOverride?: VoucherType;
    partyLedgerId?: string | null;
    forceNewParty?: boolean;
    clientId?: string;
  } = {}
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId },
    include: { voucher: true },
  });
  if (!invoice) throw new Error("Invoice not found");

  if (invoice.voucher && invoice.voucher.status !== "DRAFT") {
    return invoice.voucher;
  }

  const clientId = opts.clientId || invoice.clientId;
  if (!clientId) throw new Error("clientId is required");

  await seedLedgersForUser(prisma, userId, clientId);

  const extracted = (invoice.extractedData as Record<string, unknown>) ?? {};
  const inv = normalizeInvoice(extracted);
  const voucherType =
    opts.voucherTypeOverride ?? classifyVoucher(inv, invoice.documentType);

  const resolved = await resolveLedgersForInvoice(prisma, userId, inv, voucherType, clientId);

  if (opts.forceNewParty) {
    resolved.party = null;
  } else if (opts.partyLedgerId) {
    const chosen = await prisma.ledger.findFirst({
      where: { id: opts.partyLedgerId, userId, clientId },
      select: { id: true, name: true },
    });
    if (chosen) {
      resolved.party = { id: chosen.id, name: chosen.name, confidence: 1, via: "MANUAL" };
    }
  }

  const draft = buildVoucher(inv, resolved, voucherType, {
    narration: invoice.invoiceNumber ? `Inv ${invoice.invoiceNumber}` : null,
  });

  const confidences = draft.lines.map((l) => l.confidence).filter((c): c is number => c != null);
  const avgConfidence =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

  const voucherFields = {
    voucherType: draft.voucherType,
    status: "DRAFT" as const,
    date: draft.date,
    narration: draft.narration,
    totalDebit: draft.totalDebit,
    totalCredit: draft.totalCredit,
    roundOff: draft.roundOff,
    avgConfidence,
  };
  const lineCreate = draft.lines.map((l) => ({
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
  }));

  const result = await prisma.$transaction(async (tx) => {
    if (invoice.voucher) {
      // Rebuild IN PLACE — keep the same voucher id so its URL and any
      // in-flight client references (e.g. after a voucher-type switch) stay
      // valid. Recreating with a new id orphaned the review page → 404.
      await tx.voucherLine.deleteMany({ where: { voucherId: invoice.voucher.id } });
      return tx.voucher.update({
        where: { id: invoice.voucher.id },
        data: { ...voucherFields, lines: { create: lineCreate } },
        include: { lines: { orderBy: { sortOrder: "asc" } } },
      });
    }
    return tx.voucher.create({
      data: {
        userId,
        clientId,
        invoiceId: invoice.id,
        ...voucherFields,
        lines: { create: lineCreate },
      },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    });
  });

  return result;
}
