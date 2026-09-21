import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient, listClientsForUser } from "@/lib/clientContext";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS } from "@/lib/audit";
import ActivityFeed from "./ActivityFeed";

/**
 * The firm owner's activity trail (REL-01).
 *
 * Deliberately NOT scoped to the client in the switcher. Every other screen in
 * this app is, because every other screen is about doing the work for one
 * client; this one exists to answer "what has been done to any of my clients'
 * books, and by whom" — a question an owner will not ask if answering it means
 * switching workspace twelve times.
 *
 * The first page is read here rather than fetched from `/api/audit`, so the
 * screen arrives populated instead of flashing a spinner at someone who opened
 * it to check something. Filtering and paging from there go through the API,
 * which applies exactly the same firm-level scope.
 */

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function ActivityPage() {
  const ctx = await getActiveClient();
  if (!ctx) redirect("/sign-in");

  const [clients, rows] = await Promise.all([
    listClientsForUser(ctx.user.id),
    prisma.auditEvent.findMany({
      where: { userId: ctx.user.id },
      // The id tiebreak matters: several events written inside one request share
      // a millisecond, and without it their order flips between page loads.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        clientId: true,
        actorName: true,
        actorEmail: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        metadata: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  return (
    <div
      className="min-h-full p-6 md:p-10"
      style={{ background: "var(--spx-canvas)", color: "var(--spx-text)" }}
    >
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Activity</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--spx-muted)]">
          Everything that has changed a client&apos;s books — approvals, pushes to Tally, deletions
          — across every client, with who did it and when.
        </p>
      </header>

      <ActivityFeed
        initialEvents={page.map((e) => ({
          id: e.id,
          clientId: e.clientId,
          clientName: e.client?.name ?? null,
          actorName: e.actorName,
          actorEmail: e.actorEmail,
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          summary: e.summary,
          metadata: e.metadata as unknown as Record<string, unknown> | null,
          createdAt: e.createdAt.toISOString(),
        }))}
        initialCursor={hasMore ? page[page.length - 1].id : null}
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        // The tokens and their wording live in `@/lib/audit` beside the writers,
        // and are handed down as data rather than imported by the client
        // component — that module pulls in Prisma, which has no business in a
        // browser bundle.
        actions={AUDIT_ACTIONS.map((value) => ({ value, label: AUDIT_ACTION_LABELS[value] }))}
      />
    </div>
  );
}
