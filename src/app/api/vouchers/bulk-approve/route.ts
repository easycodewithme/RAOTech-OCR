import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json();
    const ids: string[] = Array.isArray(body.voucherIds) ? body.voucherIds : [];
    if (ids.length === 0) return NextResponse.json({ approved: 0, skipped: [] });

    const vouchers = await prisma.voucher.findMany({
      where: { id: { in: ids }, userId: user.id, clientId: client.id, status: "DRAFT" },
      include: { lines: true, invoice: true },
    });

    let approved = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const v of vouchers) {
      if (v.lines.some((l) => l.ledgerId === null)) {
        skipped.push({ id: v.id, reason: "unmapped lines" });
        continue;
      }
      if (Math.abs(v.totalDebit - v.totalCredit) > 0.01) {
        skipped.push({ id: v.id, reason: "unbalanced" });
        continue;
      }
      // Auto-approve high confidence if requested
      if (body.onlyHighConfidence && (v.avgConfidence ?? 0) < 0.9) {
        skipped.push({ id: v.id, reason: "low confidence" });
        continue;
      }
      await prisma.voucher.update({
        where: { id: v.id },
        data: { status: "APPROVED", approvedAt: new Date(), approvedBy: user.id },
      });
      const partyLine = v.lines.find((l) => l.role === "PARTY");
      if (partyLine?.ledgerId && v.invoice) {
        await rememberMapping(
          prisma,
          user.id,
          { vendor: v.invoice.vendor, vendorGstin: normGstin(v.invoice.vendorGstin) },
          partyLine.ledgerId,
          client.id
        );
      }
      approved++;
    }

    return NextResponse.json({ approved, skipped });
  } catch (error) {
    console.error("[VOUCHER_BULK_APPROVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to bulk approve" }, { status: 500 });
  }
}
