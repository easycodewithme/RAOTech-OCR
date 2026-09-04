"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { SignedIn, SignedOut, SignInButton, useUser } from "@clerk/nextjs";
import { CalendarDays, CheckCircle2, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

function DemoPageContent() {
  const [booked, setBooked] = useState<{ meetUrl: string } | null>(null);
  const { user } = useUser();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") || "/dashboard";
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_BOOKING_URL;

  useEffect(() => {
    void fetch("/api/demo").then((response) => response.ok ? response.json() : null).then((data) => {
      if (data?.booking) setBooked(data.booking);
    });
  }, []);

  function calendlyLink() {
    if (!calendlyUrl) return "#";
    const url = new URL(calendlyUrl);
    const email = user?.primaryEmailAddress?.emailAddress;
    if (email) url.searchParams.set("email", email);
    return url.toString();
  }

  function openCalendly() {
    window.sessionStorage.setItem("rao-demo-return-to", returnTo);
  }

  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-lg font-bold tracking-tight">RAO AI</Link>
          <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground">View pricing</Link>
        </div>
        <section className="mt-20 max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Free guided demo</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-5xl">See RAO AI work on your books.</h1>
          <p className="mt-5 text-lg text-muted-foreground">Book a one-hour walkthrough of invoice automation, AI insights, GST reconciliation, and Tally sync.</p>
        </section>
        <section className="mt-12 grid gap-8 lg:grid-cols-[1fr_280px]">
          <div className="rounded-[14px] border border-border bg-card p-6">
            <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5" /><h2 className="font-semibold">Choose a time this week</h2></div>
            <p className="mt-5 text-sm text-muted-foreground">Calendly will show the available one-hour slots and handle the calendar invitation and Google Meet link.</p>
            <SignedIn>
              <Button asChild disabled={Boolean(booked) || !calendlyUrl} className="mt-6 w-full rounded-[10px] py-6"><a href={calendlyLink()} onClick={openCalendly}>Book Demo on Calendly</a></Button>
            </SignedIn>
            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/demo"><Button variant="outline" className="mt-6 w-full rounded-[10px] py-6">Sign in to book</Button></SignInButton>
            </SignedOut>
            {booked && <><p className="mt-4 text-sm text-muted-foreground">Your demo is booked. Check your email for the calendar invitation.</p><a className="mt-3 inline-block text-sm underline" href={booked.meetUrl} target="_blank" rel="noreferrer">Join your meeting</a></>}
          </div>
          <aside className="space-y-4 text-sm text-muted-foreground">
            <div className="flex gap-3"><Clock className="h-5 w-5 shrink-0 text-foreground" /><span>One hour, scheduled at a time that works for you.</span></div>
            <div className="flex gap-3"><Video className="h-5 w-5 shrink-0 text-foreground" /><span>Calendly creates the meeting link and sends the invitations.</span></div>
            <div className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-foreground" /><span>After booking, your AI and Tally features unlock.</span></div>
            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/demo">
                <Button variant="outline" className="mt-4 w-full rounded-[10px]">Sign in to book</Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <p className="mt-4 text-xs text-muted-foreground">You are signed in and ready to book.</p>
            </SignedIn>
          </aside>
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