import { NextResponse } from "next/server";
import { getDbUser } from "@/lib/getDbUser";
import { prisma } from "@/lib/prisma";

export async function hasDemoAccess(userId: string) {
  const booking = await prisma.demoBooking.findFirst({
    where: { userId, status: "CONFIRMED", endAt: { gt: new Date() } },
    select: { id: true },
  });
  return Boolean(booking);
}

export async function requireDemoAccess() {
  const user = await getDbUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await hasDemoAccess(user.id))) {
    return {
      user: null,
      response: NextResponse.json(
        { error: "Book a demo to unlock this feature", code: "DEMO_REQUIRED" },
        { status: 403 }
      ),
    };
  }
  return { user, response: null };
}