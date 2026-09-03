import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = (await cookies()).get("google_oauth_state")?.value;
  const [userId, expectedState] = storedState?.split(":") ?? [];
  if (!code || !state || !userId || state !== expectedState) return NextResponse.redirect(new URL("/demo?error=google-state", req.url));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT_URI!, grant_type: "authorization_code" }) });
  if (!tokenResponse.ok) return NextResponse.redirect(new URL("/demo?error=google-token", req.url));
  const token = await tokenResponse.json() as { refresh_token?: string; scope?: string };
  if (!token.refresh_token) return NextResponse.redirect(new URL("/demo?error=google-refresh-token", req.url));
  await prisma.googleOAuthToken.upsert({ where: { userId }, update: { refreshToken: token.refresh_token, scope: token.scope }, create: { userId, refreshToken: token.refresh_token, scope: token.scope } });
  (await cookies()).delete("google_oauth_state");
  return NextResponse.redirect(new URL("/demo?connected=1", req.url));
}