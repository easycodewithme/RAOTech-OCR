import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAllocations } from "@/lib/bank/bankVouchers";
import { rememberNarrationMappings } from "@/lib/accounting/rememberMapping";
import { readIds, requireStatement } from "../../../_shared";

/**
 * POST /api/bank/statements/{id}/save
 * Body: { txnIds, saved?: boolean }
 *
 * The gate between "I have chosen a ledger for this row" and "this row is ready
 * to become a voucher".
 *
 * Two separate clicks, on purpose. An accountant works down a three-hundred-row
 * statement across a session, gets halfway, and comes back tomorrow — and a
 * half-assigned statement must be resumable without anything having been
 * posted. Collapsing save into assign would mean every stray click on a ledger
 * dropdown queues something for Tally.
 *
 * Saving is also when the narration memory learns, because saving is the point
 * at which the user has actually vouched for the mapping.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireStatement(id);
    if ("error" in ctx) return ctx.error;
    const { userId, clientId, statement } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
      txnIds?: unknown;
      saved?: unknown;
    };
    const txnIds = readIds(body.txnIds);
    const saving = body.saved !== false;

    if (!txnIds.length) {
      return NextResponse.json({ error: "No transactions selected" }, { status: 400 });
    }

    const txns = await prisma.bankTxn.findMany({
      where: { id: { in: txnIds }, statementId: statement.id },
      select: {
        id: true,
        description: true,
        ledgerId: true,
        allocations: true,
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

    // Un-saving a row that is already a voucher would claim it is uncommitted
    // while it sits in Tally's books. Refuse; the way back is Delete From Tally.
    const built = txns.filter((t) => t.voucherId).map((t) => t.id);
    if (!saving && built.length) {
      return NextResponse.json(
        {
          error: `${built.length} of the selected row(s) are already vouchers and cannot be un-saved. Delete them from Tally first.`,
          txnIds: built,
        },
        { status: 409 }
      );
    }

    if (!saving) {
      const cleared = await prisma.bankTxn.updateMany({
        where: { id: { in: txns.map((t) => t.id) }, statementId: statement.id, voucherId: null },
        data: { saved: false, savedAt: null },
      });
      return NextResponse.json({ saved: 0, unsaved: cleared.count, blocked: [] });
    }

    /**
     * "Once a ledger is selected and saved, it cannot be left empty."
     *
     * That is the competitor's rule (`re-select-ledgers-in-bank-statement.md`)
     * and it is the right one: a saved row with no ledger would sail through
     * the gate and be refused later by `buildBankVoucher` with "No ledger has
     * been chosen for this line" — after the user believed the work was done.
     * Catching it here means the blocked rows are named while the user is still
     * looking at them.
     */
    const blocked = txns
      .filter((t) => !t.ledgerId && parseAllocations(t.allocations).length === 0)
      .map((t) => t.id);

    const ready = txns.filter((t) => !blocked.includes(t.id));
    if (!ready.length) {
      return NextResponse.json(
        {
          error:
            "None of the selected rows have a ledger yet. Choose one — or split the line across several — before saving.",
          blocked,
        },
        { status: 422 }
      );
    }

    const now = new Date();
    const updated = await prisma.bankTxn.updateMany({
      where: { id: { in: ready.map((t) => t.id) }, statementId: statement.id },
      data: { saved: true, savedAt: now },
    });

    /**
     * Learn the narration.
     *
     * `rememberNarrationMappings` is the single writer, and it keys on the same
     * `narrationKey` the reader asks with — which was not true until recently:
     * the writer used plain `normName` and everything it learned was invisible
     * to `suggestLedgerFromNarrationMemory`. It also deduplicates, so a bulk
     * save of a hundred rows sharing one narration shape counts as the one
     * human decision it was rather than inflating the confidence weight.
     */
    const learned = await rememberNarrationMappings(
      prisma,
      userId,
      clientId,
      ready
        .filter((t) => t.ledgerId)
        .map((t) => ({ narration: t.description, ledgerId: t.ledgerId as string }))
    );

    return NextResponse.json({
      saved: updated.count,
      blocked,
      learned,
      ...(blocked.length
        ? {
            warning: `${blocked.length} row(s) were skipped because they still have no ledger. A saved row cannot be left empty.`,
          }
        : {}),
    });
  } catch (error) {
    console.error("[BANK_SAVE_POST]", error);
    return NextResponse.json({ error: "Failed to save transactions" }, { status: 500 });
  }
}
