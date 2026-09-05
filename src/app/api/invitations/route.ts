import { NextResponse } from "next/server";
import { getDbUser } from "@/lib/getDbUser";
import { sendInvitationEmail } from "@/lib/invitationMailer";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    if (email === user.email.toLowerCase()) return NextResponse.json({ error: "You cannot invite your own email address" }, { status: 400 });

    await sendInvitationEmail({ senderName: user.name || "A RAO AI user", recipient: email });
    return NextResponse.json({ ok: true, email });
  } catch (error) {
    console.error("[INVITATIONS_ERROR]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not send invitation" }, { status: 500 });
  }
}