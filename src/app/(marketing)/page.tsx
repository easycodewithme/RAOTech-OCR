"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";

import {
  ArrowRight,
  FileStack,
  MessageSquareText,
  FileSpreadsheet,
  Users,
  Volume2,
  VolumeX,
  Play,
  Clock,
  CheckCircle2,
  Zap,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (reducedMotion) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.1,
      }
    );

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  return {
    ref,
    visible,
  };
}

function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, visible } = useReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-6 opacity-0"
      } ${className}`}
      style={{
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

const PILLARS = [
  {
    icon: FileStack,
    eyebrow: "Document Intelligence",
    title: "Smart OCR & Intake",
    description:
      "Bulk-upload PDFs, PNGs, and JPEGs. RAO AI extracts line items, totals, and tax splits automatically without manual data entry.",
    href: "/upload",
    cta: "Open intake",
  },
  {
    icon: MessageSquareText,
    eyebrow: "Conversational AI",
    title: "AI Chat Assistant",
    description:
      'Ask directly — "what was my total purchase amount last month" — and get instant insights pulled from your structured data.',
    href: "/chat",
    cta: "Ask a question",
  },
  {
    icon: FileSpreadsheet,
    eyebrow: "Compliance & Sync",
    title: "GST Reconciliation & ERP Sync",
    description:
      "Match your purchase register against GSTR-2B, resolve mismatches, and export approved vouchers straight to your accounting system.",
    href: "/gst",
    cta: "Reconcile GST",
  },
  {
    icon: Users,
    eyebrow: "Client & Team Communication",
    title: "Communication Hub",
    description:
      "Message clients and your team in one centralized place with full context and file history.",
    href: "/communication",
    cta: "Open hub",
  },
];

const RESULTS = [
  {
    icon: Clock,
    value: "80%",
    label: "Time saved",
    detail:
      "Less manual data entry across document intake, reconciliation, and voucher review.",
  },
  {
    icon: CheckCircle2,
    value: "100%",
    label: "Accuracy",
    detail:
      "Every extracted line item is structured and verified before sync.",
  },
  {
    icon: Zap,
    value: "5x",
    label: "Faster processing",
    detail:
      "Tax matching and invoice validation that used to take days now clears in minutes.",
  },
  {
    icon: ShieldCheck,
    value: "0",
    label: "Duplicate entries",
    detail:
      "Automated ledger mapping rules catch repeats before export.",
  },
];

const FAQS = [
  {
    q: "What is RAO AI?",
    a: "RAO AI is an intelligent automation platform for finance and accounting teams — it processes invoices, reconciles tax registers, and seamlessly integrates with accounting systems.",
  },
  {
    q: "What file types can I upload?",
    a: "You can upload PDF, PNG, and JPEG documents, either individually or in bulk.",
  },
  {
    q: "Does it integrate with my accounting software?",
    a: "Yes. Once vouchers are reviewed and approved, RAO AI exports structured XML and CSV files with mapped ledgers ready for import into your accounting software.",
  },
  {
    q: "How does GST reconciliation work?",
    a: "Your purchase register is matched line-by-line against GSTR-2B records. Any discrepancies are highlighted instantly so you can resolve them prior to filing.",
  },
  {
    q: "Is my data secure and private?",
    a: "Every organization operates in an isolated workspace with enterprise authentication managed via Clerk. You maintain complete control over access permissions.",
  },
];

export default function LandingPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  useEffect(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.muted = true;

    const startVideo = async () => {
      try {
        await video.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    };

    startVideo();

    return () => {
      video.pause();
    };
  }, []);

  const playVideo = async () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    try {
      video.muted = isMuted;
      await video.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Video playback error:", error);
    }
  };

  const toggleMute = async () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const nextMuted = !video.muted;

    video.muted = nextMuted;
    setIsMuted(nextMuted);

    try {
      await video.play();
      setIsPlaying(true);
    } catch (error) {
      console.error("Video playback error:", error);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4 lg:px-6">
          <Link
            href="/"
            className="flex items-center gap-3 text-xl font-bold tracking-tight"
          >
            <span>RAO AI</span>
            <span className="font-mono text-[11px] font-normal tracking-[0.2em] text-muted-foreground uppercase">
              PLATFORM
            </span>
          </Link>

          <nav className="ml-10 hidden items-center gap-8 font-medium text-sm text-muted-foreground md:flex">
            <a
              href="#platform"
              className="transition-colors hover:text-foreground"
            >
              Platform
            </a>
            <a
              href="#results"
              className="transition-colors hover:text-foreground"
            >
              Results
            </a>
            <Link
              href="/pricing"
              className="transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <Button className="rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/80 px-6 font-medium shadow-sm transition-all">
                  Login / Register
                </Button>
              </SignInButton>
            </SignedOut>

            <SignedIn>
              <Link href="/dashboard">
                <Button className="rounded-full bg-primary font-medium text-primary-foreground hover:bg-primary/90 px-6 shadow-sm">
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </SignedIn>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* ── Hero & Framed Video ── */}
        <section className="w-full border-b border-border bg-background py-10 md:py-16">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Built for enterprise finance &amp; accounting teams
                </p>

                <h1 className="mt-4 max-w-4xl text-4xl font-extrabold uppercase leading-[0.95] tracking-tight md:text-6xl lg:text-7xl">
                  Your Work,
                  <br />
                  Our Trusted Care.
                </h1>
              </div>

              <div className="lg:pb-1">
                <p className="max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
                  RAO AI reads your invoices, reconciles tax data, and keeps
                  your accounting system in sync — eliminating manual data entry.
                </p>

                <div className="mt-7 flex flex-wrap gap-3.5">
                  <Link href="/dashboard">
                    <Button
                      size="lg"
                      className="rounded-full bg-primary px-7 py-6 font-semibold text-primary-foreground hover:bg-primary/90 shadow-md transition-all"
                    >
                      Get started
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>

                  <a href="#platform">
                    <Button
                      size="lg"
                      variant="outline"
                      className="rounded-full border-border px-7 py-6 font-semibold bg-background/50 hover:bg-accent transition-all"
                    >
                      Explore platform
                    </Button>
                  </a>
                </div>
              </div>
            </div>

            {/* ── Framed Video ── */}
            <div className="mt-12 md:mt-16">
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border/80 bg-black shadow-2xl ring-1 ring-white/10">
                <video
                  ref={videoRef}
                  className="absolute inset-0 h-full w-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  onLoadedData={() => setVideoError(false)}
                  onCanPlay={() => setVideoError(false)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onError={() => setVideoError(true)}
                >
                  <source
                    src="/static/kling_20260815_VIDEO_Updated_10_6126_0.mp4"
                    type="video/mp4"
                  />
                </video>

                <div className="pointer-events-none absolute inset-0 bg-black/5" />

                {!isPlaying && !videoError && (
                  <button
                    type="button"
                    onClick={playVideo}
                    aria-label="Play video"
                    className="absolute left-1/2 top-1/2 z-30 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-2xl transition-transform hover:scale-105"
                  >
                    <Play className="ml-1 h-7 w-7 fill-current" />
                  </button>
                )}

                {videoError && (
                  <div className="absolute inset-0 z-30 flex items-center justify-center bg-black">
                    <div className="px-6 text-center text-white">
                      <p className="font-mono text-xs uppercase tracking-[0.2em] text-white/50">
                        Video unavailable
                      </p>
                      <p className="mt-2 text-sm text-white/70">
                        Please check the video file.
                      </p>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? "Unmute video" : "Mute video"}
                  className="absolute bottom-5 right-5 z-30 flex h-10 w-10 items-center justify-center rounded-lg bg-black/70 text-white ring-1 ring-white/20 transition-colors hover:bg-black"
                >
                  {isMuted ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Feature Specs Bar ── */}
        <section className="border-b border-border bg-card/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border md:grid-cols-4">
            {[
              ["Document types", "PDF · PNG · JPEG"],
              ["Reconciliation", "GSTR-2B Matching"],
              ["Export target", "Accounting XML / CSV"],
              ["Access", "Per-firm workspace"],
            ].map(([label, value]) => (
              <div key={label} className="bg-background px-5 py-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-sm font-medium md:text-base">
                  {value}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Platform Pillars ── */}
        <section
          id="platform"
          className="scroll-mt-14 border-b border-border py-20 md:py-28"
        >
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Platform
              </p>

              <h2 className="mt-2 max-w-xl text-2xl font-bold uppercase tracking-tight md:text-4xl">
                Four tools, one unified workspace
              </h2>
            </Reveal>

            <div className="mt-10 grid overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
              {PILLARS.map(
                (
                  {
                    icon: Icon,
                    eyebrow,
                    title,
                    description,
                    href,
                    cta,
                  },
                  i
                ) => (
                  <Reveal key={title} delay={i * 100}>
                    <Link
                      href={href}
                      className="group flex min-h-[320px] h-full flex-col bg-background p-6 transition-colors hover:bg-card md:p-8"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-accent/40">
                        <Icon className="h-5 w-5" />
                      </div>

                      <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                        {eyebrow}
                      </p>

                      <h3 className="mt-1 text-lg font-semibold uppercase tracking-tight md:text-xl">
                        {title}
                      </h3>

                      <p className="mt-3 text-sm leading-6 text-muted-foreground">
                        {description}
                      </p>

                      <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-medium text-foreground">
                        {cta}
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </Link>
                  </Reveal>
                )
              )}
            </div>
          </div>
        </section>

        {/* ── Results ── */}
        <section
          id="results"
          className="scroll-mt-14 border-b border-border py-20 md:py-28"
        >
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Results
              </p>

              <h2 className="mt-2 max-w-xl text-2xl font-bold uppercase tracking-tight md:text-4xl">
                Real-world, proven results
              </h2>
            </Reveal>

            <div className="mt-10 grid overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {RESULTS.map(({ icon: Icon, value, label, detail }, i) => (
                <Reveal
                  key={label}
                  delay={i * 100}
                  className="bg-background p-6 md:p-8"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-accent/40">
                    <Icon className="h-5 w-5" />
                  </div>

                  <p className="mt-5 text-3xl font-extrabold tracking-tight md:text-4xl">
                    {value}
                  </p>

                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
                    {label}
                  </p>

                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {detail}
                  </p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ Section ── */}
        <section className="scroll-mt-14 py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 md:px-6">
            <Reveal>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                FAQ
              </p>

              <h2 className="mt-2 text-2xl font-bold uppercase tracking-tight md:text-4xl">
                Questions, answered
              </h2>
            </Reveal>

            <div className="mt-10 divide-y divide-border border-y border-border">
              {FAQS.map((item, i) => {
                const open = openFaq === i;

                return (
                  <div key={item.q}>
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-4 py-5 text-left"
                    >
                      <span className="font-medium text-base">
                        {item.q}
                      </span>

                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${
                          open ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    <div
                      className={`grid overflow-hidden transition-all duration-300 ease-out ${
                        open
                          ? "grid-rows-[1fr] pb-5 opacity-100"
                          : "grid-rows-[0fr] opacity-0"
                      }`}
                    >
                      <div className="min-h-0">
                        <p className="text-sm leading-6 text-muted-foreground">
                          {item.a}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Call To Action Banner ── */}
        <section className="border-t border-border bg-card/60 py-16 md:py-20">
          <div className="mx-auto max-w-4xl px-4 text-center md:px-6">
            <h2 className="text-3xl font-extrabold uppercase tracking-tight md:text-5xl">
              Ready to automate your document workflow?
            </h2>
            <p className="mt-4 text-muted-foreground md:text-lg">
              Join leading finance teams and CAs saving over 80% of manual entry time.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <SignedOut>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <Button
                    size="lg"
                    className="rounded-lg bg-primary px-8 py-6 font-semibold text-primary-foreground hover:bg-primary/90 shadow-lg transition-all"
                  >
                    Get Started Free
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </SignUpButton>
              </SignedOut>

              <SignedIn>
                <Link href="/dashboard">
                  <Button
                    size="lg"
                    className="rounded-lg bg-primary px-8 py-6 font-semibold text-primary-foreground hover:bg-primary/90 shadow-lg transition-all"
                  >
                    Get Started
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
              </SignedIn>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.5fr_1fr_1fr] md:px-6">
          <div>
            <p className="text-lg font-bold tracking-tight">
              RAO AI
            </p>

            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              Smart invoice extraction, GST reconciliation, and automated accounting sync for finance teams.
            </p>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              Platform
            </p>

            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href="/upload"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Upload &amp; intake
                </Link>
              </li>

              <li>
                <Link
                  href="/gst"
                  className="text-muted-foreground hover:text-foreground"
                >
                  GST reconciliation
                </Link>
              </li>

              <li>
                <Link
                  href="/transactions"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Transactions &amp; Export
                </Link>
              </li>

              <li>
                <Link
                  href="/chat"
                  className="text-muted-foreground hover:text-foreground"
                >
                  AI chat
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              Account
            </p>

            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link
                  href="/dashboard"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Dashboard
                </Link>
              </li>

              <li>
                <Link
                  href="/reports"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Reports
                </Link>
              </li>

              <li>
                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                  <button className="text-muted-foreground hover:text-foreground">
                    Sign in
                  </button>
                </SignInButton>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border px-4 py-4 md:px-6">
          <p className="mx-auto max-w-6xl text-xs text-muted-foreground">
            © {new Date().getFullYear()} RAO AI. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}