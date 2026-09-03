import crypto from "crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDbUser } from "@/lib/getDbUser";
import { googleOAuthUrl } from "@/lib/demoBooking";

export async function GET(req: Request) {
  const user = await getDbUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in?redirect_url=/demo", req.url));
  const state = crypto.randomBytes(24).toString("hex");
  (await cookies()).set("google_oauth_state", `${user.id}:${state}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  try {
    return NextResponse.redirect(googleOAuthUrl(state));
  } catch {
    return NextResponse.redirect(new URL("/demo?error=google-config", req.url));
  }
}