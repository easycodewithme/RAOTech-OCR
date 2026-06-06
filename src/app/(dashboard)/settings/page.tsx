import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";
import LedgerRuleManager from "./LedgerRuleManager";

export default async function SettingsPage() {
  const user = await getDbUser();
  if (!user) return redirect("/sign-in");

  await seedLedgersForUser(prisma, user.id);

  const [ledgers, rules] = await Promise.all([
    prisma.ledger.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: [{ group: "asc" }, { name: "asc" }],
      select: { id: true, name: true, group: true, ledgerType: true, isSystem: true },
    }),
    prisma.mappingRule.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: { priority: "asc" },
      include: { ledger: { select: { id: true, name: true } } },
    }),
  ]);

  return <LedgerRuleManager ledgers={ledgers} rules={rules} />;
}
