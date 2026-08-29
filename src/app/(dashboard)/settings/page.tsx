import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import LedgerRuleManager from "./LedgerRuleManager";

export default async function SettingsPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;

  const ledgerSelect = {
    where: { userId: user.id, clientId: client.id },
    orderBy: [{ group: "asc" as const }, { name: "asc" as const }],
    select: { id: true, name: true, group: true, ledgerType: true, isSystem: true },
  };

  // Previously this page seeded on every load, costing a COUNT round trip even
  // when the chart of accounts was already there. The ledger list we need
  // anyway tells us whether seeding is required.
  const [seededLedgers, rules, mappingStats] = await Promise.all([
    prisma.ledger.findMany(ledgerSelect),
    prisma.mappingRule.findMany({
      // This screen manages the invoice ledger rules. Bank rules live in the
      // banking module and target their ledger by name, not by id.
      where: { userId: user.id, clientId: client.id, scope: "INVOICE" },
      orderBy: { priority: "asc" },
      include: { ledger: { select: { id: true, name: true } } },
    }),
    prisma.voucherLine.groupBy({
      by: ["mappedVia"],
      where: { voucher: { userId: user.id, clientId: client.id } },
      _count: true,
    }),
  ]);

  let ledgers = seededLedgers;
  if (ledgers.length === 0) {
    await seedLedgersForUser(prisma, user.id, client.id);
    ledgers = await prisma.ledger.findMany(ledgerSelect);
  }

  const totalMapped = mappingStats.reduce((s, m) => s + m._count, 0);
  const autoMapped = mappingStats
    .filter((m) => m.mappedVia && m.mappedVia !== "MANUAL" && m.mappedVia !== "DEFAULT")
    .reduce((s, m) => s + m._count, 0);
  const accuracy = totalMapped > 0 ? Math.round((autoMapped / totalMapped) * 100) : null;

  return (
    <LedgerRuleManager
      ledgers={ledgers}
      rules={rules.filter(
        (r): r is typeof r & { ledger: { id: string; name: string } } => !!r.ledger
      )}
      clientName={client.name}
      mappingAccuracy={accuracy}
    />
  );
}
