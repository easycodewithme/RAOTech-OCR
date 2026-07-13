import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import LedgerRuleManager from "./LedgerRuleManager";

export default async function SettingsPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;

  await seedLedgersForUser(prisma, user.id, client.id);

  const [ledgers, rules, mappingStats] = await Promise.all([
    prisma.ledger.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: { id: true, name: true, group: true, ledgerType: true, isSystem: true },
    }),
    prisma.mappingRule.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { priority: "asc" },
      include: { ledger: { select: { id: true, name: true } } },
    }),
    prisma.voucherLine.groupBy({
      by: ["mappedVia"],
      where: { voucher: { userId: user.id, clientId: client.id } },
      _count: true,
    }),
  ]);

  const totalMapped = mappingStats.reduce((s, m) => s + m._count, 0);
  const autoMapped = mappingStats
    .filter((m) => m.mappedVia && m.mappedVia !== "MANUAL" && m.mappedVia !== "DEFAULT")
    .reduce((s, m) => s + m._count, 0);
  const accuracy = totalMapped > 0 ? Math.round((autoMapped / totalMapped) * 100) : null;

  return (
    <LedgerRuleManager
      ledgers={ledgers}
      rules={rules}
      clientName={client.name}
      mappingAccuracy={accuracy}
    />
  );
}
