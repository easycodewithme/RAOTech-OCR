import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

/**
 * DELETE /api/connector/devices/{deviceId}
 *
 * Revoked, not deleted. The row is what a finished job's `deviceId` points at,
 * so removing it would erase the record of which machine posted a voucher —
 * and `revokedAt` is already the only thing `authenticateDevice` needs to see
 * to start answering 401, which stops the connector dead on its next poll.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ deviceId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user } = ctx;
    const { deviceId } = await params;

    const device = await prisma.connectorDevice.findFirst({
      where: { id: deviceId, userId: user.id },
      select: { id: true, revokedAt: true },
    });
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    if (!device.revokedAt) {
      await prisma.connectorDevice.update({
        where: { id: device.id },
        data: { revokedAt: new Date() },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[CONNECTOR_DEVICE_REVOKE]", error);
    return NextResponse.json({ error: "Failed to revoke device" }, { status: 500 });
  }
}
