"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { CalendarDays, CheckCircle2, Clock, Video } from "lucide-react";
import { Button } from "@/components/ui/button";

function slotDate(dayOffset: number, hour: number) {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date;
}

export default function DemoPage() {
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [booked, setBooked] = useState<{ meetUrl: string } | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [referenceTime] = useState(() => new Date());
  const slots = useMemo(() => Array.from({ length: 7 }, (_, day) => [10, 12, 14, 16].map((hour) => slotDate(day, hour))).flat().filter((slot) => slot > referenceTime && slot <= new Date(referenceTime.getTime() + 7 * 24 * 60 * 60 * 1000)), [referenceTime]);

  useEffect(() => {
    void fetch("/api/google/status").then((response) => response.ok ? response.json() : null).then((data) => setGoogleConnected(Boolean(data?.connected)));
  }, []);

  async function bookDemo() {
    if (!selected) return;
    setMessage("Booking your demo...");
    const response = await fetch("/api/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startAt: selected }) });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "Could not book this demo.");
      return;
    }
    setBooked(data.booking);
    setMessage("Demo booked. Check your email for the meeting details.");
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
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {slots.map((slot) => {
                const value = slot.toISOString();
                const active = value === selected;
                return <button key={value} type="button" onClick={() => setSelected(value)} className={`rounded-[10px] border px-3 py-3 text-left text-sm transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground"}`}><span className="block font-medium">{slot.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}</span><span className="mt-1 block opacity-70">{slot.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span></button>;
              })}
            </div>
            {!googleConnected ? <Button asChild className="mt-6 w-full rounded-[10px] py-6"><a href="/api/google/connect">Connect Google Calendar</a></Button> : <Button onClick={bookDemo} disabled={!selected || Boolean(booked)} className="mt-6 w-full rounded-[10px] py-6">Book Demo</Button>}
            {message && <p className="mt-4 text-sm text-muted-foreground">{message}</p>}
            {booked && <a className="mt-3 inline-block text-sm underline" href={booked.meetUrl} target="_blank" rel="noreferrer">Join your Google Meet</a>}
          </div>
          <aside className="space-y-4 text-sm text-muted-foreground">
            <div className="flex gap-3"><Clock className="h-5 w-5 shrink-0 text-foreground" /><span>One hour, scheduled at a time that works for you.</span></div>
            <div className="flex gap-3"><Video className="h-5 w-5 shrink-0 text-foreground" /><span>A Google Meet link is created automatically.</span></div>
            <div className="flex gap-3"><CheckCircle2 className="h-5 w-5 shrink-0 text-foreground" /><span>After booking, your AI and Tally features unlock.</span></div>
            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/demo">
                <Button variant="outline" className="mt-4 w-full rounded-[10px]">Sign in to book</Button>
              </SignInButton>
            </SignedOut>
            <SignedIn>
              <p className="mt-4 text-xs text-muted-foreground">You are signed in and ready to book.</p>
              {googleConnected && <a className="mt-2 inline-block text-xs underline" href="/api/google/connect">Reconnect Google Calendar</a>}
            </SignedIn>
          </aside>
        </section>
      </div>
    </main>
  );
}