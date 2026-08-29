import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/** A device is "online" if it checked in inside the last three heartbeats. */
const ONLINE_WINDOW_MS = 90_000;

/**
 * GET /api/connector/devices
 *
 * The settings list. `tokenPrefix` is the only part of a token that exists on
 * this side — the plaintext was shown once at pairing and is not recoverable,
 * which is what the prefix is for.
 */
export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    const devices = await prisma.connectorDevice.findMany({
      where: { userId: user.id },
      orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }],
      select: {
        id: true,
        deviceName: true,
        machineId: true,
        tokenPrefix: true,
        tallyHost: true,
        tallyPort: true,
        tallyReachable: true,
        tallyMessage: true,
        appVersion: true,
        osVersion: true,
        lastSeenAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    const cutoff = Date.now() - ONLINE_WINDOW_MS;
    return NextResponse.json({
      devices: devices.map((d) => ({
        ...d,
        online:
          !d.revokedAt && !!d.lastSeenAt && d.lastSeenAt.getTime() >= cutoff,
      })),
    });
  } catch (error) {
    console.error("[CONNECTOR_DEVICES]", error);
    return NextResponse.json({ error: "Failed to list devices" }, { status: 500 });
  }
}
