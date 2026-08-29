import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { enqueueJob } from "@/lib/tally/syncJobs";

/**
 * POST /api/tally/test-connection
 *
 * Queues a PING. The cloud cannot dial Tally itself — it is on the accountant's
 * own machine, usually behind NAT and often inside an RDP session — so "test
 * connection" is necessarily a round trip through the queue rather than a
 * request this process makes. The UI polls /api/tally/status for the answer.
 *
 * No device paired means the job would sit in the queue for ever, so that is a
 * 409 up front rather than a spinner that never resolves.
 */
export async function POST() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const device = await prisma.connectorDevice.findFirst({
      where: { userId: user.id, revokedAt: null },
      select: { id: true },
    });
    if (!device) {
      return NextResponse.json(
        { error: "No connector is paired. Pair the desktop connector first." },
        { status: 409 }
      );
    }

    const company = await prisma.tallyCompany.findUnique({
      where: { clientId: client.id },
      select: { id: true },
    });

    const job = await enqueueJob(prisma, {
      userId: user.id,
      clientId: client.id,
      tallyCompanyId: company?.id ?? null,
      kind: "PING",
      payload: {},
    });

    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    console.error("[TALLY_TEST_CONNECTION]", error);
    return NextResponse.json({ error: "Failed to queue test" }, { status: 500 });
  }
}
