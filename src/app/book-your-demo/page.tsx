"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CheckCircle2, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

function DemoPageContent() {
  const [calendlyOpen, setCalendlyOpen] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL;

  useEffect(() => {
    function handleCalendlyMessage(event: MessageEvent) {
      if (event.origin !== "https://calendly.com") return;
      const data = typeof event.data === "string" ? (() => {
        try { return JSON.parse(event.data); } catch { return null; }
      })() : event.data;
      if (data?.event === "calendly.event_scheduled") {
        router.push("/book-your-demo/success");
      }
    }
    window.addEventListener("message", handleCalendlyMessage);
    return () => window.removeEventListener("message", handleCalendlyMessage);
  }, [router]);

  function calendlyLink() {
    if (!calendlyUrl) return "#";
    const url = new URL(calendlyUrl);
    return url.toString();
  }

  function openCalendly() {
    window.sessionStorage.setItem("rao-demo-return-to", returnTo);
    setCalendlyOpen(true);
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 md:py-12 text-foreground">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 text-xl font-bold tracking-tight">
            <span>RAO AI</span>
            <span className="font-mono text-[11px] font-normal tracking-[0.2em] text-muted-foreground uppercase">
              PLATFORM
            </span>
          </Link>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            View pricing
          </Link>
        </div>

        <section className="mt-10 grid gap-8 lg:grid-cols-12 items-start">
          {/* Left Column: Details & Action */}
          <div className="space-y-6 lg:col-span-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Free guided demo
              </p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-4xl text-foreground">
                See RAO AI work on your books.
              </h1>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Book a one-hour walkthrough of invoice automation, AI insights, GST reconciliation, and Tally sync.
              </p>
            </div>

            <div className="rounded-[14px] border border-border bg-card p-6">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-foreground" />
                <h2 className="font-semibold text-base">Choose a time this week</h2>
              </div>
              <p className="mt-3 text-xs text-muted-foreground leading-relaxed">
                Calendly will show the available one-hour slots and handle the calendar invitation and Google Meet link.
              </p>
              <Button
                disabled={!calendlyUrl}
                onClick={openCalendly}
                className="mt-5 w-full rounded-[10px] py-5 font-semibold text-sm shadow-sm"
              >
                {calendlyOpen ? "Calendar Open" : "Book Demo on Calendly"}
              </Button>
            </div>

            <aside className="space-y-3.5 text-xs text-muted-foreground pt-1">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-foreground" />
                <span>One hour, scheduled at a time that works for you.</span>
              </div>
              <div className="flex items-center gap-3">
                <Video className="h-4 w-4 shrink-0 text-foreground" />
                <span>Calendly creates the meeting link and sends the invitations.</span>
              </div>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-foreground" />
                <span>After booking, your AI and Tally features unlock.</span>
              </div>
              <p className="pt-2 text-[11px] text-muted-foreground">
                You can book a demo without creating an account first.
              </p>
            </aside>
          </div>

          {/* Right Column: Sidewards Calendly Widget */}
          <div className="lg:col-span-7">
            {calendlyOpen && calendlyUrl ? (
              <div className="overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
                <iframe
                  title="Book an RAO AI demo"
                  src={calendlyLink()}
                  className="h-[680px] w-full border-0"
                />
              </div>
            ) : (
              <div className="flex min-h-[480px] flex-col items-center justify-center rounded-[14px] border border-dashed border-border bg-card/40 p-8 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-foreground">
                  <CalendarDays className="h-7 w-7" />
                </div>
                <h3 className="text-base font-semibold text-foreground">
                  Schedule Your Live Demo
                </h3>
                <p className="mt-2 max-w-sm text-xs text-muted-foreground leading-relaxed">
                  Click &ldquo;Book Demo on Calendly&rdquo; to view real-time available slots and pick a time that works for you.
                </p>
                <Button
                  disabled={!calendlyUrl}
                  onClick={openCalendly}
                  variant="outline"
                  className="mt-5 rounded-[10px] text-xs font-medium"
                >
                  Open Calendar
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <DemoPageContent />
    </Suspense>
  );
}
