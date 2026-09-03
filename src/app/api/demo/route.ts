import { NextResponse } from "next/server";
import { getDbUser } from "@/lib/getDbUser";
import { prisma } from "@/lib/prisma";
import { createDemoMeeting } from "@/lib/demoBooking";

export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await req.json();
    const startAt = new Date(body.startAt);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(startAt.getTime()) || startAt <= now || startAt > weekFromNow || startAt.getMinutes() !== 0) {
      return NextResponse.json({ error: "Choose an available one-hour slot within the next week" }, { status: 400 });
    }
    const existing = await prisma.demoBooking.findFirst({ where: { status: "CONFIRMED", startAt: { lt: endAt }, endAt: { gt: startAt } } });
    if (existing) return NextResponse.json({ error: "That slot is no longer available" }, { status: 409 });
    const meeting = await createDemoMeeting({ userId: user.id, startAt, endAt, name: user.name || "RAO AI user", email: user.email });
    const booking = await prisma.demoBooking.upsert({ where: { userId: user.id }, update: { startAt, endAt, ...meeting, status: "CONFIRMED" }, create: { userId: user.id, startAt, endAt, ...meeting } });
    return NextResponse.json({ booking });
  } catch (error) {
    console.error("[DEMO_BOOKING_ERROR]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not book demo" }, { status: 500 });
  }
}

export async function GET() {
  const user = await getDbUser();
  if (!user) return NextResponse.json({ booking: null }, { status: 401 });
  const booking = await prisma.demoBooking.findFirst({ where: { userId: user.id, status: "CONFIRMED", endAt: { gt: new Date() } } });
  return NextResponse.json({ booking });
}