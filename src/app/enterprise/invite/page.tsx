"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { Suspense, useMemo, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  HelpCircle,
  Infinity as InfinityIcon,
  Mail,
  Send,
  Upload,
  Users,
  X,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────
   Types & mock data
   In production, seat count and company name come from the
   authenticated user's enterprise account (fetched server-side),
   not the query string. The `seats` query param is read here only
   so this page can be demoed / QA'd independently of the payment
   step on /pricing.
   ──────────────────────────────────────────────────────────────── */

type InvitationStatus = "Pending" | "Accepted";

interface Invitation {
  email: string;
  status: InvitationStatus;
  dateInvited: string;
}

const STEPS = [
  { id: "01", label: "Plan", state: "complete" as const },
  { id: "02", label: "Payment", state: "complete" as const },
  { id: "03", label: "Invite Team", state: "active" as const },
  { id: "04", label: "Workspace", state: "upcoming" as const },
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function splitEmails(raw: string): string[] {
  return raw
    .split(/[,\s\n]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

/* ────────────────────────────────────────────────────────────────
   Backend hand-off placeholder
   ──────────────────────────────────────────────────────────────── */

async function sendInvitationsToBackend(emails: string[]) {
  try {
    const res = await fetch("/api/enterprise/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails }),
    });
    const data = await res.json();
    return { ok: data.ok !== false };
  } catch (error) {
    console.error("[Invite API error]:", error);
    return { ok: false };
  }
}

function InviteTeamPageInner() {
  const searchParams = useSearchParams();

  // null = unlimited seats (matches the default enterprise experience).
  const seatLimit = useMemo(() => {
    const raw = searchParams.get("seats");
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [searchParams]);

  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [sending, setSending] = useState(false);
  const [limitError, setLimitError] = useState(false);

  const acceptedCount = invitations.filter((i) => i.status === "Accepted").length;
  const pendingCount = invitations.filter((i) => i.status === "Pending").length;
  const invitedCount = invitations.length;

  const seatsRemaining =
    seatLimit === null ? null : Math.max(seatLimit - invitedCount, 0);

  function commitDraftToChips(nextDraft: string) {
    const candidates = splitEmails(nextDraft);
    if (candidates.length === 0) return;

    const valid = candidates.filter((e) => EMAIL_REGEX.test(e));
    const deduped = Array.from(new Set([...chips, ...valid]));

    if (seatLimit !== null && deduped.length > seatLimit) {
      setChips(deduped.slice(0, seatLimit));
      setLimitError(true);
    } else {
      setChips(deduped);
    }
    setDraft("");
  }

  function handleDraftKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      if (draft.trim().length > 0) {
        e.preventDefault();
        commitDraftToChips(draft);
      }
    }
  }

  function removeChip(email: string) {
    setChips((prev) => prev.filter((e) => e !== email));
    setLimitError(false);
  }

  const canSend = chips.length > 0 && !sending;

  async function handleSendInvitations() {
    if (chips.length === 0) return;
    setSending(true);

    const result = await sendInvitationsToBackend(chips);

    if (result.ok) {
      const today = new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      setInvitations((prev) => [
        ...chips.map((email) => ({
          email,
          status: "Pending" as InvitationStatus,
          dateInvited: today,
        })),
        ...prev,
      ]);
      setChips([]);
    }

    setSending(false);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center px-6 lg:px-10">
          <div className="flex items-center gap-2">
            <Link href="/" className="text-lg font-bold tracking-tight">
              RAO AI
            </Link>
            <span className="text-border">|</span>
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              Enterprise Setup
            </span>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <button
              type="button"
              aria-label="Help"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground"
            >
              <HelpCircle className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold">
                AT
              </div>
              <span className="hidden text-sm text-foreground/90 sm:inline">
                ABC Traders Pvt. Ltd.
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-10 lg:px-10">
        {/* Stepper */}
        <ol className="mx-auto flex max-w-3xl items-center">
          {STEPS.map((step, i) => (
            <li key={step.id} className="flex flex-1 items-center last:flex-initial">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold",
                    step.state === "complete" &&
                      "border-foreground bg-foreground text-background",
                    step.state === "active" &&
                      "border-foreground text-foreground",
                    step.state === "upcoming" &&
                      "border-border text-muted-foreground"
                  )}
                >
                  {step.state === "complete" ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    step.id
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    step.state === "upcoming"
                      ? "text-muted-foreground"
                      : "text-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>

              {i < STEPS.length - 1 && (
                <div className="mx-3 mb-5 h-px flex-1 bg-border" />
              )}
            </li>
          ))}
        </ol>

        {/* Title */}
        <div className="mx-auto mt-12 max-w-xl text-center">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            Invite your team
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Invite your employees to start processing invoices together with
            RAO AI.
          </p>
        </div>

        {/* Plan summary */}
        <div className="mx-auto mt-10 flex max-w-5xl flex-col gap-6 rounded-[14px] border border-border bg-card p-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Your enterprise plan
              </p>
              <p className="mt-1 text-lg font-bold tracking-tight">
                {seatLimit === null ? "Unlimited Employees" : `${seatLimit} Employees`}
              </p>
            </div>
          </div>

          <div className="hidden h-10 w-px bg-border sm:block" />

          <div>
            <p className="text-sm text-foreground/90">
              {seatLimit === null ? "No user limit" : `${seatLimit} user limit`}
            </p>
            <p className="text-xs text-muted-foreground">
              {seatLimit === null
                ? "Add your entire team"
                : "Manage seats from your plan"}
            </p>
          </div>

          <Button
            variant="outline"
            className="rounded-[10px] border-border sm:ml-auto"
          >
            View Plan Details
          </Button>
        </div>

        {/* Two-column layout */}
        <div className="mx-auto mt-6 grid max-w-5xl gap-6 lg:grid-cols-[1.6fr_1fr]">
          {/* Left: invite employees */}
          <div className="rounded-[14px] border border-border bg-card p-6">
            <h2 className="text-lg font-semibold">Invite employees</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one or more email addresses to invite employees to your
              workspace.
            </p>

            <div className="relative mt-4 rounded-[10px] border border-border bg-background p-3">
              {chips.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {chips.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground/90"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => removeChip(email)}
                        aria-label={`Remove ${email}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleDraftKeyDown}
                onBlur={() => draft.trim() && commitDraftToChips(draft)}
                rows={3}
                placeholder={
                  chips.length === 0
                    ? "Enter email addresses\njohn@company.com, jane@company.com,\naccounts@company.com"
                    : "Add another email…"
                }
                className="w-full resize-none bg-transparent pr-8 text-sm text-foreground outline-none placeholder:whitespace-pre-line placeholder:text-muted-foreground/70"
              />

              <Mail className="pointer-events-none absolute bottom-3 right-3 h-4 w-4 text-muted-foreground" />
            </div>

            {limitError && (
              <p className="mt-2 text-xs text-destructive">
                You have reached the employee limit for this plan.
              </p>
            )}

            <div className="mt-4 space-y-2.5">
              {[
                "You can add multiple emails separated by comma, space or new line.",
                "Each employee will receive an invitation email.",
                "They can set up their account and start using RAO AI.",
              ].map((line) => (
                <div key={line} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
                  <span>{line}</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                console.log("[invite] TODO: open CSV / Excel import dialog")
              }
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-[10px] border border-dashed border-border py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <Upload className="h-4 w-4" />
              Add from CSV / Excel
            </button>

            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm font-semibold">Recent invitations</p>

              {invitations.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No invitations sent yet.
                </p>
              ) : (
                <div className="mt-3 divide-y divide-border overflow-hidden rounded-[10px] border border-border">
                  <div className="grid grid-cols-[1fr_auto_auto] gap-4 bg-background px-4 py-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    <span>Email</span>
                    <span>Status</span>
                    <span>Date invited</span>
                  </div>
                  {invitations.map((inv) => (
                    <div
                      key={inv.email}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-4 px-4 py-2.5 text-sm"
                    >
                      <span className="truncate text-foreground/90">
                        {inv.email}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs",
                          inv.status === "Accepted"
                            ? "text-foreground"
                            : "text-muted-foreground"
                        )}
                      >
                        <Circle className="h-2 w-2 fill-current" />
                        {inv.status}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {inv.dateInvited}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: team overview */}
          <div className="flex flex-col rounded-[14px] border border-border bg-card p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Team overview
            </p>

            <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background">
              <InfinityIcon className="h-6 w-6" />
            </div>

            <p className="mt-4 text-2xl font-bold tracking-tight">
              {seatLimit === null ? "Unlimited" : seatLimit}
            </p>
            <p className="text-xs text-muted-foreground">Total seats</p>

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2.5 text-muted-foreground">
                  <Users className="h-4 w-4" />
                  Invited
                </span>
                <span className="font-medium">{invitedCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2.5 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  Accepted
                </span>
                <span className="font-medium">{acceptedCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2.5 text-muted-foreground">
                  <Circle className="h-4 w-4" />
                  Pending
                </span>
                <span className="font-medium">{pendingCount}</span>
              </div>
            </div>

            {seatLimit !== null && (
              <p className="mt-4 text-xs text-muted-foreground">
                {seatsRemaining} / {seatLimit} seats invited
              </p>
            )}

            <div className="my-6 border-t border-border" />

            <p className="text-sm text-muted-foreground">
              {seatLimit === null
                ? "You can invite as many employees as your organization needs."
                : "You can invite employees up to your plan's seat limit."}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              {seatLimit === null
                ? "There is no limit on the number of users you can add."
                : "Need more seats? Upgrade your plan from Plan Details."}
            </p>
          </div>
        </div>

        {/* Bottom actions */}
        <div className="mx-auto mt-6 flex max-w-5xl items-center justify-between">
          <Button variant="outline" className="rounded-[10px] border-border">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          <Button
            onClick={handleSendInvitations}
            disabled={!canSend}
            className="rounded-[10px] bg-primary px-8 py-6 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {sending ? "Sending…" : "Send Invitations"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Success info */}
        <div className="mx-auto mt-6 flex max-w-5xl items-center justify-between gap-8 overflow-hidden rounded-[14px] border border-border bg-card p-8">
          <div className="flex items-center gap-5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border bg-background">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold">
                Invitations are sent instantly.
              </p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Employees will receive an email with a link to create their
                account and join your workspace.
              </p>
            </div>
          </div>

          <NetworkIllustration className="hidden shrink-0 text-border md:block" />
        </div>
      </main>
    </div>
  );
}

function NetworkIllustration({ className }: { className?: string }) {
  return (
    <svg
      width="140"
      height="80"
      viewBox="0 0 140 80"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <line x1="10" y1="60" x2="55" y2="30" stroke="currentColor" strokeDasharray="3 4" />
      <line x1="55" y1="30" x2="95" y2="50" stroke="currentColor" strokeDasharray="3 4" />
      <line x1="95" y1="50" x2="130" y2="20" stroke="currentColor" strokeDasharray="3 4" />
      <line x1="95" y1="50" x2="115" y2="65" stroke="currentColor" />
      <circle cx="10" cy="60" r="4" stroke="currentColor" fill="none" />
      <circle cx="55" cy="30" r="5" stroke="currentColor" fill="none" />
      <circle cx="95" cy="50" r="6" stroke="currentColor" fill="none" />
      <circle cx="130" cy="20" r="4" stroke="currentColor" fill="none" />
      <circle cx="115" cy="65" r="3" stroke="currentColor" fill="none" />
    </svg>
  );
}

export default function InviteTeamPage() {
  return (
    <Suspense fallback={null}>
      <InviteTeamPageInner />
    </Suspense>
  );
}
