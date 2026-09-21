import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { getItemLedger } from "@/lib/inventory/queries";
import ItemLedgerView from "./ItemLedgerView";

/**
 * One item's movement, in the order it happened.
 *
 * The summary answers "how much is left". This answers "why", which is the
 * question that actually gets asked — a closing balance that looks wrong is
 * only actionable once you can see the entry that made it wrong, and until now
 * that meant a Tally stock voucher report on the client's machine.
 */
export default async function ItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const ctx = await getActiveClient();
  if (!ctx) redirect("/sign-in");
  const { user, client } = ctx;

  const { itemId } = await params;
  const data = await getItemLedger(prisma, user.id, client.id, itemId);
  if (!data) notFound();

  return (
    <div
      className="min-h-full p-6 md:p-10"
      style={{ background: "var(--spx-canvas)", color: "var(--spx-text)" }}
    >
      <ItemLedgerView
        clientName={client.name}
        item={{
          ...data.item,
          tallySyncedAt: data.item.tallySyncedAt ? data.item.tallySyncedAt.toISOString() : null,
        }}
        position={{
          ...data.position,
          lastMovedAt: data.position.lastMovedAt
            ? data.position.lastMovedAt.toISOString()
            : null,
        }}
        rows={data.rows.map((r) => ({ ...r, date: r.date.toISOString() }))}
      />
    </div>
  );
}
