"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

const FALLBACK_RETURN_TO = "/dashboard";

function safeReturnTo(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : FALLBACK_RETURN_TO;
}

export default function DemoSuccessPage() {
  const router = useRouter();
  const [seconds, setSeconds] = useState(10);
  const [returnTo, setReturnTo] = useState(FALLBACK_RETURN_TO);

  useEffect(() => {
    const stored = window.sessionStorage.getItem("rao-demo-return-to");
    const target = safeReturnTo(stored);
    window.setTimeout(() => setReturnTo(target), 0);
    window.sessionStorage.removeItem("rao-demo-return-to");
    const timer = window.setInterval(() => setSeconds((value) => Math.max(value - 1, 0)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (seconds === 0) router.replace(returnTo);
  }, [returnTo, router, seconds]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <section className="max-w-lg text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
        <h1 className="mt-6 text-3xl font-bold tracking-tight">Demo booked successfully</h1>
        <p className="mt-4 text-muted-foreground">Calendly has sent the meeting details and Google Meet link by email.</p>
        <p className="mt-6 text-sm text-muted-foreground">Returning in {seconds} seconds...</p>
        <button type="button" onClick={() => router.replace(returnTo)} className="mt-5 text-sm underline underline-offset-4">Return now</button>
      </section>
    </main>
  );
}