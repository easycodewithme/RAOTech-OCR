"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

/* ────────────────────────────────────────────────────────────────
   Types & Razorpay Gateway
   ──────────────────────────────────────────────────────────────── */

type RazorpayResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string };
  theme: { color: string };
  handler: (response: RazorpayResponse) => Promise<void>;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

async function goToPaymentGateway(
  plan: "professional" | "business" | "enterprise",
  onSuccess?: () => void
) {
  try {
    const isScriptLoaded = await loadRazorpayScript();
    if (!isScriptLoaded) {
      alert("Failed to load Razorpay SDK. Please check your internet connection.");
      return;
    }

    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, billing: "monthly", users: 1 }),
    });

    const data = await res.json();
    if (!data.success) {
      alert(data.error || "Could not initialize checkout order.");
      return;
    }

    const key = data.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!key) {
      alert("Razorpay Key ID is missing. Please check your environment variables.");
      return;
    }

    const planTitles: Record<string, string> = {
      professional: "Professional Plan",
      business: "Business Plan",
      enterprise: "Enterprise Plan",
    };

    const options: RazorpayOptions = {
      key,
      amount: data.amount,
      currency: data.currency,
      name: "RaoAI",
      description: `${planTitles[plan] || "Subscription"} (Monthly)`,
      order_id: data.orderId,
      prefill: {
        name: "Customer",
        email: "customer@example.com",
      },
      theme: {
        color: "#0b0d10",
      },
      handler: async function (response: RazorpayResponse) {
        const verifyRes = await fetch("/api/billing/checkout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });

        const verifyData = await verifyRes.json();
        if (verifyData.success) {
          if (onSuccess) onSuccess();
        } else {
          alert("Payment verification failed.");
        }
      },
    };

    if (!window.Razorpay) {
      alert("Razorpay SDK is unavailable.");
      return;
    }

    const paymentObject = new window.Razorpay(options);
    paymentObject.open();
  } catch (err: unknown) {
    console.error("[Razorpay Gateway Error]:", err);
    alert(
      "Checkout error: " +
        (err instanceof Error ? err.message : "Failed to initiate payment")
    );
  }
}

/* ────────────────────────────────────────────────────────────────
   Custom Bullet Icon matching PDF (target ring with center dot)
   Rendered in crisp monochrome (black and white)
   ──────────────────────────────────────────────────────────────── */
function BulletIcon() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 shrink-0 text-foreground"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────
   Page Component (Black and White Theme)
   ──────────────────────────────────────────────────────────────── */
