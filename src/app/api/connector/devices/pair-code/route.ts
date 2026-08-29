import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import {
  PAIRING_CODE_TTL_MS,
  formatPairingCode,
  generatePairingCode,
} from "@/lib/tally/connectorAuth";

/**
 * POST /api/connector/devices/pair-code
 *
 * Mints the code the user types into the desktop connector. It is created
 * already bound to this user, which is the whole reason `/api/connector/pair`
 * needs no credentials: the identity travels in the code, not in a password
 * the accountant would otherwise have to type into a console.
 *
 * This route is Clerk-authenticated despite sitting under /api/connector — only
 * pair, heartbeat and jobs speak bearer tokens.
 */
export async function POST() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;

    // Any code the user is still holding is dead the moment a new one is shown,
    // so an abandoned code cannot be claimed later off a screenshot.
    await prisma.pairingCode.updateMany({
      where: { userId: user.id, claimedAt: null, expiresAt: { gt: new Date() } },
      data: { expiresAt: new Date() },
    });

    // 32^8 is ~1.1e12, so a collision inside a 10-minute window is not a real
    // event — but `code` is unique, and one retry is cheaper than a 500.
    let created = null as Awaited<ReturnType<typeof prisma.pairingCode.create>> | null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      const code = generatePairingCode();
      created = await prisma.pairingCode
        .create({
          data: {
            code,
            userId: user.id,
            expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
          },
        })
        .catch(() => null);
    }

    if (!created) {
      return NextResponse.json({ error: "Could not generate a code" }, { status: 500 });
    }

    return NextResponse.json({
      code: formatPairingCode(created.code),
      expiresAt: created.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[CONNECTOR_PAIR_CODE]", error);
    return NextResponse.json({ error: "Failed to create pairing code" }, { status: 500 });
  }
}
