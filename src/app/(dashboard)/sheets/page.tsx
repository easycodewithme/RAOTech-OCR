import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import SheetWizard from "./SheetWizard";

/**
 * Thin shell. The ledger list is the one thing the wizard needs up front and
 * cannot fetch mid-flow without a flash of empty selects, so it is loaded here;
 * everything else on the screen is derived from the file the user picks.
 */
export default async function SheetsPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");

  const ledgers = await prisma.ledger.findMany({
    where: { userId: ctx.user.id, clientId: ctx.client.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, group: true },
  });

  return <SheetWizard clientName={ctx.client.name} ledgers={ledgers} />;
}
