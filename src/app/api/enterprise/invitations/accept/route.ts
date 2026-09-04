import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";

// GET: look up an invitation by token (no auth required — this is the link
// clicked directly from the email) so the accept page can show who it's for
// before asking the visitor to sign in/up.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  if (!token) return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });

  const invite = await prisma.teamInvitation.findUnique({
    where: { token },
    include: { org: { select: { name: true } } },
  });

  if (!invite) {
    return NextResponse.json({ ok: false, error: "Invitation not found" }, { status: 404 });
  }
  if (invite.status !== "PENDING") {
    return NextResponse.json(
      { ok: false, error: `This invitation has already been ${invite.status.toLowerCase()}.` },
      { status: 400 }
    );
  }
  if (invite.expiresAt < new Date()) {
    await prisma.teamInvitation.update({
      where: { token },
      data: { status: "EXPIRED" },
    });
    return NextResponse.json({ ok: false, error: "This invitation has expired." }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    email: invite.email,
    orgName: invite.org.name,
    role: invite.role,
  });
}

// POST: consume the invitation for the currently-signed-in Clerk user.
// Requires the signed-in user's email to match the invited address — this is
// what stops someone from accepting an invite meant for a different inbox.
export async function POST(req: Request) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) {
      return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
    }

    const { token } = await req.json();
    if (!token) return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });

    const invite = await prisma.teamInvitation.findUnique({ where: { token } });
    if (!invite) {
      return NextResponse.json({ ok: false, error: "Invitation not found" }, { status: 404 });
    }
    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { ok: false, error: `This invitation has already been ${invite.status.toLowerCase()}.` },
        { status: 400 }
      );
    }
    if (invite.expiresAt < new Date()) {
      return NextResponse.json({ ok: false, error: "This invitation has expired." }, { status: 400 });
    }
    if (invite.email.toLowerCase() !== dbUser.email.toLowerCase()) {
      return NextResponse.json(
        {
          ok: false,
          error: `This invitation was sent to ${invite.email}. Sign in with that email address to accept it.`,
        },
        { status: 403 }
      );
    }

    await prisma.$transaction([
      prisma.teamInvitation.update({
        where: { token },
        data: { status: "ACCEPTED", acceptedById: dbUser.id, acceptedAt: new Date() },
      }),
      prisma.orgMember.upsert({
        where: { orgId_userId: { orgId: invite.orgId, userId: dbUser.id } },
        update: {},
        create: { orgId: invite.orgId, userId: dbUser.id, role: invite.role },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[ENTERPRISE_INVITATIONS_ACCEPT_ERROR]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to accept invitation" },
      { status: 500 }
    );
  }
}
