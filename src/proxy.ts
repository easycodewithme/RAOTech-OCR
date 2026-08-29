import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import {
  LOCAL_ONLY_API_PREFIXES,
  LOCAL_ONLY_ROUTE_PREFIXES,
  extraPagesEnabled,
} from "@/lib/featureFlags";
import { trace } from "@/lib/trace";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/intake(.*)",
  "/pricing(.*)",
  "/enterprise/invite(.*)",
]);

/**
 * The desktop connector's own endpoints.
 *
 * They authenticate with `Authorization: Bearer rtc_...` against
 * `ConnectorDevice.tokenHash`, not with a Clerk session -- the binary on the
 * accountant's machine never holds a login, which is what lets one device be
 * revoked without disturbing the user's account. Left inside Clerk's session
 * requirement they answer a redirect to the sign-in page, which a Go agent
 * reads as an unparseable 200 and reports as a protocol error.
 *
 * `/api/connector/devices/*` is deliberately absent: that is the web UI
 * managing its own devices, and it stays behind Clerk.
 */
const isConnectorRoute = createRouteMatcher([
  "/api/connector/pair",
  "/api/connector/heartbeat",
  "/api/connector/jobs",
  "/api/connector/jobs/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  const startedAt = Date.now();
  const pathname = req.nextUrl.pathname;

  trace("proxy", "request:start", {
    method: req.method,
    pathname,
  });

  const allowExtraPages = extraPagesEnabled();

  if (!allowExtraPages) {
    const blockedApi = LOCAL_ONLY_API_PREFIXES.some(
      (prefix) =>
        pathname === prefix || pathname.startsWith(prefix + "/")
    );

    if (blockedApi) {
      trace("proxy", "request:blocked-api", {
        pathname,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.json(
        { error: "Not found" },
        { status: 404 }
      );
    }

    const blockedPage = LOCAL_ONLY_ROUTE_PREFIXES.some(
      (prefix) =>
        pathname === prefix || pathname.startsWith(prefix + "/")
    );

    if (blockedPage) {
      trace("proxy", "request:blocked-page-redirect", {
        pathname,
        durationMs: Date.now() - startedAt,
      });

      return NextResponse.redirect(
        new URL("/dashboard", req.url)
      );
    }
  }

  if (!isPublicRoute(req) && !isConnectorRoute(req)) {
    const protectStartedAt = Date.now();

    await auth.protect();

    trace("proxy", "request:auth-protected", {
      pathname,
      durationMs: Date.now() - protectStartedAt,
    });
  }

  trace("proxy", "request:pass", {
    pathname,
    durationMs: Date.now() - startedAt,
  });
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4)).*)",
    "/(api|trpc)(.*)",
  ],
};