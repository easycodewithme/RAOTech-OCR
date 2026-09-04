/**
 * Thin wrapper around Brevo's transactional email API (v3/smtp/email).
 *
 * Requires BREVO_API_KEY, BREVO_SENDER_EMAIL and BREVO_SENDER_NAME in the
 * environment. BREVO_SENDER_EMAIL must be a verified sender (or domain) in
 * the Brevo dashboard, or every send below will be rejected.
 */

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface SendEmailParams {
  to: { email: string; name?: string }[];
  subject: string;
  htmlContent: string;
  textContent?: string;
}

export interface SendEmailResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export async function sendBrevoEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "RAO AI";

  if (!apiKey || !senderEmail) {
    return {
      ok: false,
      error: "Missing BREVO_API_KEY or BREVO_SENDER_EMAIL in environment",
    };
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: params.to,
        subject: params.subject,
        htmlContent: params.htmlContent,
        textContent: params.textContent,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        error: data?.message || `Brevo API returned ${res.status}`,
      };
    }

    return { ok: true, messageId: data?.messageId };
  } catch (error: any) {
    return { ok: false, error: error?.message || "Network error calling Brevo" };
  }
}

/** Builds the HTML body for a team-invitation email. */
export function buildInvitationEmailHtml(opts: {
  inviterName: string;
  orgName: string;
  acceptUrl: string;
}) {
  const { inviterName, orgName, acceptUrl } = opts;
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
    <h2 style="margin: 0 0 12px;">You're invited to RAO AI</h2>
    <p style="margin: 0 0 16px; color: #334155; line-height: 1.5;">
      ${inviterName} has invited you to join <strong>${orgName}</strong>'s workspace on RAO AI to start processing invoices together.
    </p>
    <a href="${acceptUrl}"
       style="display: inline-block; background: #0f172a; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
      Accept invitation
    </a>
    <p style="margin: 24px 0 0; font-size: 12px; color: #64748b; line-height: 1.5;">
      This invitation link expires in 7 days. If you weren't expecting this, you can safely ignore this email.
    </p>
  </div>`;
}
