import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import BankMapping from "./BankMapping";

export default async function BankStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getDbUser();
  if (!user) return redirect("/sign-in");
  const { id } = await params;

  await seedLedgersForUser(prisma, user.id);

  const statement = await prisma.bankStatement.findFirst({
    where: { id, userId: user.id },
    include: { txns: { orderBy: { sortOrder: "asc" } } },
  });
  if (!statement) return notFound();

  const ledgers = await prisma.ledger.findMany({
    where: { userId: user.id, clientId: "" },
    orderBy: [{ group: "asc" }, { name: "asc" }],
    select: { id: true, name: true, group: true, ledgerType: true },
  });

  const serialized = {
    id: statement.id,
    fileName: statement.fileName,
    bankName: statement.bankName,
    accountNumber: statement.accountNumber,
    status: statement.status,
    txns: statement.txns.map((t) => ({
      id: t.id,
      date: t.date ? t.date.toISOString() : null,
      description: t.description,
      refNo: t.refNo,
      withdrawal: t.withdrawal,
      deposit: t.deposit,
      balance: t.balance,
      ledgerId: t.ledgerId,
      ledgerNameSnapshot: t.ledgerNameSnapshot,
    })),
  };

  return <BankMapping statement={serialized} ledgers={ledgers} />;
}
