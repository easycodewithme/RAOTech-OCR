import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";
import TransactionsList from "./TransactionsList";

export default async function TransactionsPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;

  const [vouchers, statements] = await Promise.all([
    prisma.voucher.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { vendor: true, invoiceNumber: true, isDuplicate: true } },
        lines: { select: { ledgerId: true } },
      },
    }),
    prisma.bankStatement.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      include: {
        txns: {
          select: { ledgerId: true, deposit: true, withdrawal: true, classification: true },
        },
      },
    }),
  ]);

  const voucherRows = vouchers.map((v) => ({
    id: v.id,
    vendor: v.invoice?.vendor ?? "Unknown",
    invoiceNumber: v.invoice?.invoiceNumber ?? "—",
    type: v.voucherType,
    amount: v.totalDebit,
    status: v.status,
    hasUnmapped: v.lines.some((l) => l.ledgerId === null),
    isDuplicate: v.invoice?.isDuplicate ?? false,
    confidence: v.avgConfidence,
  }));

  const bankRows = statements.map((s) => ({
    id: s.id,
    fileName: s.fileName,
    bankName: s.bankName,
    status: s.status,
    txnCount: s.txns.length,
    unmapped: s.txns.filter((t) => t.ledgerId === null).length,
    totalIn: s.txns.reduce((a, t) => a + (t.deposit || 0), 0),
    totalOut: s.txns.reduce((a, t) => a + (t.withdrawal || 0), 0),
  }));

  return <TransactionsList vouchers={voucherRows} statements={bankRows} />;
}
