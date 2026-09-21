"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import {
  ArrowRight,
  FileStack,
  MessageSquareText,
  FileSpreadsheet,
  Users,
  Volume2,
  VolumeX,
  ChevronDown,
  Play,
  Clock,
  CheckCircle2,
  Zap,
  ShieldCheck,
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

const PIPELINE = [
  {
    cmd: "intake --source=upload,email",
    title: "Ingest",
    detail:
      "Drop in PDFs, scans, or photographed invoices — one at a time or in bulk.",
  },
  {
    cmd: "extract --engine=ocr",
    title: "Extract",
    detail:
      "Line items, GSTIN, tax splits, and totals are pulled out and structured automatically.",
  },
  {
    cmd: "reconcile --against=gstr-2b",
    title: "Reconcile",
    detail:
      "Purchase register is matched against GSTR-2B so mismatches surface before your return does.",
  },
  {
    cmd: "sync --target=tally",
    title: "Sync",
    detail:
      "Approved vouchers export straight to Tally XML, ledgers mapped, ready to import.",
  },
];

const PILLARS = [
  {
    icon: FileStack,
    eyebrow: "Document Intelligence",
    title: "Smart OCR & Intake",
    description:
      "Bulk-upload PDFs, PNGs, and JPEGs. RAO AI extracts line items and totals so nobody re-types an invoice by hand.",
    href: "/upload",
    cta: "Open intake",
  },
  {
    icon: MessageSquareText,
    eyebrow: "Conversational AI",
    title: "AI Chat Assistant",
    description:
      'Ask it directly — "what was my total purchases last month" — and get an answer pulled from your own ledgers.',
    href: "/chat",
    cta: "Ask a question",
  },
  {
    icon: FileSpreadsheet,
    eyebrow: "Compliance & Sync",
    title: "GST Reconciliation & Tally Sync",
    description:
      "Match your purchase register against GSTR-2B, resolve the gaps, then export approved vouchers as Tally XML.",
    href: "/gst",
    cta: "Reconcile GST",
  },
  {
    icon: Users,
    eyebrow: "Client & Team Communication",
    title: "Communication Hub",
    description:
      "Message clients and your team in one place — threads, groups, and shared context, without leaving the workspace.",
    href: "/communication",
    cta: "Open communication hub",
  },
];

const RESULTS = [
  {
    icon: Clock,
    value: "80%",
    label: "Time saved",
    detail:
      "Less manual data entry across intake, reconciliation, and voucher review.",
  },
  {
    icon: CheckCircle2,
    value: "100%",
    label: "Accuracy",
    detail:
      "Every extracted line item is verified before it reaches Tally.",
  },
  {
    icon: Zap,
    value: "5x",
    label: "Faster reconciliation",
    detail:
      "GST matching that used to take days now clears in hours.",
  },
  {
    icon: ShieldCheck,
    value: "0",
    label: "Duplicate entries",
    detail:
      "Ledger mapping rules catch repeats before they're synced.",
  },
];

const FAQS = [
  {
    q: "What is RAO AI?",
    a: "RAO AI is an automation layer for CA firms and accounting teams it reads your invoices, reconciles GST, and keeps Tally in sync, so the manual data-entry work disappears.",
  },
  {
    q: "What files can I upload?",
    a: "PDF, PNG, and JPEG for now, uploaded one at a time or in bulk. Extraction runs the same way either way.",
  },
  {
    q: "Does it work with Tally?",
    a: "Yes. Once vouchers are reviewed and approved, RAO AI exports a Tally XML file with ledgers already mapped, ready to import into TallyPrime.",
  },
  {
    q: "How does GST reconciliation work?",
    a: "Your purchase register is matched line-by-line against GSTR-2B. Anything that doesn't match is flagged so you can resolve it before filing.",
  },
  {
    q: "Is my data private to my firm?",
    a: "Every account is scoped to its own workspace and sign-in is handled through Clerk. You control who on your team has access.",
  },
];

