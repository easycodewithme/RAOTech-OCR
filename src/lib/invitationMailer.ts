import nodemailer from "nodemailer";

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

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
  const safeSenderName = escapeHtml(senderName);
  const safeAppUrl = escapeHtml(appUrl);

  await transporter.sendMail({
    from,
    to: recipient,
    subject: `${senderName} invited you to simplify your accounting with RAO AI`,
    text: `Hi,\n\n${senderName} thinks RAO AI could help you spend less time on repetitive accounting work.\n\nRAO AI helps teams:\n- Extract invoice data automatically with AI-powered OCR\n- Ask questions about invoices, vendors, GST, and transactions\n- Reconcile GST data and identify mismatches\n- Prepare and export structured data for Tally\n- Collaborate with clients and teams in one workspace\n\nExplore RAO AI: ${appUrl}\n\nCreate your account and see how much of your workflow can be automated.`,
    html: `
      <div style="margin:0;background:#f4f6f8;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#17202a;">
        <div style="margin:0 auto;max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <div style="background:#111827;padding:28px 32px;color:#ffffff;">
            <div style="font-size:22px;font-weight:700;letter-spacing:-0.4px;">RAO AI</div>
            <div style="margin-top:8px;color:#cbd5e1;font-size:13px;">Intelligent operations for modern accounting teams</div>
          </div>
          <div style="padding:34px 32px;">
            <div style="color:#64748b;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">You have been invited</div>
            <h1 style="margin:12px 0 0;font-size:30px;line-height:1.2;color:#111827;">Make accounting work lighter.</h1>
            <p style="margin:20px 0 0;font-size:16px;line-height:1.65;color:#475569;">${safeSenderName} thinks RAO AI could help you move faster, reduce manual work, and keep your financial operations organized in one place.</p>
            <div style="margin:26px 0 0;padding:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
              <div style="font-size:15px;font-weight:700;color:#111827;">What you can do with RAO AI</div>
              <ul style="margin:14px 0 0;padding-left:20px;color:#475569;font-size:14px;line-height:1.8;">
                <li>Extract invoice data automatically with AI-powered OCR</li>
                <li>Ask questions about invoices, vendors, GST, and transactions</li>
                <li>Reconcile GST data and surface mismatches quickly</li>
                <li>Prepare structured exports for Tally workflows</li>
                <li>Collaborate with clients and teams from one workspace</li>
              </ul>
            </div>
            <div style="margin:30px 0;text-align:center;">
              <a href="${safeAppUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;padding:14px 26px;font-size:15px;font-weight:700;">Explore RAO AI</a>
            </div>
            <p style="margin:0;font-size:14px;line-height:1.6;color:#64748b;">Create your account and see how much of your workflow can be automated. No complicated setup is required to get started.</p>
            <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">You received this invitation because ${safeSenderName} shared RAO AI with you.</p>
          </div>
          <div style="border-top:1px solid #e2e8f0;padding:20px 32px;color:#94a3b8;font-size:12px;line-height:1.5;">
            <div style="font-weight:700;color:#64748b;">RAO AI</div>
            <div style="margin-top:4px;">Invoice intelligence, reconciliation, and accounting workflows in one place.</div>
          </div>
        </div>
      </div>
    `,
  });
}
