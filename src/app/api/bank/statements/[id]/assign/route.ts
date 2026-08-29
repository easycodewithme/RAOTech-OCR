import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildBankVoucher } from "@/lib/accounting/buildBankVoucher";
import { readIds, requireStatement } from "../../../_shared";

interface AllocationInput {
  ledgerId: string;
  amount: number;
}

/**
 * POST /api/bank/statements/{id}/assign
 * Body: { txnIds, ledgerId }               — one ledger takes the whole line
 *    or { txnIds, allocations }            — the line is split across ledgers
 *    or { txnIds, classification }         — Payment / Receipt / Contra override
 *
 * Bulk by construction. `txnIds` is a list even for one row, because the way
 * this screen is actually used is "filter the grid to every row whose narration
 * says BANK CHARGES, select them all, send them all to Bank Charges" — and a
 * per-row endpoint turns that into three hundred requests.
 *
 * All or nothing. If any row's split does not total that row exactly, nothing
 * is written and every failure is reported. A half-applied bulk assignment over
 * a filtered selection is worse than a rejected one: the user cannot see which
 * half took, because the filter they were looking at has changed underneath
 * them.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireStatement(id);
    if ("error" in ctx) return ctx.error;
    const { userId, clientId, statement } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
      txnIds?: unknown;
      ledgerId?: unknown;
      allocations?: unknown;
      classification?: unknown;
    };

    const txnIds = readIds(body.txnIds);
    if (!txnIds.length) {
      return NextResponse.json({ error: "No transactions selected" }, { status: 400 });
    }

    const singleLedgerId =
      typeof body.ledgerId === "string" && body.ledgerId.trim() ? body.ledgerId.trim() : null;
    const allocations = parseAllocationInput(body.allocations);
    const classification = parseClassification(body.classification);

    if (!singleLedgerId && !allocations && classification === undefined) {
      return NextResponse.json(
        { error: "Give a ledger, a split, or a voucher type to apply." },
        { status: 400 }
      );
    }
    if (singleLedgerId && allocations) {
      return NextResponse.json(
        { error: "Send either a single ledger or a split, not both." },
        { status: 400 }
      );
    }

    const txns = await prisma.bankTxn.findMany({
      where: { id: { in: txnIds }, statementId: statement.id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        date: true,
        description: true,
        withdrawal: true,
        deposit: true,
        classification: true,
        voucherId: true,
        saved: true,
      },
    });

    if (!txns.length) {
      return NextResponse.json(
        { error: "None of those transactions belong to this statement." },
        { status: 404 }
      );
    }

    // A row that is already in Tally is not re-mapped in place. The documented
    // path — theirs and ours — is Delete From Tally first, precisely so the two
    // copies never silently disagree about what a voucher says.
    const posted = txns.filter((t) => t.voucherId).map((t) => t.id);
    if (posted.length) {
      return NextResponse.json(
        {
          error: `${posted.length} of the selected row(s) have already been built into vouchers. Delete them from Tally before re-assigning.`,
          txnIds: posted,
        },
        { status: 409 }
      );
    }

    // Every ledger named must exist in this workspace. One query, and it is the
    // authorisation check as much as the validation one.
    const wanted = allocations
      ? [...new Set(allocations.map((a) => a.ledgerId))]
      : singleLedgerId
        ? [singleLedgerId]
        : [];
    const ledgers = wanted.length
      ? await prisma.ledger.findMany({
          where: { id: { in: wanted }, userId, clientId },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(ledgers.map((l) => [l.id, l.name]));

    const missing = wanted.filter((lid) => !nameById.has(lid));
    if (missing.length) {
      return NextResponse.json(
        { error: "One of the chosen ledgers does not exist in this workspace." },
        { status: 404 }
      );
    }

    /**
     * Split validation is delegated, not reimplemented.
     *
     * `buildBankVoucher` already refuses a split that does not account for the
     * whole line, and refuses it with a sentence naming both figures. Checking
     * the sum again here would be a second implementation of the same rule that
     * could drift from the one that actually decides whether a voucher is
     * built — and the user would then be blocked at push time by a message they
     * had never seen at assign time. So the rule is run here in a dry run and
     * its own words are passed straight through.
     */
    const failures: { txnId: string; messages: string[] }[] = [];
    if (allocations) {
      for (const t of txns) {
        const { errors } = buildBankVoucher({
          date: t.date ?? new Date(),
          // Only the allocation arithmetic is under test here; the bank side is
          // irrelevant to it and may not have been chosen yet.
          bankLedgerId: statement.bankLedgerId,
          bankLedgerName: null,
          withdrawal: t.withdrawal || 0,
          deposit: t.deposit || 0,
          allocations: allocations.map((a) => ({
            ledgerId: a.ledgerId,
            ledgerName: nameById.get(a.ledgerId) ?? null,
            amount: a.amount,
          })),
          narration: t.description,
          voucherTypeOverride: classification ?? t.classification ?? undefined,
        });
        if (errors.length) failures.push({ txnId: t.id, messages: errors });
      }
    }

    if (failures.length) {
      return NextResponse.json(
        {
          error:
            failures.length === txns.length
              ? failures[0].messages[0]
              : `${failures.length} of ${txns.length} selected row(s) could not take this split.`,
          failures,
        },
        { status: 422 }
      );
    }

    const allocationJson: Prisma.InputJsonValue | null = allocations
      ? allocations.map((a) => ({
          ledgerId: a.ledgerId,
          ledgerName: nameById.get(a.ledgerId) ?? null,
          amount: a.amount,
        }))
      : null;

    const data: Prisma.BankTxnUncheckedUpdateManyInput = {};

    if (singleLedgerId) {
      data.ledgerId = singleLedgerId;
      data.ledgerNameSnapshot = nameById.get(singleLedgerId) ?? null;
      // A single ledger replaces any previous split outright. Leaving a stale
      // `allocations` array behind would win at build time — `buildVouchersForStatement`
      // prefers allocations when present — and silently ignore the ledger the
      // user just picked.
      data.allocations = Prisma.DbNull;
      data.confidence = 1;
    }

    if (allocationJson) {
      data.allocations = allocationJson;
      // The first leg stands in for the row in the grid, which is also what
      // Tally shows: "the transaction will display only one ledger initially,
      // but after transferring the entry to Tally, all split ledgers will be
      // visible".
      data.ledgerId = allocations![0].ledgerId;
      data.ledgerNameSnapshot = nameById.get(allocations![0].ledgerId) ?? null;
      data.confidence = 1;
    }

    if (classification !== undefined) {
      data.classification = classification;
    }

    /**
     * Re-assigning un-saves the row.
     *
     * Save is the gate between "chosen" and "committed", so a row whose ledger
     * changed after it was committed is no longer committed. Leaving `saved`
     * set would let a build pick up a mapping nobody has looked at since it
     * changed, which is the one thing the gate exists to prevent.
     */
    const wasSaved = txns.filter((t) => t.saved).length;
    data.saved = false;
    data.savedAt = null;

    const updated = await prisma.bankTxn.updateMany({
      where: { id: { in: txns.map((t) => t.id) }, statementId: statement.id, voucherId: null },
      data,
    });

    return NextResponse.json({
      updated: updated.count,
      unsaved: wasSaved,
      ...(wasSaved
        ? {
            warning: `${wasSaved} row(s) were already saved and have gone back to unsaved. Save them again to commit the new mapping.`,
          }
        : {}),
    });
  } catch (error) {
    console.error("[BANK_ASSIGN_POST]", error);
    return NextResponse.json({ error: "Failed to assign ledgers" }, { status: 500 });
  }
}

function parseAllocationInput(raw: unknown): AllocationInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AllocationInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const ledgerId = String(o.ledgerId ?? "").trim();
    const amount = Number(o.amount);
    if (!ledgerId || !Number.isFinite(amount)) continue;
    out.push({ ledgerId, amount });
  }
  return out.length ? out : null;
}

function parseClassification(
  raw: unknown
): "PAYMENT" | "RECEIPT" | "CONTRA" | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const up = String(raw).toUpperCase();
  if (up === "PAYMENT" || up === "RECEIPT" || up === "CONTRA") return up;
  return undefined;
}
