import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import TransactionsList from "./TransactionsList";

export default async function TransactionsPage() {
  const user = await getDbUser();
  if (!user) return redirect("/sign-in");

  const [vouchers, statements] = await Promise.all([
    prisma.voucher.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { vendor: true, invoiceNumber: true } },
        lines: { select: { ledgerId: true } },
      },
    }),
    prisma.bankStatement.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: { createdAt: "desc" },
      include: { txns: { select: { ledgerId: true, deposit: true, withdrawal: true } } },
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
