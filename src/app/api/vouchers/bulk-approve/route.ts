import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";

// POST /api/vouchers/bulk-approve  { voucherIds: string[] }
// Approves all eligible drafts (fully mapped + balanced); skips the rest.
export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const ids: string[] = Array.isArray(body.voucherIds) ? body.voucherIds : [];
    if (ids.length === 0) return NextResponse.json({ approved: 0, skipped: [] });

    const vouchers = await prisma.voucher.findMany({
      where: { id: { in: ids }, userId: user.id, status: "DRAFT" },
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
          partyLine.ledgerId
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
