import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * Three missed 30s heartbeats. Tolerating one lost request is what keeps the
 * "Connector offline" banner from flapping on a flaky office connection.
 */
const ONLINE_WINDOW_MS = 90_000;

/**
 * POST /api/tally/company — register the TallyPrime company this workspace posts to.
 *
 * `companyName` is sent verbatim as <SVCURRENTCOMPANY>. Tally treats a mismatch
 * as "no such company" and answers with silence rather than an error, so this is
 * stored exactly as typed and never normalised.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = await req.json().catch(() => ({}));
    const companyName = String(body.companyName ?? "").trim();
    const companyGuid = String(body.companyGuid ?? "").trim() || null;

    if (!companyName) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    const existing = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
      select: { id: true, companyName: true },
    });

    // Repointing at a different company invalidates every GUID we hold: they
    // are company-scoped in Tally, so the masters have to be pulled again
    // before anything may be posted.
    const renamed = !!existing && existing.companyName !== companyName;

    const company = await prisma.tallyCompany.upsert({
      where: { clientId: client.id },
      create: {
        userId: user.id,
        clientId: client.id,
        companyName,
        companyGuid,
      },
      update: {
        companyName,
        ...(companyGuid ? { companyGuid } : {}),
        ...(renamed ? { status: "UNSYNCED", ledgerCount: 0, lastSyncedAt: null } : {}),
      },
    });

    if (renamed) {
      await prisma.ledger.updateMany({
        where: { userId: user.id, clientId: client.id },
        data: { tallyGuid: null, tallySyncedAt: null, tallyReserved: false },
      });
    }

    return NextResponse.json({ company });
  } catch (error) {
    console.error("[TALLY_COMPANY_POST]", error);
    return NextResponse.json({ error: "Failed to save company" }, { status: 500 });
  }
}

/**
 * GET /api/tally/company
 *
 * Everything the settings banner needs in one round trip: the registered
 * company, the most recently active device, and whether that device is alive.
 * Presence is a `lastSeenAt` inside 90 seconds — three missed 30s heartbeats,
 * which tolerates one lost request without flapping the banner.
 */
export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const [company, device] = await Promise.all([
      prisma.tallyCompany.findUnique({ where: { clientId: client.id } }),
      prisma.connectorDevice.findFirst({
        where: { userId: user.id, revokedAt: null },
        orderBy: { lastSeenAt: "desc" },
        select: {
          id: true,
          deviceName: true,
          tokenPrefix: true,
          tallyHost: true,
          tallyPort: true,
          tallyReachable: true,
          tallyMessage: true,
          appVersion: true,
          lastSeenAt: true,
        },
      }),
    ]);

    const connectorOnline =
      !!device?.lastSeenAt &&
      device.lastSeenAt.getTime() >= Date.now() - ONLINE_WINDOW_MS;

    return NextResponse.json({ company, device, connectorOnline });
  } catch (error) {
    console.error("[TALLY_COMPANY_GET]", error);
    return NextResponse.json({ error: "Failed to load company" }, { status: 500 });
  }
}
