import crypto from "crypto";
import { NextResponse } from "next/server";
import { getDbUser } from "@/lib/getDbUser";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const signature = req.headers.get("calendly-webhook-signature");
    const secret = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
    const rawBody = await req.text();
    if (!signature || !secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });

    const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2)));
    const timestamp = parts.t;
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const received = parts.v1 ? Buffer.from(parts.v1, "hex") : Buffer.alloc(0);
    const expectedBytes = Buffer.from(expected, "hex");
    if (!timestamp || !parts.v1 || received.length !== expectedBytes.length || !crypto.timingSafeEqual(expectedBytes, received)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const body = JSON.parse(rawBody) as {
      event?: string;
      payload?: {
        event?: { start_time?: string; end_time?: string; uri?: string; location?: { join_url?: string } };
        invitee?: { email?: string; name?: string; uri?: string; canceled?: boolean };
      };
    };
    const invitee = body.payload?.invitee;
    const event = body.payload?.event;
    if (!invitee?.email || !event?.start_time || !event.end_time) return NextResponse.json({ error: "Invalid Calendly payload" }, { status: 400 });

    const user = await prisma.user.findUnique({ where: { email: invitee.email.toLowerCase() } });
    if (!user) return NextResponse.json({ received: true, matched: false });
    const startAt = new Date(event.start_time);
    const endAt = new Date(event.end_time);
    const canceled = body.event === "invitee.canceled" || invitee.canceled === true;
    await prisma.demoBooking.upsert({
      where: { userId: user.id },
      update: { startAt, endAt, meetUrl: event.location?.join_url || "", calendarEventId: event.uri, status: canceled ? "CANCELLED" : "CONFIRMED" },
      create: { userId: user.id, startAt, endAt, meetUrl: event.location?.join_url || "", calendarEventId: event.uri, status: canceled ? "CANCELLED" : "CONFIRMED" },
    });
    return NextResponse.json({ received: true, matched: true });
  } catch (error) {
    console.error("[CALENDLY_WEBHOOK_ERROR]", error);
    return NextResponse.json({ error: "Could not process Calendly webhook" }, { status: 500 });
  }
}

export async function GET() {
  const user = await getDbUser();
  if (!user) return NextResponse.json({ booking: null }, { status: 401 });
  const booking = await prisma.demoBooking.findFirst({ where: { userId: user.id, status: "CONFIRMED", endAt: { gt: new Date() } } });
  return NextResponse.json({ booking });
}