export default function PricingPage() {
  const router = useRouter();
  const { isSignedIn } = useUser();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  async function handleSelectPlan(plan: "professional" | "business" | "enterprise") {
    if (plan === "enterprise") {
      router.push("/book-your-demo");
      return;
    }

    setLoadingPlan(plan);
    try {
      await goToPaymentGateway(plan, () => {
        router.push("/dashboard");
      });
    } finally {
      setLoadingPlan(null);
    }
  }

  function handleStartFree() {
    if (isSignedIn) {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between font-sans selection:bg-foreground selection:text-background">
      {/* ── Top Header Bar (Black & White Theme) ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-6 lg:px-8">
          {/* Brand Logo & Subtitle */}
          <Link href="/" className="flex items-center gap-3.5 group">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background text-xl font-extrabold shadow-sm transition-transform group-hover:scale-105">
              R
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold tracking-tight text-foreground leading-tight">
                RaoAI
              </span>
              <span className="text-xs text-muted-foreground font-normal leading-tight">
                Invoice automation platform
              </span>
            </div>
          </Link>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <Link href="/#platform" className="hover:text-foreground transition-colors">
              Product
            </Link>
            <Link href="/#platform" className="hover:text-foreground transition-colors">
              Features
            </Link>
            <Link
              href="/pricing"
              className="text-foreground font-medium relative py-1 after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-foreground"
            >
              Pricing
            </Link>
            <Link href="/book-your-demo" className="hover:text-foreground transition-colors">
              Demo
            </Link>
          </nav>

          {/* Right Header Area */}
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline-block font-mono text-[11px] font-normal uppercase tracking-[0.25em] text-muted-foreground mr-2">
              P R I C I N G
            </span>
            {isSignedIn ? (
              <Button
                onClick={() => router.push("/dashboard")}
                className="rounded-xl bg-foreground hover:bg-foreground/90 text-background text-xs font-semibold px-4 py-2"
              >
                Dashboard
              </Button>
            ) : (
              <div className="flex items-center gap-2.5">
                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                  <Button
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground hover:bg-secondary rounded-xl text-xs font-medium px-3.5"
                  >
                    Sign In
                  </Button>
                </SignInButton>
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <Button className="rounded-xl bg-foreground hover:bg-foreground/90 text-background text-xs font-semibold px-4 py-2 shadow-sm">
                    Sign Up
                  </Button>
                </SignUpButton>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Content Area ── */}
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-12 lg:py-16">
          {/* Header Title Section */}
          <div className="max-w-2xl">
            <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-extrabold tracking-tight text-foreground leading-tight">
              Plans &amp; Pricing
            </h1>
            <p className="mt-3 text-base sm:text-lg text-muted-foreground font-normal">
              Simple, scalable invoice automation for CA firms and businesses.
            </p>
          </div>

          {/* ── 3-Column Pricing Grid ── */}
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 items-stretch">
            {/* ── CARD 1: Professional (Most Popular) ── */}
            <div className="relative flex flex-col rounded-[26px] border-2 border-foreground bg-card p-7 lg:p-8 shadow-lg shadow-black/40 transition-all">
              {/* Most Popular Badge */}
              <div className="absolute -top-3.5 left-8 rounded-full bg-foreground px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-background shadow-md">
                MOST POPULAR
              </div>

              {/* Title & Price */}
              <div className="pt-2">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">
                  Professional
                </h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    ₹7,999
                  </span>
                  <span className="text-muted-foreground text-sm font-normal">/month</span>
                </div>
              </div>

              {/* Divider */}
              <div className="my-6 border-t border-border" />

              {/* Best For Section */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  BEST FOR
                </p>
                <p className="mt-1.5 text-sm font-semibold text-foreground leading-snug">
                  CA firms and growing professional teams
                </p>
              </div>

              {/* Bullet Features */}
              <ul className="mt-6 space-y-4 flex-1">
                <li className="flex items-start gap-3">
                  <BulletIcon />
                  <span className="text-sm text-muted-foreground leading-snug">
                    Built for regular invoice-processing workflows
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <BulletIcon />
                  <span className="text-sm text-muted-foreground leading-snug">
                    The step from manual work to automation
                  </span>
                </li>
              </ul>

              {/* Card Action: Schedule a Demo linking to /book-your-demo */}
              <div className="mt-8 pt-2">
                <Link href="/book-your-demo" className="w-full block">
                  <Button className="w-full rounded-xl bg-foreground hover:bg-foreground/90 text-background font-semibold py-5 text-sm shadow-sm transition-colors">
                    Schedule a Demo
                  </Button>
                </Link>
              </div>
            </div>

            {/* ── CARD 2: Business ── */}
            <div className="relative flex flex-col rounded-[26px] border border-border bg-card p-7 lg:p-8 shadow-sm transition-all hover:border-border/80">
              {/* Title & Price */}
              <div className="pt-2">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">
                  Business
                </h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    ₹14,999
                  </span>
                  <span className="text-muted-foreground text-sm font-normal">/month</span>
                </div>
              </div>

              {/* Divider */}
              <div className="my-6 border-t border-border" />

              {/* Best For Section */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  BEST FOR
                </p>
                <p className="mt-1.5 text-sm font-semibold text-foreground leading-snug">
                  Medium businesses and larger CA firms
                </p>
              </div>

              {/* Bullet Features */}
              <ul className="mt-6 space-y-4 flex-1">
                <li className="flex items-start gap-3">
                  <BulletIcon />
                  <span className="text-sm text-muted-foreground leading-snug">
                    For larger teams and higher volumes
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <BulletIcon />
                  <span className="text-sm text-muted-foreground leading-snug">
                    Higher operational requirements covered
                  </span>
                </li>
              </ul>

              {/* Card Action: Schedule a Demo */}
              <div className="mt-8 pt-2">
                <Link href="/book-your-demo" className="w-full block">
                  <Button
                    variant="outline"
                    className="w-full rounded-xl border-border bg-transparent hover:bg-secondary text-foreground font-semibold py-5 text-sm shadow-sm transition-colors"
                  >
                    Schedule a Demo
                  </Button>
                </Link>
              </div>
            </div>

            {/* ── CARD 3: Enterprise ── */}
            <div className="relative flex flex-col rounded-[26px] border border-border bg-card p-7 lg:p-8 shadow-sm transition-all hover:border-border/80">
              {/* Title & Price */}
              <div className="pt-2">
                <h3 className="text-2xl font-bold tracking-tight text-foreground">
                  Enterprise
                </h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-extrabold tracking-tight text-foreground">
                    ₹25,000+
                  </span>
                  <span className="text-muted-foreground text-sm font-normal">/month</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground font-medium">
                  ₹25,000–₹50,000+ range
                </p>
              </div>

              {/* Divider */}
              <div className="my-6 border-t border-border" />

              {/* Best For Section */}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  BEST FOR
                </p>
                <p className="mt-1.5 text-sm font-semibold text-foreground leading-snug">
                  Large firms and companies with advanced requirements
                </p>
              </div>

              {/* Bullet Features */}
              <ul className="mt-6 space-y-4 flex-1">
                <li className="flex items-start gap-3">
                  <BulletIcon />
                  <span className="text-sm text-muted-foreground leading-snug">
                    Customised workflows and integrations
                  </span>
                </li>
                <li className="flex items-start gap-3">
                  <BulletIcon />
                  <span className="text-sm text-muted-foreground leading-snug">
                    Dedicated support and scale
                  </span>
                </li>
              </ul>

              {/* Card Action: Schedule a Demo */}
              <div className="mt-8 pt-2">
                <Link href="/book-your-demo" className="w-full block">
                  <Button
                    variant="outline"
                    className="w-full rounded-xl border-border bg-transparent hover:bg-secondary text-foreground font-semibold py-5 text-sm shadow-sm transition-colors"
                  >
                    Schedule a Demo
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* ── Callout Banner: "Why ₹7,999/month is the main plan" ── */}
          <div className="mt-14 rounded-2xl border border-border bg-card/70 p-6 sm:p-8 shadow-sm flex items-start gap-5 sm:gap-6">
            <div className="w-1.5 self-stretch rounded-full bg-foreground shrink-0 min-h-[80px]" />
            <div className="space-y-2.5">
              <h4 className="text-base sm:text-lg font-bold text-foreground">
                Why ₹7,999/month is the main plan
              </h4>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The Professional plan is designed to be the sweet spot for CA firms: powerful
                enough for regular invoice-processing workflows, while remaining accessible
                for firms that are moving from manual work to automation.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                <strong className="font-semibold text-foreground">
                  Scale when you need more.
                </strong>{" "}
                Move to Business for larger teams and higher operational requirements, or
                Enterprise for customised workflows, integrations, support and scale.
              </p>
            </div>
          </div>

          {/* ── Bottom Action CTAs & Growth Info ── */}
          <div className="mt-12 flex flex-col md:flex-row md:items-center justify-between gap-8 pt-4">
            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-4">
              {isSignedIn ? (
                <Button
                  onClick={handleStartFree}
                  className="rounded-xl bg-foreground hover:bg-foreground/90 text-background font-semibold text-sm px-8 py-3.5 h-auto shadow-sm"
                >
                  Start free
                </Button>
              ) : (
                <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
                  <Button className="rounded-xl bg-foreground hover:bg-foreground/90 text-background font-semibold text-sm px-8 py-3.5 h-auto shadow-sm">
                    Start free
                  </Button>
                </SignUpButton>
              )}

              <Link href="/book-your-demo">
                <Button
                  variant="outline"
                  className="rounded-xl border-border bg-transparent hover:bg-secondary text-foreground font-semibold text-sm px-8 py-3.5 h-auto shadow-sm"
                >
                  Book a demo
                </Button>
              </Link>
            </div>

            {/* Growth Note */}
            <div className="max-w-md text-left md:text-right space-y-1">
              <p className="text-sm font-semibold text-foreground">
                All plans are designed to grow with your workflow.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Contact RaoAI for enterprise requirements, custom integrations, team setup or
                volume-based pricing.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer Strip (Black & White Theme) ── */}
      <footer className="border-t border-border bg-background text-muted-foreground py-6 px-6 lg:px-8">
        <div className="mx-auto max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-normal">
          <p className="text-foreground/90">
            RaoAI — invoice automation for CA firms and businesses
          </p>
          <p className="text-muted-foreground">
            Prices in INR, per month. Enterprise pricing on request.
          </p>
        </div>
      </footer>
    </div>
  );
}
