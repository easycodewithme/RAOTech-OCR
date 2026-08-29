"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Cloud,
  Headphones,
  Lock,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────
   Static content
   ──────────────────────────────────────────────────────────────── */

const INDIVIDUAL_FEATURES = [
  "1 User",
  "AI Invoice Scanning",
  "Automatic Data Extraction",
  "Invoice Management",
  "GST Data Extraction",
  "Dashboard & Reports",
  "Basic Integrations",
  "Secure Cloud Storage",
  "Email Support",
];

const ENTERPRISE_FEATURES_LEFT = [
  "Multiple Employees",
  "Centralized Workspace",
  "Employee Invitations",
  "Role-Based Access",
  "Team Management",
  "Advanced Integrations",
];

const ENTERPRISE_FEATURES_RIGHT = [
  "Company-Level Reports",
  "Centralized Processing",
  "Admin Controls",
  "Audit Logs",
  "Priority Support",
  "Dedicated Onboarding",
];

const TRUST_STRIP = [
  { icon: ShieldCheck, label: "Bank-grade Security" },
  { icon: Cloud, label: "99.9% Uptime" },
  { icon: Lock, label: "Secure Cloud" },
  { icon: Check, label: "GDPR Compliant" },
];

const INDIVIDUAL_MONTHLY_PRICE = 1499;
const ENTERPRISE_UNIT_MONTHLY_PRICE = 499;
const YEARLY_DISCOUNT = 0.2;

type Billing = "monthly" | "yearly";

/* ────────────────────────────────────────────────────────────────
   Backend hand-off placeholders
   These functions are the ONLY thing that should be replaced once
   the real payment gateway is wired up on the backend. Nothing else
   on this page needs to change.
   ──────────────────────────────────────────────────────────────── */

const loadRazorpayScript = (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && (window as any).Razorpay) {
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
  plan: "individual" | "enterprise",
  meta?: { billing: Billing; users?: number },
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
      body: JSON.stringify({ plan, billing: meta?.billing, users: meta?.users }),
    });

    const data = await res.json();
    if (!data.success) {
      alert(data.error || "Could not initialize checkout order.");
      return;
    }

    const key = data.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!key) {
      alert("Razorpay Key ID is missing. Please check your Vercel Environment Variables.");
      return;
    }

    const options = {
      key,
      amount: data.amount,
      currency: data.currency,
      name: "RAO AI",
      description: `${plan === "individual" ? "Individual Plan" : "Enterprise Plan"} (${meta?.billing || "monthly"})`,
      order_id: data.orderId,
      prefill: {
        name: "Customer",
        email: "customer@example.com",
      },
      theme: {
        color: "#0f172a",
      },
      handler: async function (response: any) {
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

    const paymentObject = new (window as any).Razorpay(options);
    paymentObject.open();
  } catch (err: any) {
    console.error("[Razorpay Gateway Error]:", err);
    alert("Checkout error: " + (err?.message || "Failed to initiate payment"));
  }
}

function formatINR(value: number) {
  return `₹${value.toLocaleString("en-IN")}`;
}

/* ────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────── */

