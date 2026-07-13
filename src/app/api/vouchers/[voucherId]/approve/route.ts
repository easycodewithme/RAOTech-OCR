import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ voucherId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { voucherId } = await params;

    const voucher = await prisma.voucher.findFirst({
      where: { id: voucherId, userId: user.id, clientId: client.id },
      include: { lines: true, invoice: true },
    });
    if (!voucher) return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
    if (voucher.status !== "DRAFT") {
      return NextResponse.json({ error: "Voucher is not a draft" }, { status: 409 });
    }

    const unmapped = voucher.lines.filter((l) => l.ledgerId === null);
    if (unmapped.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot approve: some lines have no ledger assigned",
          unmappedRoles: unmapped.map((l) => l.role),
        },
        { status: 422 }
      );
    }

    if (Math.abs(voucher.totalDebit - voucher.totalCredit) > 0.01) {
      return NextResponse.json(
        { error: "Cannot approve: voucher is not balanced" },
        { status: 422 }
      );
    }

    const approved = await prisma.voucher.update({
      where: { id: voucherId },
      data: { status: "APPROVED", approvedAt: new Date(), approvedBy: user.id },
    });

    const partyLine = voucher.lines.find((l) => l.role === "PARTY");
    if (partyLine?.ledgerId && voucher.invoice) {
      await rememberMapping(
        prisma,
        user.id,
        { vendor: voucher.invoice.vendor, vendorGstin: normGstin(voucher.invoice.vendorGstin) },
        partyLine.ledgerId,
        client.id
      );
    }

    return NextResponse.json({ voucher: approved });
  } catch (error) {
    console.error("[VOUCHER_APPROVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to approve voucher" }, { status: 500 });
  }
}
