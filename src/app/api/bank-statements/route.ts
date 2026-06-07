import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import { cleanDate, cleanMoney } from "@/lib/accounting/normalize";

// GET /api/bank-statements — list statements for the queue
export async function GET() {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const statements = await prisma.bankStatement.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: { createdAt: "desc" },
      include: { txns: { select: { id: true, ledgerId: true, withdrawal: true, deposit: true } } },
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

// POST /api/bank-statements — persist an extracted statement + its transactions
export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await seedLedgersForUser(prisma, user.id);

    const body = await req.json();
    const data = body.data ?? body; // accept {data:{...}} or flat
    const txns: any[] = Array.isArray(data.transactions) ? data.transactions : [];

    // Default the "other side" to the seeded Bank ledger
    const bankLedger = await prisma.ledger.findFirst({
      where: { userId: user.id, clientId: "", ledgerType: "BANK" },
      select: { id: true },
    });

    const statement = await prisma.bankStatement.create({
      data: {
        userId: user.id,
        clientId: "",
        fileName: body.fileName || "bank-statement",
        bankName: data.bank_name || null,
        accountNumber: data.account_number || null,
        bankLedgerId: bankLedger?.id ?? null,
        status: "DRAFT",
        txns: {
          create: txns.map((t, i) => ({
            date: t.date ? cleanDate(t.date) : null,
            description: String(t.description || "Transaction").slice(0, 500),
            refNo: t.ref || t.refNo || null,
            withdrawal: cleanMoney(t.withdrawal),
            deposit: cleanMoney(t.deposit),
            balance: t.balance != null ? cleanMoney(t.balance) : null,
            sortOrder: i,
          })),
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