export default function LandingPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isMuted, setIsMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const heroDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 lg:px-6">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight"
          >
            RAO AI
          </Link>

          <nav className="ml-10 hidden items-center gap-6 font-mono text-xs uppercase tracking-[0.15em] text-muted-foreground md:flex">
            <a
              href="#platform"
              className="transition-colors hover:text-foreground"
            >
              Platform
            </a>

            <a
              href="#how-it-works"
              className="transition-colors hover:text-foreground"
            >
              How it works
            </a>

            <a
              href="#faq"
              className="transition-colors hover:text-foreground"
            >
              FAQ
            </a>
          </nav>

          <div className="ml-auto">
            {/*
              Goes to the app, not to the price list. A button labelled
              "Login / Register" that lands on /pricing is a dead end twice
              over: nothing in this product gates on `User.plan`, so there is
              nothing to buy before signing in, and the checkout it offers
              cannot complete without Razorpay keys. /dashboard is the right
              target for both states — the proxy sends a signed-out visitor to
              Clerk and back here afterwards, and a signed-in one straight in.
            */}
            <Link href="/dashboard">
              <Button className="rounded-none bg-primary text-primary-foreground hover:bg-primary/90">
                Login / Register
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="w-full border-b border-border bg-background">
          <div className="w-full bg-black">
            <div className="mx-auto w-full max-w-[1600px]">
              <div className="relative aspect-video w-full overflow-hidden">
                <video
                  ref={videoRef}
                  className="absolute inset-0 h-full w-full object-cover"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  onLoadedData={() => {
                    setVideoError(false);
                  }}
                  onCanPlay={() => {
                    setVideoError(false);
                  }}
                  onPlay={() => {
                    setIsPlaying(true);
                  }}
                  onPause={() => {
                    setIsPlaying(false);
                  }}
                  onError={() => {
                    setVideoError(true);
                  }}
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
                  aria-label={
                    isMuted ? "Unmute video" : "Mute video"
                  }
                  className="absolute bottom-5 right-5 z-30 flex h-10 w-10 items-center justify-center bg-black/70 text-white ring-1 ring-white/20 transition-colors hover:bg-black"
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

          <div className="mx-auto max-w-6xl px-4 py-12 md:px-6 md:py-16 lg:py-20">
            <div className="grid gap-8 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {heroDate} — Built for Indian CA&apos;s &amp; tax teams
                </p>

                <h1 className="mt-4 max-w-4xl text-4xl font-extrabold uppercase leading-[0.95] tracking-tight md:text-6xl lg:text-7xl">
                  Your Work,
                  <br />
                  Our Trusted Care.
                </h1>
              </div>

              <div className="lg:pb-1">
                <p className="max-w-xl text-sm leading-7 text-muted-foreground md:text-base">
                  RAO AI reads your invoices, matches your GST, and keeps
                  Tally in sync — so your team stops re-typing what a machine
                  can read.
                </p>

                <div className="mt-7 flex flex-wrap gap-3">
                  <Link href="/dashboard">
                    <Button
                      size="lg"
                      className="rounded-none bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      Get started
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>

                  <a href="#how-it-works">
                    <Button
                      size="lg"
                      variant="outline"
                      className="rounded-none border-border bg-transparent hover:bg-accent"
                    >
                      See how it works
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-card/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-border md:grid-cols-4">
            {[
              ["Document types", "PDF · PNG · JPEG"],
              ["Reconciliation", "Matched to GSTR-2B"],
              ["Export target", "Tally XML"],
              ["Access", "Per-firm workspace"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="bg-background px-5 py-6"
              >
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

        <section
          id="how-it-works"
          className="scroll-mt-14 border-b border-border py-20 md:py-28"
        >
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <Reveal>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                How it works
              </p>

              <h2 className="mt-2 max-w-xl text-2xl font-bold uppercase tracking-tight md:text-4xl">
                One pipeline, four stages
              </h2>
            </Reveal>

            <Reveal
              delay={100}
              className="mt-10"
            >
              <div className="overflow-hidden border border-border bg-card font-mono text-xs md:text-sm">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />

                  <span className="ml-2 text-muted-foreground">
                    rao-ai — pipeline
                  </span>
                </div>

                <div className="divide-y divide-border">
                  {PIPELINE.map((step, i) => (
                    <div
                      key={step.title}
                      className="grid gap-3 px-4 py-5 md:grid-cols-[minmax(250px,auto)_1fr] md:items-start md:gap-8"
                    >
                      <div className="min-w-0 break-words">
                        <span className="text-muted-foreground">
                          $
                        </span>{" "}
                        <span className="text-foreground">
                          {step.cmd}
                        </span>
                      </div>

                      <p className="font-sans leading-6 text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {`0${i + 1} ${step.title} — `}
                        </span>

                        {step.detail}
                      </p>
                    </div>
                  ))}

                  <div className="flex items-center gap-2 px-4 py-4 text-muted-foreground">
                    <span>$</span>

                    <span className="inline-block h-4 w-2 animate-pulse bg-foreground/70" />
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

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
                Four tools, one workspace
              </h2>
            </Reveal>

            <div className="mt-10 grid overflow-hidden border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
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
                  <Reveal
                    key={title}
                    delay={i * 100}
                  >
                    <Link
                      href={href}
                      className="group flex min-h-[320px] h-full flex-col bg-background p-6 transition-colors hover:bg-card md:p-8"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-accent/40">
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

                      <span className="mt-auto inline-flex items-center gap-1 pt-6 text-sm font-medium text-foreground">
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

            <div className="mt-10 grid overflow-hidden border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {RESULTS.map(({ icon: Icon, value, label, detail }, i) => (
                <Reveal
                  key={label}
                  delay={i * 100}
                  className="bg-background p-6 md:p-8"
                >
                  <div className="flex h-10 w-10 items-center justify-center border border-border bg-accent/40">
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

        <section
          id="faq"
          className="scroll-mt-14 py-20 md:py-28"
        >
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
                      onClick={() => {
                        setOpenFaq(open ? null : i);
                      }}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-4 py-5 text-left"
                    >
                      <span className="font-medium">
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
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 md:grid-cols-[1.5fr_1fr_1fr] md:px-6">
          <div>
            <p className="text-lg font-bold tracking-tight">
              RAO AI
            </p>

            <p className="mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
              Invoice extraction, GST reconciliation, and Tally sync
              for accounting teams.
            </p>

            <p className="mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
              All systems operational
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
                  Transactions &amp; Tally
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
                <Link
                  href="/sign-in"
                  className="text-muted-foreground hover:text-foreground"
                >
                  Sign in
                </Link>
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
