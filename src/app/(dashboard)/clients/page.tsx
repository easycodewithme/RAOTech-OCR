import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { getPortfolio } from "@/lib/portfolio";
import PortfolioTable from "./PortfolioTable";

/**
 * All clients, ranked by what needs attention.
 *
 * Everything else in the app is scoped to the client in the switcher, which is
 * right for doing the work and useless for deciding what work to do. This is
 * the screen a firm owner opens on a Monday.
 */
export default async function ClientsPage() {
  const ctx = await getActiveClient();
  if (!ctx) redirect("/sign-in");

  const rows = await getPortfolio(ctx.user.id);

  return (
    <div
      className="min-h-full p-6 md:p-10"
      style={{ background: "var(--spx-canvas)", color: "var(--spx-text)" }}
    >
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">All clients</h1>
        <p className="mt-1 text-sm text-[var(--spx-muted)]">
          {rows.length} client{rows.length === 1 ? "" : "s"} · sorted by what needs attention, not
          alphabetically
        </p>
      </header>

      <PortfolioTable rows={rows} activeClientId={ctx.client.id} />
    </div>
  );
}
