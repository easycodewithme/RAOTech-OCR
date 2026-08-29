import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { preflightForPush, hasBlockingPushIssues } from "@/lib/tally/syncJobs";

/**
 * What would happen if you pressed Push — answered before you press it.
 *
 * Every check here already existed; `/api/tally/push` runs them and answers 422.
 * The problem was the ordering. A user selected forty vouchers, clicked, waited,
 * and got told that six of them were never going to work — after which they had
 * to find those six in a table of forty. Running the same checks on selection
 * turns that into a sentence above the button.
 *
 * Strictly read-only: no jobs, no state, no `VoucherSync` rows. It is called on
 * every selection change, so it must be safe to call constantly and cheap
 * enough not to be felt.
 *
 * It also reports two things the push route cannot express through a 422,
 * because neither is a reason to refuse:
 *
 *   - masters that will be created first, which is normal and worth knowing
 *   - whether a connector is actually listening, which is the difference
 *     between "queued and posting" and "queued and sitting there until someone
 *     opens the laptop"
 */

/** Heartbeat is every 30s, so two minutes of silence is genuinely offline. */
const DEVICE_STALE_MS = 2 * 60 * 1000;

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = (await req.json().catch(() => ({}))) as { voucherIds?: unknown };
    const ids = Array.isArray(body.voucherIds) ? body.voucherIds.map(String) : [];

    if (!ids.length) {
      return NextResponse.json({ ready: false, reason: "Nothing selected.", issues: [] });
    }

    const [company, vouchers, devices] = await Promise.all([
      prisma.tallyCompany.findUnique({
        where: { clientId: client.id },
        select: {
          companyName: true,
          booksFrom: true,
          fyStart: true,
          status: true,
          educationMode: true,
        },
      }),
      prisma.voucher.findMany({
        where: {
          userId: user.id,
          clientId: client.id,
          status: { in: ["APPROVED", "EXPORTED_DEMO"] },
          id: { in: ids },
        },
        include: {
          lines: { orderBy: { sortOrder: "asc" } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { date: "asc" },
      }),
      prisma.connectorDevice.findMany({
        where: { userId: user.id, revokedAt: null },
        select: { deviceName: true, lastSeenAt: true, tallyReachable: true, tallyMessage: true },
        orderBy: { lastSeenAt: "desc" },
        take: 1,
      }),
    ]);

    if (!company) {
      return NextResponse.json({
        ready: false,
        reason: "No Tally company is bound to this client yet.",
        fix: { label: "Set it up", href: "/settings/tally" },
        issues: [],
      });
    }

    /**
     * Vouchers the caller asked about that are not pushable.
     *
     * Reported rather than silently dropped: selecting a draft and a posted
     * voucher together and being told "12 will post" when you selected 14 is
     * the kind of arithmetic a user notices and cannot explain.
     */
    const found = new Set(vouchers.map((v) => v.id));
    const notPushable = ids.filter((id) => !found.has(id)).length;

    if (!vouchers.length) {
      return NextResponse.json({
        ready: false,
        reason:
          notPushable === 1
            ? "That voucher is not approved, so it cannot be posted yet."
            : "None of those vouchers are approved yet.",
        issues: [],
      });
    }

    const issues = preflightForPush(
      vouchers.map((v) => ({
        id: v.id,
        date: v.date,
        invoiceNumber: v.invoice?.invoiceNumber,
        lines: v.lines.map((l) => ({
          ledgerName: l.ledgerNameSnapshot,
          debit: l.debit,
          credit: l.credit,
        })),
      })),
      { booksFrom: company.booksFrom ?? company.fyStart }
    );

    const blocking = hasBlockingPushIssues(issues);

    // Masters the push would create first. Not a problem — the push already
    // queues a MASTER_CREATE ahead of the vouchers — but it explains why the
    // first push of a new client takes two jobs instead of one.
    const ledgerIds = [
      ...new Set(vouchers.flatMap((v) => v.lines.map((l) => l.ledgerId).filter(Boolean) as string[])),
    ];
    const stockItemIds = [
      ...new Set(
        vouchers.flatMap((v) => v.lines.map((l) => l.stockItemId).filter(Boolean) as string[])
      ),
    ];
    const [newLedgers, newItems] = await Promise.all([
      ledgerIds.length
        ? prisma.ledger.count({
            where: { id: { in: ledgerIds }, tallyGuid: null, tallyReserved: false },
          })
        : 0,
      stockItemIds.length
        ? prisma.stockItem.count({ where: { id: { in: stockItemIds }, tallySyncedAt: null } })
        : 0,
    ]);

    const device = devices[0] ?? null;
    const lastSeen = device?.lastSeenAt ? new Date(device.lastSeenAt).getTime() : 0;
    const connectorOnline = !!device && Date.now() - lastSeen < DEVICE_STALE_MS;

    const movesStock = vouchers.some((v) => v.lines.some((l) => l.stockItemId));

    return NextResponse.json({
      /** Whether Push should be enabled at all. */
      ready: !blocking,
      companyName: company.companyName,
      voucherCount: vouchers.length,
      notPushable,
      blockingCount: issues.filter((i) => i.severity === "error").length,
      warningCount: issues.filter((i) => i.severity === "warning").length,
      issues,
      mastersToCreate: newLedgers + newItems,
      movesStock,
      connector: {
        online: connectorOnline,
        name: device?.deviceName ?? null,
        lastSeenAt: device?.lastSeenAt ?? null,
        tallyReachable: device?.tallyReachable ?? null,
        tallyMessage: device?.tallyMessage ?? null,
      },
      educationMode: company.educationMode ?? false,
    });
  } catch (error) {
    console.error("[TALLY_PREFLIGHT]", error);
    return NextResponse.json({ error: "Could not check those vouchers" }, { status: 500 });
  }
}
