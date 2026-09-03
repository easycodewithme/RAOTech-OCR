import crypto from "crypto";
import { prisma } from "@/lib/prisma";

type BookingInput = { userId: string; startAt: Date; endAt: Date; name: string; email: string };

function hasOAuthConfig() {
  return ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI", "DEMO_EMPLOYEE_EMAIL"].every((name) => Boolean(process.env[name]));
}

export function googleOAuthUrl(state: string) {
  if (!hasOAuthConfig()) throw new Error("Google OAuth is not configured");
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!, response_type: "code", access_type: "offline", prompt: "consent", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send", state });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function calendarAccessToken(userId: string) {
  const stored = await prisma.googleOAuthToken.findUnique({ where: { userId } });
  if (!stored) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: stored.refreshToken, grant_type: "refresh_token" }) });
  if (!response.ok) throw new Error("Google Calendar authorization expired. Connect Google Calendar again.");
  return (await response.json() as { access_token: string }).access_token;
}

export async function createDemoMeeting(input: BookingInput) {
  if (!hasOAuthConfig()) throw new Error("Google OAuth is not configured. Add Google OAuth credentials first.");
  const token = await calendarAccessToken(input.userId);
  if (!token) throw new Error("Connect Google Calendar before booking your demo.");

  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";
  const eventResponse = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: "RAO AI product demo",
      description: "One-hour RAO AI product demo.",
      start: { dateTime: input.startAt.toISOString() },
      end: { dateTime: input.endAt.toISOString() },
      attendees: [{ email: input.email }, { email: process.env.DEMO_EMPLOYEE_EMAIL! }],
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  if (!eventResponse.ok) {
    const details = await eventResponse.text();
    console.error("[GOOGLE_CALENDAR_ERROR]", {
      status: eventResponse.status,
      calendarId,
      details: details.slice(0, 1000),
    });
    if (eventResponse.status === 404) {
      throw new Error("Google Calendar was not found. Use GOOGLE_CALENDAR_ID=primary or the Calendar ID belonging to the account that authorized Google Calendar.");
    }
    throw new Error(`Could not create the Google Meet event (Google returned ${eventResponse.status})`);
  }
  const event = await eventResponse.json() as { id: string; hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType: string; uri: string }> } };
  const meetUrl = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri;
  if (!meetUrl) throw new Error("Google Calendar did not return a Meet link");

  const when = input.startAt.toLocaleString("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: process.env.DEMO_TIMEZONE || "Asia/Kolkata",
  });
  const rawMessage = [
    `To: ${input.email}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Subject: Your RAO AI demo is booked",
    "",
    `Your RAO AI demo is booked for ${when}.`,
    "",
    `Join Google Meet: ${meetUrl}`,
  ].join("\r\n");
  const emailResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: Buffer.from(rawMessage).toString("base64url") }),
  });
  if (!emailResponse.ok) {
    const details = await emailResponse.text();
    console.error("[GMAIL_CONFIRMATION_ERROR]", { status: emailResponse.status, details: details.slice(0, 1000) });
    if (emailResponse.status === 403 && details.includes("accessNotConfigured")) {
      throw new Error("The meeting was created, but Gmail API is disabled. Enable Gmail API in the Google Cloud project used by this OAuth client.");
    }
    if (emailResponse.status === 403 && details.includes("insufficientPermissions")) {
      throw new Error("The meeting was created, but Gmail permission was not granted. Reconnect Google Calendar and allow sending email.");
    }
    throw new Error(`The meeting was created, but the confirmation email could not be sent (Gmail returned ${emailResponse.status}).`);
  }

  return { calendarEventId: event.id, meetUrl };
}
