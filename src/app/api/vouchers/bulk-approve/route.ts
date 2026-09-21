import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";
import { withRouteLogging } from "@/lib/trace";
import { recordAuditEvent, vouchersPhrase } from "@/lib/audit";
// The same tolerance pre-flight uses. Approving a voucher that pre-flight will
// later reject strands it for good: it cannot be edited (PATCH requires DRAFT)
// and no route un-approves. See the constant's own note in preflight.ts.
import { BALANCE_EPSILON } from "@/lib/tally/preflight";

async function bulkApprove(req: Request) {
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
    const approvedIds: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const v of vouchers) {
      if (v.lines.some((l) => l.ledgerId === null)) {
        skipped.push({ id: v.id, reason: "unmapped lines" });
        continue;
      }
      if (Math.abs(v.totalDebit - v.totalCredit) > BALANCE_EPSILON) {
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
      approvedIds.push(v.id);
      approved++;
    }

    // One event for the batch, not one per voucher. Two hundred identical rows
    // would bury the delete that happened underneath them and teach a firm
    // owner to stop reading the screen; one row says the truer thing — that in
    // a single action someone approved two hundred vouchers. The ids are kept
    // in metadata, so nothing is lost, only folded.
    //
    // Skipped when nothing was approved: a request that changed no books is not
    // an event, and writing it would fill the trail with noise from a UI that
    // re-sends the same selection.
    if (approved > 0) {
      await recordAuditEvent({
        userId: user.id,
        clientId: client.id,
        action: "VOUCHER_APPROVED",
        entityType: "VOUCHER",
        // Null for a batch: `entityId` answers "what happened to *this* row",
        // and a batch is not one row. Except when the batch was one.
        entityId: approvedIds.length === 1 ? approvedIds[0] : null,
        summary: `Approved ${vouchersPhrase(approved)} for ${client.name}`,
        metadata: {
          mode: body.onlyHighConfidence ? "bulk-high-confidence" : "bulk",
          approvedCount: approved,
          voucherIds: approvedIds,
          requestedCount: ids.length,
          // Why the rest did not go through, so the row explains a partial
          // batch without anyone re-running it to find out.
          skipped,
        },
      });
    }

    return NextResponse.json({ approved, skipped });
  } catch (error) {
    console.error("[VOUCHER_BULK_APPROVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to bulk approve" }, { status: 500 });
  }
}

export const POST = withRouteLogging("api:/vouchers/bulk-approve", "POST", bulkApprove);
