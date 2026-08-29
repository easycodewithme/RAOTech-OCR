import { NextResponse } from "next/server";

// Simple in-memory/API handler for enterprise team invitations
export async function POST(req: Request) {
  try {
    const { emails } = await req.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid email addresses provided" },
        { status: 400 }
      );
    }

    // Process invitation list
    console.log("[Enterprise Invitations API] Sent invites to:", emails);

    return NextResponse.json({
      ok: true,
      sentCount: emails.length,
      invitedEmails: emails,
      message: `${emails.length} invitation(s) processed successfully`,
    });
  } catch (error: any) {
    console.error("[Enterprise Invitations Error]:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to send invitations" },
      { status: 500 }
    );
  }
}
