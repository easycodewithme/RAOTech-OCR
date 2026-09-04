import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { sendBrevoEmail, buildInvitationEmailHtml } from "@/lib/brevo";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_EXPIRY_DAYS = 7;

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

// GET: current invitation + seat status for an org, so the invite page can
// render real numbers instead of only what's in local component state.
export async function GET(req: Request) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("orgId");

    const org = await resolveOrg(dbUser.id, orgId);
    if (!org) return NextResponse.json({ error: "No organization found" }, { status: 404 });

    const [members, invitations] = await Promise.all([
      prisma.orgMember.count({ where: { orgId: org.id } }),
      prisma.teamInvitation.findMany({
        where: { orgId: org.id },
        orderBy: { createdAt: "desc" },
        select: { email: true, status: true, createdAt: true },
      }),
    ]);

    return NextResponse.json({
      orgId: org.id,
      orgName: org.name,
      maxSeats: org.maxSeats,
      memberCount: members,
      invitations,
    });
  } catch (error: any) {
    console.error("[ENTERPRISE_INVITATIONS_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load invitations" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const dbUser = await getDbUser();
    if (!dbUser) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { emails, orgId } = await req.json();

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid email addresses provided" },
        { status: 400 }
      );
    }

    const org = await resolveOrg(dbUser.id, orgId);
    if (!org) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No organization found for your account. Complete an Enterprise plan purchase first.",
        },
        { status: 404 }
      );
    }

    // Normalise + validate + dedupe the incoming list.
    const candidates = Array.from(
      new Set(
        emails
          .map((e: unknown) => String(e).trim().toLowerCase())
          .filter((e: string) => EMAIL_REGEX.test(e))
      )
    );

    if (candidates.length === 0) {
      return NextResponse.json(
        { ok: false, error: "None of the provided addresses were valid emails" },
        { status: 400 }
      );
    }

    // Who's already in or already invited, so we don't double-send or
    // double-count against the seat limit.
    const [existingMembers, existingInvites] = await Promise.all([
      prisma.orgMember.findMany({
        where: { orgId: org.id },
        select: { user: { select: { email: true } } },
      }),
      prisma.teamInvitation.findMany({
        where: { orgId: org.id, status: "PENDING" },
        select: { email: true },
      }),
    ]);

    const alreadyMemberEmails = new Set(existingMembers.map((m) => m.user.email.toLowerCase()));
    const alreadyInvitedEmails = new Set(existingInvites.map((i) => i.email.toLowerCase()));

    const toInvite = candidates.filter(
      (e) => !alreadyMemberEmails.has(e) && !alreadyInvitedEmails.has(e)
    );
    const skipped = candidates.filter((e) => !toInvite.includes(e));

    if (toInvite.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          sentCount: 0,
          invitedEmails: [],
          skippedEmails: skipped,
          message: "All provided addresses are already members or already invited.",
        },
        { status: 200 }
      );
    }

    // Seat limit: existing members + already-pending invites + this batch.
    const seatsUsed = alreadyMemberEmails.size + alreadyInvitedEmails.size;
    const seatsAvailable = org.maxSeats - seatsUsed;
    if (seatsAvailable <= 0) {
      return NextResponse.json(
        { ok: false, error: "You have reached the employee limit for this plan." },
        { status: 400 }
      );
    }

    const withinLimit = toInvite.slice(0, seatsAvailable);
    const overLimit = toInvite.slice(seatsAvailable);

    const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Create invitation rows first (source of truth), then attempt email
    // delivery per-row. A DB row with a token always exists even if the
    // email bounces, so nothing is lost and a resend can reuse the same link.
    const created = await prisma.$transaction(
      withinLimit.map((email) =>
        prisma.teamInvitation.create({
          data: {
            orgId: org.id,
            email,
            role: "CLERK",
            invitedById: dbUser.id,
            expiresAt,
          },
        })
      )
    );

    const sendResults = await Promise.allSettled(
      created.map(async (invite: (typeof created)[number]) => {
        const acceptUrl = `${appUrl()}/invite/accept?token=${invite.token}`;
        const result = await sendBrevoEmail({
          to: [{ email: invite.email }],
          subject: `${dbUser.name || "Your team"} invited you to join RAO AI`,
          htmlContent: buildInvitationEmailHtml({
            inviterName: dbUser.name || dbUser.email,
            orgName: org.name,
            acceptUrl,
          }),
        });
        return { email: invite.email, ...result };
      })
    );

    const emailFailures = sendResults
      .map((r, i) =>
        r.status === "fulfilled" && !r.value.ok
          ? { email: created[i].email, error: r.value.error }
          : r.status === "rejected"
            ? { email: created[i].email, error: String(r.reason) }
            : null
      )
      .filter(Boolean);

    return NextResponse.json({
      ok: true,
      sentCount: created.length - emailFailures.length,
      invitedEmails: created.map((c) => c.email),
      skippedEmails: [...skipped, ...overLimit],
      emailFailures,
      message:
        emailFailures.length > 0
          ? `${created.length - emailFailures.length} of ${created.length} invitation email(s) sent; the rest failed to deliver but were still recorded and can be resent.`
          : `${created.length} invitation(s) sent successfully.`,
    });
  } catch (error: any) {
    console.error("[ENTERPRISE_INVITATIONS_POST_ERROR]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to send invitations" },
      { status: 500 }
    );
  }
}

/**
 * Resolve which Organization this request is acting on: an explicit orgId
 * (validated to be owned by the caller) if provided, otherwise the caller's
 * first owned org.
 */
async function resolveOrg(userId: string, orgId?: string | null) {
  if (orgId) {
    return prisma.organization.findFirst({ where: { id: orgId, ownerId: userId } });
  }
  return prisma.organization.findFirst({ where: { ownerId: userId } });
}
