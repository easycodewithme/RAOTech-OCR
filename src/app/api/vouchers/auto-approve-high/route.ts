import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";

/**
 * Auto-approve all DRAFT vouchers that are fully mapped, balanced,
 * and have avgConfidence >= threshold (default 0.9).
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const threshold = typeof body.threshold === "number" ? body.threshold : 0.9;

    const drafts = await prisma.voucher.findMany({
      where: {
        userId: user.id,
        clientId: client.id,
        status: "DRAFT",
        avgConfidence: { gte: threshold },
      },
      include: { lines: true, invoice: true },
    });

    let approved = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const v of drafts) {
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
          partyLine.ledgerId,
          client.id
        );
      }
      approved++;
    }

    return NextResponse.json({ approved, skipped, threshold });
  } catch (error) {
    console.error("[AUTO_APPROVE_HIGH_ERROR]", error);
    return NextResponse.json({ error: "Failed to auto-approve" }, { status: 500 });
  }
}
