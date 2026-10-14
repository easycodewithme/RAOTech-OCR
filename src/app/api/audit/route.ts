import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { withRouteLogging } from "@/lib/trace";
import { isAuditAction } from "@/lib/audit";

/**
 * GET /api/audit — the firm's activity trail, newest first.
 *
 * Query: ?clientId=&action=&cursor=&limit=
 *
 * **Scoped to the firm, not to the active client.** Every other route in this
 * app filters on `{ userId, clientId }`, because every other screen is about
 * doing the work for the client in the switcher. This one is oversight: the
 * question it answers is "what has been done to *any* of my clients' books",
 * and an owner who has to switch workspace twelve times to assemble that answer
 * will not assemble it. `getActiveClient()` is still what authenticates — it is
 * the ownership pattern the rest of the API uses and it resolves the firm's
 * `User` row — but only `user.id` is used as the filter. `clientId` narrows it
 * when the reader asks, and needs no ownership check of its own: `userId` is
 * the tenant boundary on this table, so a foreign client id matches nothing.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

async function getAudit(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    const url = new URL(req.url);
    const clientId = url.searchParams.get("clientId")?.trim() || null;
    const rawAction = url.searchParams.get("action")?.trim() || null;
    const cursor = url.searchParams.get("cursor")?.trim() || null;

    // Rejected rather than ignored. A filter that silently does nothing shows
    // the reader a full list and lets them conclude the thing they filtered for
    // never happened — on an audit screen that is the worst possible failure.
    if (rawAction && !isAuditAction(rawAction)) {
      return NextResponse.json({ error: `Unknown action "${rawAction}"` }, { status: 400 });
    }

    const rawLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const where = {
      userId: user.id,
      ...(clientId ? { clientId } : {}),
      ...(rawAction ? { action: rawAction } : {}),
    };

    // Cursor rather than offset. This table only ever grows at the newest end,
    // so with `skip`/`take` a row written while someone is paging shifts every
    // later page down by one and hides an event behind the page boundary.
    // One row over the limit is read to learn whether there is a next page,
    // without a second COUNT query over a table that never stops growing.
    const rows = await prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        clientId: true,
        actorEmail: true,
        actorName: true,
        action: true,
        entityType: true,
        entityId: true,
        summary: true,
        metadata: true,
        createdAt: true,
        // The client's *current* name, for the common case where it still
        // exists. `clientId` is SetNull on delete, so this is null for a
        // workspace that has since been removed — the summary sentence still
        // names it, which is why the name is written into the sentence.
        client: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > limit;
    const events = hasMore ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        clientId: e.clientId,
        clientName: e.client?.name ?? null,
        actorName: e.actorName,
        actorEmail: e.actorEmail,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        summary: e.summary,
        metadata: e.metadata,
        createdAt: e.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? events[events.length - 1].id : null,
    });
  } catch (error) {
    console.error("[AUDIT_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load activity" }, { status: 500 });
  }
}

export const GET = withRouteLogging("api:/audit", "GET", getAudit);
