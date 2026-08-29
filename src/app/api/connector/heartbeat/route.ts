import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateDevice } from "@/lib/tally/connectorAuth";

export const dynamic = "force-dynamic";

/** How often the connector should call back. Mirrored in the pairing docs. */
const HEARTBEAT_SEC = 30;

/**
 * POST /api/connector/heartbeat
 *
 * Presence plus the desktop's own view of its Tally. Both halves matter: a
 * device that is polling happily while Tally is shut is online and useless, and
 * the banner has to say which of the two is wrong.
 */
export async function POST(req: Request) {
  try {
    const device = await authenticateDevice(prisma, req);
    if (!device) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const port = Number(body.tallyPort);

    await prisma.connectorDevice.update({
      where: { id: device.id },
      data: {
        lastSeenAt: new Date(),
        ...(typeof body.tallyReachable === "boolean"
          ? { tallyReachable: body.tallyReachable }
          : {}),
        ...(typeof body.tallyMessage === "string"
          ? { tallyMessage: body.tallyMessage.slice(0, 500) }
          : {}),
        ...(typeof body.tallyHost === "string" && body.tallyHost.trim()
          ? { tallyHost: body.tallyHost.trim() }
          : {}),
        ...(Number.isInteger(port) && port > 0 && port < 65536
          ? { tallyPort: port }
          : {}),
        ...(typeof body.appVersion === "string" && body.appVersion.trim()
          ? { appVersion: body.appVersion.trim() }
          : {}),
      },
    });

    return NextResponse.json({
      ok: true,
      serverTime: new Date().toISOString(),
      heartbeatSec: HEARTBEAT_SEC,
    });
  } catch (error) {
    console.error("[CONNECTOR_HEARTBEAT]", error);
    return NextResponse.json({ error: "Heartbeat failed" }, { status: 500 });
  }
}
