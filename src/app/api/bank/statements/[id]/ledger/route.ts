import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStatement } from "../../../_shared";

/**
 * POST /api/bank/statements/{id}/ledger
 * Body: { bankLedgerId: string | null }
 *
 * Binds the account the statement was printed from. This is the one piece of
 * information a bank import cannot infer and cannot do without: a statement row
 * shows one side of an entry, and the other side is always this ledger.
 *
 * It is bound once per statement, not per row, because that is what it is —
 * a property of the account, not of a transaction.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireStatement(id);
    if ("error" in ctx) return ctx.error;
    const { userId, clientId, statement } = ctx;

    const body = (await req.json().catch(() => ({}))) as { bankLedgerId?: unknown };
    const raw = body.bankLedgerId;

    if (raw === null || raw === "") {
      // Unbinding is allowed while nothing has been built. Once rows have
      // become vouchers the ledger is already in Tally's books and clearing it
      // here would only make the two copies disagree.
      const built = await prisma.bankTxn.count({
        where: { statementId: statement.id, voucherId: { not: null } },
      });
      if (built > 0) {
        return NextResponse.json(
          {
            error: `${built} row(s) from this statement have already been posted against the current bank ledger. Delete them from Tally before changing the account.`,
          },
          { status: 409 }
        );
      }
      await prisma.bankStatement.update({
        where: { id: statement.id },
        data: { bankLedgerId: null },
      });
      return NextResponse.json({ bankLedgerId: null, bankLedgerName: null });
    }

    const bankLedgerId = String(raw ?? "").trim();
    if (!bankLedgerId) {
      return NextResponse.json({ error: "bankLedgerId is required" }, { status: 400 });
    }

    const ledger = await prisma.ledger.findFirst({
      where: { id: bankLedgerId, userId, clientId },
      select: { id: true, name: true, group: true, ledgerType: true },
    });
    if (!ledger) {
      return NextResponse.json(
        { error: "That ledger does not exist in this workspace." },
        { status: 404 }
      );
    }

    /**
     * A ledger outside Bank Accounts / Cash-in-Hand is a warning, never a
     * block.
     *
     * Plenty of real Indian charts of accounts keep an OD or a sweep account
     * under Current Liabilities or Current Assets, and a Contra legitimately
     * targets a cash ledger. Refusing those would be a rule invented here that
     * Tally itself does not enforce. Saying "this does not look like a bank
     * account" is useful; refusing to proceed is not.
     */
    const looksRight =
      ledger.group === "BANK_ACCOUNTS" ||
      ledger.group === "CASH_IN_HAND" ||
      ledger.ledgerType === "BANK" ||
      ledger.ledgerType === "CASH";

    await prisma.bankStatement.update({
      where: { id: statement.id },
      data: { bankLedgerId: ledger.id },
    });

    return NextResponse.json({
      bankLedgerId: ledger.id,
      bankLedgerName: ledger.name,
      ...(looksRight
        ? {}
        : {
            warning: `"${ledger.name}" is not under Bank Accounts or Cash-in-Hand. That is allowed — an OD or sweep account often sits elsewhere — but check it is the account this statement was printed from.`,
          }),
    });
  } catch (error) {
    console.error("[BANK_LEDGER_POST]", error);
    return NextResponse.json({ error: "Failed to set the bank ledger" }, { status: 500 });
  }
}
