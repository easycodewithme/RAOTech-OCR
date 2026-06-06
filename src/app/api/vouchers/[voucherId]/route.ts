import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { createDraftVoucherForInvoice } from "@/lib/accounting/createVoucher";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";
import type { VoucherType } from "@/lib/accounting/types";

async function loadOwnedVoucher(userId: string, voucherId: string) {
  return prisma.voucher.findFirst({
    where: { id: voucherId, userId },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      invoice: true,
    },
  });
}

// GET /api/vouchers/[voucherId]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ voucherId: string }> }
) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { voucherId } = await params;

    const voucher = await loadOwnedVoucher(user.id, voucherId);
    if (!voucher) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });

    return NextResponse.json({
      voucher: { ...voucher, hasUnmapped: voucher.lines.some((l) => l.ledgerId === null) },
    });
  } catch (error) {
    console.error("[VOUCHER_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load voucher" }, { status: 500 });
  }
}

/**
 * PATCH /api/vouchers/[voucherId]
 *  - { voucherType }            -> rebuild the draft with a new type
 *  - { lines: [{id, ledgerId}], narration? } -> remap line ledgers (MANUAL),
 *    remembering the party mapping for future invoices.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ voucherId: string }> }
) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { voucherId } = await params;

    const voucher = await loadOwnedVoucher(user.id, voucherId);
    if (!voucher) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") {
      return NextResponse.json({ error: "Only draft vouchers can be edited" }, { status: 409 });
    }

    const body = await req.json();

    // Mode 1: change the voucher type -> full rebuild
    if (body.voucherType) {
      const rebuilt = await createDraftVoucherForInvoice(user.id, voucher.invoiceId, {
        voucherTypeOverride: body.voucherType as VoucherType,
      });
      return NextResponse.json({ voucher: rebuilt });
    }

    // Mode 2: remap line ledgers
    const lineUpdates: Array<{ id: string; ledgerId: string | null }> = body.lines ?? [];
    const validLineIds = new Set(voucher.lines.map((l) => l.id));

    // Cache ledger names for snapshots and validate ownership
    const requestedLedgerIds = lineUpdates
      .map((u) => u.ledgerId)
      .filter((id): id is string => !!id);
    const ledgers = requestedLedgerIds.length
      ? await prisma.ledger.findMany({
          where: { id: { in: requestedLedgerIds }, userId: user.id },
          select: { id: true, name: true },
        })
      : [];
    const ledgerById = new Map(ledgers.map((l) => [l.id, l.name]));

    await prisma.$transaction(async (tx) => {
      for (const u of lineUpdates) {
        if (!validLineIds.has(u.id)) continue;
        if (u.ledgerId && !ledgerById.has(u.ledgerId)) continue;
        await tx.voucherLine.update({
          where: { id: u.id },
          data: {
            ledgerId: u.ledgerId,
            ledgerNameSnapshot: u.ledgerId ? ledgerById.get(u.ledgerId) ?? null : null,
            mappedVia: u.ledgerId ? "MANUAL" : null,
            confidence: u.ledgerId ? 1 : null,
          },
        });
      }
      if (body.narration !== undefined) {
        await tx.voucher.update({
          where: { id: voucherId },
          data: { narration: body.narration },
        });
      }
    });

    // Remember the party mapping so future invoices auto-map
    const partyLine = voucher.lines.find((l) => l.role === "PARTY");
    const partyUpdate = lineUpdates.find((u) => u.id === partyLine?.id);
    if (partyUpdate?.ledgerId && voucher.invoice) {
      await rememberMapping(
        prisma,
        user.id,
        {
          vendor: voucher.invoice.vendor,
          vendorGstin: normGstin(voucher.invoice.vendorGstin),
        },
        partyUpdate.ledgerId
      );
    }

    const updated = await loadOwnedVoucher(user.id, voucherId);
    return NextResponse.json({
      voucher: { ...updated, hasUnmapped: updated!.lines.some((l) => l.ledgerId === null) },
    });
  } catch (error) {
    console.error("[VOUCHER_PATCH_ERROR]", error);
    return NextResponse.json({ error: "Failed to update voucher" }, { status: 500 });
  }
}
