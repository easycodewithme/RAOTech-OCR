import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

/**
 * Resolve the database User for the current Clerk session, creating it on first
 * use (keyed by email, matching the dashboard/save flows). Returns null when
 * unauthenticated.
 */
export async function getDbUser() {
  const user = await currentUser();
  if (!user) return null;
  const email = user.emailAddresses[0]?.emailAddress;
  if (!email) return null;

  return prisma.user.upsert({
    where: { email },
    update: { name: user.firstName || user.username || undefined },
    create: {
      clerkId: user.id,
      email,
      name: user.firstName || user.username || "User",
    },
  });
}
