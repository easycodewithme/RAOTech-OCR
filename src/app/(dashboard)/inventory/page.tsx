import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { getInventoryOverview, type StockBasis } from "@/lib/inventory/queries";
import InventoryClient from "./InventoryClient";

/**
 * Stock, as a place rather than as a settings tab.
 *
 * The item masters used to live behind Settings → Ledgers & Rules → Stock
 * Items, on the reasoning that they are a switch and not a module. That was
 * right about the masters and wrong about the stock: the app has been writing
 * quantities into a client's books with no screen that could say what those
 * quantities added up to, so the only way to check the work was to open Tally.
 * Everything needed to answer it was already in `VoucherLine`.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ basis?: string }>;
}) {
  const ctx = await getActiveClient();
  if (!ctx) redirect("/sign-in");
  const { user, client } = ctx;

  const { basis: raw } = await searchParams;
  const basis: StockBasis = raw === "ALL" ? "ALL" : "POSTED";

  const overview = await getInventoryOverview(prisma, user.id, client.id, basis);

  /**
   * The other workspaces this user keeps books for, so an item list can be
   * copied into one. Vyapar TaxOne calls this "Copy Stock Item Master" and it
   * is the one thing their Master module does that is genuinely laborious to
   * do by hand — a trader's chart of items is close to identical across two
   * companies in the same trade.
   */
  const otherClients = await prisma.client.findMany({
    // Scoped by ownership, the same way `listClientsForUser` and every other
    // client-scoped query in the app is. Widening this to ClientMember here
    // would offer a copy target that no other screen agrees the user has.
    where: { userId: user.id, id: { not: client.id } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div
      className="min-h-full p-6 md:p-10"
      style={{ background: "var(--spx-canvas)", color: "var(--spx-text)" }}
    >
      <InventoryClient
        clientName={client.name}
        basis={basis}
        otherClients={otherClients}
        items={overview.items.map((i) => {
          const p = overview.positions.get(i.id)!;
          return {
            ...i,
            tallySyncedAt: i.tallySyncedAt ? i.tallySyncedAt.toISOString() : null,
            position: { ...p, lastMovedAt: p.lastMovedAt ? p.lastMovedAt.toISOString() : null },
          };
        })}
        exceptions={overview.exceptions}
      />
    </div>
  );
}
