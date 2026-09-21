import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { rememberMapping } from "@/lib/accounting/rememberMapping";
import { normGstin } from "@/lib/accounting/normalize";
import { recordAuditEvent, vouchersPhrase } from "@/lib/audit";
// The same tolerance pre-flight uses. Approving a voucher that pre-flight will
// later reject strands it for good: it cannot be edited (PATCH requires DRAFT)
// and no route un-approves. See the constant's own note in preflight.ts.
import { BALANCE_EPSILON } from "@/lib/tally/preflight";

const DEFAULT_THRESHOLD = 0.9;

/**
 * The floor under the caller-supplied threshold.
 *
 * `{"threshold": 0}` used to mean "approve every draft this client has",
 * because `avgConfidence >= 0` matches everything including vouchers we barely
 * read. Nothing un-approves a voucher, so that single request was irreversible
 * through the UI — an accountant would have to walk the client's whole ledger
 * to find what had been waved through. The route is called auto-approve-*high*;
 * anything under this is not a threshold, it is a bulk approve wearing one.
 */
const MIN_THRESHOLD = 0.5;

/**
 * Ceiling on one call. A first import can leave hundreds of drafts, and this
 * loop writes a row and a mapping memory per voucher; more importantly a large
 * unreviewed batch is exactly what nobody can undo. Whatever is left over is
 * reported, not silently dropped, so the caller can simply run it again.
 */
const MAX_PER_CALL = 200;

/**
 * Auto-approve DRAFT vouchers that are fully mapped, balanced, and have
 * avgConfidence >= threshold (default 0.9, never below MIN_THRESHOLD),
 * at most MAX_PER_CALL of them per request.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const raw = body.threshold;

    if (raw !== undefined && raw !== null && (typeof raw !== "number" || !Number.isFinite(raw))) {
      return NextResponse.json(
        { error: "threshold must be a number between 0.5 and 1." },
        { status: 400 }
      );
    }

    const threshold = typeof raw === "number" ? raw : DEFAULT_THRESHOLD;

    // Rejected rather than quietly clamped: a caller who asked for 0 believes
    // they are approving everything, and silently approving a *different* set
    // than the one they asked for is its own surprise. Tell them the limit.
    if (threshold < MIN_THRESHOLD) {
      return NextResponse.json(
        {
          error: `threshold ${threshold} is below the minimum of ${MIN_THRESHOLD}. This route only approves high-confidence drafts, and approving one cannot be undone — review the rest by hand or in bulk-approve.`,
          minThreshold: MIN_THRESHOLD,
        },
        { status: 400 }
      );
    }

    const where = {
      userId: user.id,
      clientId: client.id,
      status: "DRAFT" as const,
      avgConfidence: { gte: threshold },
    };

    const matching = await prisma.voucher.count({ where });
    const drafts = await prisma.voucher.findMany({
      where,
      include: { lines: true, invoice: true },
      // Oldest first, so repeated calls chew through the backlog in a
      // predictable order instead of re-considering the same page.
      orderBy: { createdAt: "asc" },
      take: MAX_PER_CALL,
    });
    const skippedOverCap = Math.max(0, matching - drafts.length);

    let approved = 0;
    const approvedIds: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const v of drafts) {
      if (v.lines.some((l) => l.ledgerId === null)) {
        skipped.push({ id: v.id, reason: "unmapped lines" });
        continue;
      }
      if (Math.abs(v.totalDebit - v.totalCredit) > BALANCE_EPSILON) {
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
      approvedIds.push(v.id);
      approved++;
    }

    // The single most audit-worthy thing in this product: a batch nobody read,
    // waved through on a confidence score, which nothing in the app can undo.
    // The threshold goes in the summary rather than only in metadata, because
    // "approved at 0.5" and "approved at 0.95" are different decisions and a
    // firm owner should not have to open a row to tell them apart.
    if (approved > 0) {
      await recordAuditEvent({
        userId: user.id,
        clientId: client.id,
        action: "VOUCHER_APPROVED",
        entityType: "VOUCHER",
        entityId: approvedIds.length === 1 ? approvedIds[0] : null,
        summary: `Auto-approved ${vouchersPhrase(
          approved
        )} for ${client.name} at confidence ${threshold} and above`,
        metadata: {
          mode: "auto-high-confidence",
          threshold,
          approvedCount: approved,
          voucherIds: approvedIds,
          matchingCount: matching,
          skipped,
          // Left for the next call rather than approved — recorded so the trail
          // does not read as a clean sweep when it was not one.
          skippedOverCap,
          cap: MAX_PER_CALL,
        },
      });
    }

    return NextResponse.json({
      approved,
      skipped,
      threshold,
      // Left for the next call rather than approved: the caller sees the
      // backlog is not empty instead of assuming a clean sweep.
      skippedOverCap,
      cap: MAX_PER_CALL,
    });
  } catch (error) {
    console.error("[AUTO_APPROVE_HIGH_ERROR]", error);
    return NextResponse.json({ error: "Failed to auto-approve" }, { status: 500 });
  }
}
