import nodemailer from "nodemailer";

export async function sendInvitationEmail({
  senderName,
  recipient,
}: {
  senderName: string;
  recipient: string;
}) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.INVITATION_FROM_EMAIL || user;

  if (!host || !user || !password || !from) {
    throw new Error("Invitation email is not configured. Add SMTP credentials to the environment.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: password },
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://rao-tech-ocr.vercel.app";

  await transporter.sendMail({
    from,
    to: recipient,
    subject: `${senderName} invited you to try RAO AI`,
    text: `Hi,\n\n${senderName} invited you to try RAO AI, an intelligent workspace for invoice processing, AI insights, GST reconciliation, and Tally workflows.\n\nVisit RAO AI: ${appUrl}\n\nYou can create an account and explore the platform from there.`,
  });
}
