import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { seedLedgersForUser } from "@/lib/accounting/seedLedgers";

export const ACTIVE_CLIENT_COOKIE = "active_client_id";

/**
 * Ensure the user has at least one client workspace.
 * Existing unscoped data (legacy clientId="") is backfilled into the default client.
 */
export async function ensureDefaultClient(userId: string) {
  let client = await prisma.client.findFirst({
    where: { userId, isDefault: true },
  });

  if (!client) {
    client = await prisma.client.findFirst({ where: { userId } });
  }

  if (!client) {
    client = await prisma.client.create({
      data: {
        userId,
        name: "Default Client",
        isDefault: true,
      },
    });
  }

  await Promise.all([
    prisma.ledger.updateMany({ where: { userId, clientId: "" }, data: { clientId: client.id } }).catch(() => null),
    prisma.ledgerMapping.updateMany({ where: { userId, clientId: "" }, data: { clientId: client.id } }).catch(() => null),
    prisma.mappingRule.updateMany({ where: { userId, clientId: "" }, data: { clientId: client.id } }).catch(() => null),
    prisma.voucher.updateMany({ where: { userId, clientId: "" }, data: { clientId: client.id } }).catch(() => null),
    prisma.bankStatement.updateMany({ where: { userId, clientId: "" }, data: { clientId: client.id } }).catch(() => null),
  ]);

  await seedLedgersForUser(prisma, userId, client.id);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user && !user.activeClientId) {
    await prisma.user.update({
      where: { id: userId },
      data: { activeClientId: client.id },
    });
  }

  return client;
}

export async function listClientsForUser(userId: string) {
  await ensureDefaultClient(userId);
  return prisma.client.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

export async function getActiveClient() {
  const user = await getDbUser();
  if (!user) return null;

  await ensureDefaultClient(user.id);

  const cookieStore = await cookies();
  const cookieClientId = cookieStore.get(ACTIVE_CLIENT_COOKIE)?.value;

  let client = null as Awaited<ReturnType<typeof prisma.client.findFirst>>;

  if (cookieClientId) {
    client = await prisma.client.findFirst({
      where: { id: cookieClientId, userId: user.id },
    });
  }

  if (!client && user.activeClientId) {
    client = await prisma.client.findFirst({
      where: { id: user.activeClientId, userId: user.id },
    });
  }

  if (!client) {
    client = await prisma.client.findFirst({
      where: { userId: user.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
  }

  if (!client) return null;

  if (user.activeClientId !== client.id) {
    await prisma.user.update({
      where: { id: user.id },
      data: { activeClientId: client.id },
    });
  }

  return { user, client };
}

export async function requireActiveClient() {
  const ctx = await getActiveClient();
  if (!ctx) throw new Error("Unauthorized");
  return ctx;
}