export default function PricingPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing>("monthly");
  const [numUsers, setNumUsers] = useState("");
  const [enterpriseError, setEnterpriseError] = useState(false);

  const individualPrice =
    billing === "yearly"
      ? Math.round(INDIVIDUAL_MONTHLY_PRICE * (1 - YEARLY_DISCOUNT))
      : INDIVIDUAL_MONTHLY_PRICE;

  const enterpriseUnitPrice =
    billing === "yearly"
      ? Math.round(ENTERPRISE_UNIT_MONTHLY_PRICE * (1 - YEARLY_DISCOUNT))
      : ENTERPRISE_UNIT_MONTHLY_PRICE;

  const parsedUsers = useMemo(() => {
    const n = parseInt(numUsers, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [numUsers]);

  const estimatedTotal = parsedUsers * enterpriseUnitPrice;

  function handleChooseIndividual() {
    void goToPaymentGateway("individual", { billing }, () => {
      router.push("/dashboard");
    });
  }

  function handleContinueEnterprise() {
    if (parsedUsers <= 0) {
      setEnterpriseError(true);
      return;
    }
    setEnterpriseError(false);
    void goToPaymentGateway("enterprise", { billing, users: parsedUsers }, () => {
      router.push(`/enterprise/invite?seats=${parsedUsers}`);
    });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center px-6 lg:px-10">
          <Link href="/" className="text-lg font-bold tracking-tight">
            RAO AI
          </Link>

          <nav className="ml-12 hidden items-center gap-8 text-sm text-muted-foreground md:flex">
            <Link href="/#platform" className="transition-colors hover:text-foreground">
              Product
            </Link>
            <Link href="/#platform" className="transition-colors hover:text-foreground">
              Features
            </Link>
            <Link
              href="/pricing"
              className="relative pb-[22px] pt-[22px] text-foreground after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-foreground"
            >
              Pricing
            </Link>
            <button
              type="button"
              className="flex items-center gap-1 transition-colors hover:text-foreground"
            >
              Resources
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <SignInButton mode="modal" forceRedirectUrl="/dashboard">
              <Button variant="outline" className="rounded-[8px] border-border">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal" forceRedirectUrl="/dashboard">
              <Button className="rounded-[8px] bg-primary text-primary-foreground hover:bg-primary/90">
                Sign Up
              </Button>
            </SignUpButton>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-[1440px] px-6 pt-16 pb-10 text-center lg:px-10">
          <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground">
            Pricing
          </span>

          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-bold tracking-tight md:text-5xl">
            Choose the right plan
            <br />
            for you or your company.
          </h1>

          <p className="mx-auto mt-4 max-w-lg text-base text-muted-foreground">
            Powerful invoice automation for individuals and enterprises of any
            size.
          </p>

          {/* Billing switch */}
          <div className="mx-auto mt-8 inline-flex items-center gap-1 rounded-[10px] border border-border bg-card p-1">
            <button
              type="button"
              onClick={() => setBilling("monthly")}
              className={cn(
                "rounded-[8px] px-5 py-2 text-sm font-medium transition-colors",
                billing === "monthly"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBilling("yearly")}
              className={cn(
                "flex items-center gap-2 rounded-[8px] px-5 py-2 text-sm font-medium transition-colors",
                billing === "yearly"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  billing === "yearly"
                    ? "bg-background/15 text-background"
                    : "bg-accent text-foreground"
                )}
              >
                Save 20%
              </span>
            </button>
          </div>
        </section>

        {/* Pricing cards */}
        <section className="mx-auto max-w-[1440px] px-6 pb-16 lg:px-10">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Individual */}
            <div className="flex flex-col rounded-[14px] border border-border bg-card p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
                <User className="h-5 w-5 text-foreground" />
              </div>

              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Individual Account
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                For professionals managing invoices on their own.
              </p>

              <div className="my-6 border-t border-border" />

              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight">
                  {formatINR(individualPrice)}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {billing === "yearly" ? "month, billed yearly" : "month"}
                </span>
              </div>

              <ul className="mt-6 space-y-3">
                {INDIVIDUAL_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-foreground" />
                    <span className="text-foreground/90">{feature}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-1 flex-col justify-end">
                <Button
                  onClick={handleChooseIndividual}
                  className="w-full rounded-[10px] bg-primary py-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Choose Individual
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Perfect for freelancers and consultants.
                </p>
              </div>
            </div>

            {/* Enterprise */}
            <div className="relative flex flex-col rounded-[14px] border border-foreground/30 bg-card p-8">
              <span className="absolute right-8 top-8 rounded-full border border-border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Most Flexible
              </span>

              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
                <Building2 className="h-5 w-5 text-foreground" />
              </div>

              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Enterprise Account
              </p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                For companies managing invoices across teams of any size.
              </p>

              <div className="my-6 border-t border-border" />

              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Price per user / month
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-4xl font-bold tracking-tight">
                  {formatINR(enterpriseUnitPrice)}
                </span>
                <span className="text-sm text-muted-foreground">
                  per user / month
                </span>
              </div>

              {/* Number of users */}
              <div className="mt-6">
                <label
                  htmlFor="num-users"
                  className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                >
                  Number of users
                </label>
                <div className="relative mt-2">
                  <input
                    id="num-users"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={numUsers}
                    onChange={(e) => {
                      setNumUsers(e.target.value);
                      if (enterpriseError) setEnterpriseError(false);
                    }}
                    placeholder="Enter number of users"
                    className={cn(
                      "h-11 w-full rounded-[10px] border bg-background px-4 pr-10 text-sm text-foreground outline-none placeholder:text-muted-foreground/70",
                      "focus-visible:ring-[3px] focus-visible:ring-ring/40",
                      enterpriseError ? "border-destructive" : "border-border"
                    )}
                  />
                  <Users className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  No minimum. Scale to thousands.
                </p>
              </div>

              {/* Dynamic total */}
              <div className="mt-6 rounded-[10px] border border-border bg-background p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Estimated total / month
                </p>
                <p className="mt-2 text-3xl font-bold tracking-tight">
                  {formatINR(estimatedTotal)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {parsedUsers > 0
                    ? `${parsedUsers} user${parsedUsers === 1 ? "" : "s"} × ${formatINR(
                        enterpriseUnitPrice
                      )}`
                    : "Enter number of users to see total"}
                </p>
              </div>

              {/* Feature checklist */}
              <p className="mt-8 text-sm font-semibold">
                Everything in Individual, plus:
              </p>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
                {ENTERPRISE_FEATURES_LEFT.map((feature) => (
                  <div key={feature} className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-foreground" />
                    <span className="text-foreground/90">{feature}</span>
                  </div>
                ))}
                {ENTERPRISE_FEATURES_RIGHT.map((feature) => (
                  <div key={feature} className="flex items-center gap-2.5 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-foreground" />
                    <span className="text-foreground/90">{feature}</span>
                  </div>
                ))}
              </div>

              <div className="mt-8 flex flex-1 flex-col justify-end">
                <Button
                  onClick={handleContinueEnterprise}
                  className="w-full rounded-[10px] bg-primary py-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Continue with Enterprise
                  <ArrowRight className="h-4 w-4" />
                </Button>
                {enterpriseError ? (
                  <p className="mt-3 text-center text-xs text-destructive">
                    Enter the number of users to continue.
                  </p>
                ) : (
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    You can add or manage users anytime.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Contact sales */}
          <div className="mt-6 flex flex-col items-start gap-6 rounded-[14px] border border-border bg-card p-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-5">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                <Headphones className="h-5 w-5 text-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold">
                  Need custom pricing for your organization?
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Talk to our sales team for enterprise plans tailored for
                  you.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full shrink-0 rounded-[10px] border-border sm:w-auto"
            >
              Contact Sales
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Trust strip */}
          <div className="mt-12 grid grid-cols-2 gap-6 border-t border-border pt-10 sm:grid-cols-4">
            {TRUST_STRIP.map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center justify-center gap-2.5">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
