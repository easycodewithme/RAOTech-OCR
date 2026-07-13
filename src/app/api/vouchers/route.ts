import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { createDraftVoucherForInvoice } from "@/lib/accounting/createVoucher";
import type { VoucherType } from "@/lib/accounting/types";

export async function GET(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const confidence = url.searchParams.get("confidence"); // low | high

    const vouchers = await prisma.voucher.findMany({
      where: {
        userId: user.id,
        clientId: client.id,
        ...(status ? { status: status as any } : {}),
        ...(type ? { voucherType: type as any } : {}),
        ...(confidence === "low"
          ? { OR: [{ avgConfidence: { lt: 0.7 } }, { avgConfidence: null }] }
          : confidence === "high"
            ? { avgConfidence: { gte: 0.9 } }
            : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { id: true, vendor: true, invoiceNumber: true, isDuplicate: true } },
        lines: { select: { ledgerId: true, confidence: true } },
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

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json();
    const invoiceId = String(body.invoiceId ?? "");
    if (!invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });

    const voucher = await createDraftVoucherForInvoice(user.id, invoiceId, {
      voucherTypeOverride: body.voucherType as VoucherType | undefined,
      clientId: client.id,
    });
    return NextResponse.json({ voucher });
  } catch (error) {
    console.error("[VOUCHERS_POST_ERROR]", error);
    return NextResponse.json({ error: "Failed to create voucher" }, { status: 500 });
  }
}
