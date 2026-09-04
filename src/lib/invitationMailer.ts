import { prisma } from "@/lib/prisma";

function encodeMessage(message: string) {
  return Buffer.from(message).toString("base64url");
}

export async function sendInvitationEmail({
  senderId,
  senderName,
  recipient,
}: {
  senderId: string;
  senderName: string;
  recipient: string;
}) {
  const stored = await prisma.googleOAuthToken.findUnique({ where: { userId: senderId } });
  if (!stored) {
    throw new Error("Connect Google Calendar on the Demo page before sending invitations.");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: stored.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok) throw new Error("Google authorization expired. Reconnect Google Calendar.");
  const { access_token: accessToken } = await tokenResponse.json() as { access_token: string };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://rao-tech-ocr.vercel.app";
  const rawMessage = [
    `To: ${recipient}`,
    "Content-Type: text/plain; charset=UTF-8",
    `Subject: ${senderName} invited you to try RAO AI`,
    "",
    `Hi,`,
    "",
      `${senderName} invited you to try RAO AI, an intelligent workspace for invoice processing, AI insights, GST reconciliation, and Tally workflows.`,
    "",
    `Visit RAO AI: ${appUrl}`,
    "",
    "You can create an account and explore the platform from there.",
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeMessage(rawMessage) }),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("[INVITATION_EMAIL_ERROR]", { status: response.status, details: details.slice(0, 500) });
    throw new Error("Invitation email could not be sent. Reconnect Google Calendar and allow Gmail sending.");
  }
}