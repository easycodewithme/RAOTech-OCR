import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { createDraftVoucherForInvoice } from "@/lib/accounting/createVoucher";
import type { VoucherType } from "@/lib/accounting/types";

// GET /api/vouchers?status=DRAFT&type=PURCHASE — list vouchers for the queue
export async function GET(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");

    const vouchers = await prisma.voucher.findMany({
      where: {
        userId: user.id,
        clientId: "",
        ...(status ? { status: status as any } : {}),
        ...(type ? { voucherType: type as any } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { id: true, vendor: true, invoiceNumber: true } },
        lines: { select: { ledgerId: true } },
      },
    });

    const withFlags = vouchers.map((v) => ({
      ...v,
      hasUnmapped: v.lines.some((l) => l.ledgerId === null),
    }));
    return NextResponse.json({ vouchers: withFlags });
  } catch (error) {
    console.error("[VOUCHERS_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load vouchers" }, { status: 500 });
  }
}

// POST /api/vouchers  { invoiceId, voucherType? } — create/rebuild a DRAFT voucher
export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const invoiceId = String(body.invoiceId ?? "");
    if (!invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });

    const voucher = await createDraftVoucherForInvoice(user.id, invoiceId, {
      voucherTypeOverride: body.voucherType as VoucherType | undefined,
    });
    return NextResponse.json({ voucher });
  } catch (error) {
    console.error("[VOUCHERS_POST_ERROR]", error);
    return NextResponse.json({ error: "Failed to create voucher" }, { status: 500 });
  }
}
