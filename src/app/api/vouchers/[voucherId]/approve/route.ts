import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";
import { recordAuditEvent } from "@/lib/audit";
import { formatDate } from "@/lib/format";
// The same tolerance pre-flight uses. Approving a voucher that pre-flight will
// later reject strands it for good: it cannot be edited (PATCH requires DRAFT)
// and no route un-approves. See the constant's own note in preflight.ts.
import { BALANCE_EPSILON } from "@/lib/tally/preflight";

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

    // Allow re-approval if already APPROVED or EXPORTED_DEMO
    if (voucher.status === "APPROVED" || voucher.status === "EXPORTED_DEMO") {
      return NextResponse.json({ voucher });
    }

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

    if (Math.abs(voucher.totalDebit - voucher.totalCredit) > BALANCE_EPSILON) {
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

    // Approval is the gate in front of the client's live books: nothing in this
    // app un-approves, and the next thing that happens to this voucher is a
    // push. `approvedBy` already held a user id, but with one login per firm
    // that is a constant — this is the row that names the person.
    await recordAuditEvent({
      userId: user.id,
      clientId: client.id,
      action: "VOUCHER_APPROVED",
      entityType: "VOUCHER",
      entityId: voucher.id,
      // Named by its bill number where there is one, and by its date otherwise:
      // a Payment or a bank-statement voucher has no invoice behind it, and
      // "voucher 8f3c1a2e" tells a reader nothing they can act on.
      summary: `Approved ${voucher.voucherType.toLowerCase()} voucher ${
        voucher.invoice?.invoiceNumber
          ? `${voucher.invoice.invoiceNumber} `
          : `dated ${formatDate(voucher.date)} `
      }for ${client.name}`,
      metadata: {
        mode: "single",
        voucherIds: [voucher.id],
        voucherType: voucher.voucherType,
        invoiceId: voucher.invoiceId,
        invoiceNumber: voucher.invoice?.invoiceNumber ?? null,
        vendor: voucher.invoice?.vendor ?? null,
        totalDebit: voucher.totalDebit,
        avgConfidence: voucher.avgConfidence,
      },
    });

    return NextResponse.json({ voucher: approved });
  } catch (error) {
    console.error("[VOUCHER_APPROVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to approve voucher" }, { status: 500 });
  }
}