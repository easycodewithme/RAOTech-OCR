import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  clientIp,
  hashToken,
  mintToken,
  normalizeCode,
  rateLimitPairing,
  tokenPrefixOf,
} from "@/lib/tally/connectorAuth";

export const dynamic = "force-dynamic";

/**
 * POST /api/connector/pair — the one unauthenticated route in the protocol.
 *
 * The code was created already bound to a user, which is why no credential
 * needs to reach the desktop binary and why a password never touches the
 * accountant's machine. What comes back is a bearer token, shown once.
 */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const limit = rateLimitPairing(ip);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many pairing attempts. Wait a minute and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = normalizeCode(String(body.code ?? ""));
    const deviceName = String(body.deviceName ?? "").trim() || "Unnamed device";
    const machineId = String(body.machineId ?? "").trim() || null;
    const appVersion = String(body.appVersion ?? "").trim() || null;
    const osVersion = String(body.osVersion ?? "").trim() || null;

    if (!code) {
      return NextResponse.json({ error: "Pairing code is required" }, { status: 400 });
    }

    // Unknown, expired and already-claimed all answer identically. Telling them
    // apart would let a guessed code be distinguished from a stale one, which is
    // the only feedback an attacker on this route can get.
    const notFound = NextResponse.json(
      { error: "That pairing code is not valid. Generate a new one in Settings." },
      { status: 404 }
    );

    // Claim first, create second. The conditional updateMany is what makes the
    // code single-use: two connectors racing on the same code, only one gets a
    // row back and the other sees the same 404 as a stranger would.
    const claimedAt = new Date();
    const claim = await prisma.pairingCode.updateMany({
      where: { code, claimedAt: null, expiresAt: { gt: claimedAt } },
      data: { claimedAt },
    });
    if (claim.count === 0) return notFound;

    const pairing = await prisma.pairingCode.findUnique({
      where: { code },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!pairing) return notFound;

    const token = mintToken();
    const tokenHash = hashToken(token);
    const tokenPrefix = tokenPrefixOf(token);

    // Reinstalling the connector must not litter the settings page, so a known
    // machine has its token replaced rather than a second row created. The old
    // token stops working the instant this row is updated, which is also the
    // intended way to rotate one.
    const existing = machineId
      ? await prisma.connectorDevice.findFirst({
          where: { userId: pairing.user.id, machineId },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const device = existing
      ? await prisma.connectorDevice.update({
          where: { id: existing.id },
          data: {
            deviceName,
            tokenHash,
            tokenPrefix,
            appVersion,
            osVersion,
            revokedAt: null,
            lastSeenAt: claimedAt,
          },
        })
      : await prisma.connectorDevice.create({
          data: {
            userId: pairing.user.id,
            deviceName,
            machineId,
            tokenHash,
            tokenPrefix,
            appVersion,
            osVersion,
            lastSeenAt: claimedAt,
          },
        });

    await prisma.pairingCode.update({
      where: { id: pairing.id },
      data: { deviceId: device.id },
    });

    return NextResponse.json({
      token,
      deviceId: device.id,
      deviceName: device.deviceName,
      userEmail: pairing.user.email,
      tallyHost: device.tallyHost,
      tallyPort: device.tallyPort,
    });
  } catch (error) {
    console.error("[CONNECTOR_PAIR]", error);
    return NextResponse.json({ error: "Pairing failed" }, { status: 500 });
  }
}
