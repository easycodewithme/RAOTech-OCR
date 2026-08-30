"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

type State =
  | { step: "loading" }
  | { step: "invalid"; message: string }
  | { step: "needs-auth"; email: string; orgName: string }
  | { step: "accepting" }
  | { step: "accepted"; orgName: string }
  | { step: "error"; message: string };

function AcceptInvitePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const { isSignedIn, isLoaded, user } = useUser();
  const [state, setState] = useState<State>({ step: "loading" });

  // Step 1: validate the token itself (works whether or not the visitor is
  // signed in yet — this is the link they clicked straight from the email).
  useEffect(() => {
    if (!token) {
      setState({ step: "invalid", message: "This invitation link is missing a token." });
      return;
    }
    if (!isLoaded) return;

    (async () => {
      const res = await fetch(`/api/enterprise/invitations/accept?token=${token}`);
      const data = await res.json();

      if (!data.ok) {
        setState({ step: "invalid", message: data.error || "Invalid invitation." });
        return;
      }

      if (!isSignedIn) {
        setState({ step: "needs-auth", email: data.email, orgName: data.orgName });
        return;
      }

      // Signed in already — try consuming immediately.
      setState({ step: "accepting" });
      const acceptRes = await fetch("/api/enterprise/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const acceptData = await acceptRes.json();

      if (acceptData.ok) {
        setState({ step: "accepted", orgName: data.orgName });
        setTimeout(() => router.push("/dashboard"), 1500);
      } else {
        setState({ step: "error", message: acceptData.error || "Failed to accept invitation." });
      }
    })();
  }, [token, isLoaded, isSignedIn, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-sm rounded-[14px] border border-border bg-card p-8 text-center">
        {state.step === "loading" || state.step === "accepting" ? (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">Checking your invitation…</p>
          </>
        ) : state.step === "needs-auth" ? (
          <>
            <p className="text-lg font-semibold">You've been invited to {state.orgName}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign up or sign in with <strong>{state.email}</strong> to join the workspace.
            </p>
            <Link
              href={`/sign-up?redirect_url=${encodeURIComponent(
                `/invite/accept?token=${token}`
              )}`}
              className="mt-6 block w-full rounded-[10px] bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Create account
            </Link>
            <Link
              href={`/sign-in?redirect_url=${encodeURIComponent(
                `/invite/accept?token=${token}`
              )}`}
              className="mt-3 block text-xs text-muted-foreground hover:text-foreground"
            >
              Already have an account? Sign in
            </Link>
          </>
        ) : state.step === "accepted" ? (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-foreground" />
            <p className="mt-4 text-sm">
              You've joined {state.orgName}. Redirecting to your dashboard…
            </p>
          </>
        ) : (
          <>
            <XCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="mt-4 text-sm text-muted-foreground">
              {state.step === "invalid" || state.step === "error" ? state.message : ""}
            </p>
            <Link href="/" className="mt-6 block text-xs text-muted-foreground hover:text-foreground">
              Back to home
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitePageInner />
    </Suspense>
  );
}
