import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import { cleanDate, cleanMoney } from "@/lib/accounting/normalize";
import {
  classifyBankTxn,
  narrationKey,
  suggestLedgerFromNarrationMemory,
} from "@/lib/bank/classify";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const statements = await prisma.bankStatement.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      include: {
        txns: {
          select: {
            id: true,
            ledgerId: true,
            withdrawal: true,
            deposit: true,
            classification: true,
          },
        },
      },
    });

    const rows = statements.map((s) => ({
      id: s.id,
      fileName: s.fileName,
      bankName: s.bankName,
      accountNumber: s.accountNumber,
      status: s.status,
      txnCount: s.txns.length,
      unmapped: s.txns.filter((t) => t.ledgerId === null).length,
      totalIn: s.txns.reduce((a, t) => a + (t.deposit || 0), 0),
      totalOut: s.txns.reduce((a, t) => a + (t.withdrawal || 0), 0),
    }));
    return NextResponse.json({ statements: rows });
  } catch (error) {
    console.error("[BANK_LIST_ERROR]", error);
    return NextResponse.json({ error: "Failed to load statements" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    await seedLedgersForUser(prisma, user.id, client.id);

    const body = await req.json();
    const data = body.data ?? body;
    const txns: any[] = Array.isArray(data.transactions) ? data.transactions : [];

    const bankLedger = await prisma.ledger.findFirst({
      where: { userId: user.id, clientId: client.id, ledgerType: "BANK" },
      select: { id: true },
    });

    // Load narration memory for suggestions
    const narrMappings = await prisma.ledgerMapping.findMany({
      where: { userId: user.id, clientId: client.id, matchType: "NARRATION" },
      select: {
        matchKey: true,
        hitCount: true,
        ledger: { select: { id: true, name: true } },
      },
    });
    const memory: Record<string, { ledgerId: string; ledgerName: string; hitCount: number }> = {};
    for (const m of narrMappings) {
      memory[m.matchKey] = {
        ledgerId: m.ledger.id,
        ledgerName: m.ledger.name,
        hitCount: m.hitCount,
      };
    }

    const statement = await prisma.bankStatement.create({
      data: {
        userId: user.id,
        clientId: client.id,
        fileName: body.fileName || "bank-statement",
        bankName: data.bank_name || null,
        accountNumber: data.account_number || null,
        bankLedgerId: bankLedger?.id ?? null,
        status: "DRAFT",
        txns: {
          create: txns.map((t, i) => {
            const withdrawal = cleanMoney(t.withdrawal);
            const deposit = cleanMoney(t.deposit);
            const desc = String(t.description || "Transaction").slice(0, 500);
            const { classification, confidence } = classifyBankTxn({
              description: desc,
              withdrawal,
              deposit,
            });
            const suggestion = suggestLedgerFromNarrationMemory(desc, memory);
            return {
              date: t.date ? cleanDate(t.date) : null,
              description: desc,
              refNo: t.ref || t.refNo || null,
              withdrawal,
              deposit,
              balance: t.balance != null ? cleanMoney(t.balance) : null,
              classification,
              confidence: suggestion?.confidence ?? confidence,
              ledgerId: suggestion?.ledgerId ?? null,
              ledgerNameSnapshot: suggestion?.ledgerName ?? null,
              sortOrder: i,
            };
          }),
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ statementId: statement.id });
  } catch (error) {
    console.error("[BANK_SAVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to save statement" }, { status: 500 });
  }
}
