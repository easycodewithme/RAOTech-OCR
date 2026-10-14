"use client";

import { useEffect, useState } from "react";
import { Menu, X, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/Sidebar";
import { ClientSwitcher } from "@/components/ClientSwitcher";
import { CommandPalette } from "@/components/CommandPalette";
import { ConnectorStatusBanner } from "@/components/ConnectorStatusBanner";
import { relativeTime, useConnectorStatus } from "@/components/tallyClient";

declare global {
  interface Window {
    __raotechRouteChangeStart?: number;
  }
}

type ClientItem = {
  id: string;
  name: string;
  gstin: string | null;
  isDefault: boolean;
};

type DashboardShellProps = {
  children: React.ReactNode;
  initialClients?: ClientItem[];
  initialActiveId?: string | null;
};

export function DashboardShell({ children, initialClients, initialActiveId }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_TRACE_LOGS !== "0") {
      const now = performance.now();
      const started = window.__raotechRouteChangeStart;
      console.log("[trace][dashboard-shell] pathname:changed", {
        pathname,
        durationFromStartMs: started ? Number((now - started).toFixed(2)) : null,
      });
      window.__raotechRouteChangeStart = now;
    }
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileMenuOpen]);

  return (
    <div className="h-full relative" style={{ background: "var(--spx-canvas)" }}>
      {/* Desktop Sidebar */}
      <div
        className="hidden h-full md:flex md:flex-col md:fixed md:inset-y-0 z-[80]"
        style={{ width: "232px", borderRight: "1px solid var(--spx-border)", boxShadow: "var(--spx-sidebar-shadow)" }}
      >
        <Sidebar />
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[90] md:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            className="absolute inset-0 overscroll-none"
            style={{ background: "var(--spx-overlay)", backdropFilter: "blur(4px)" }}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className="absolute left-0 top-0 h-full shadow-2xl flex flex-col"
            style={{ width: "232px", maxWidth: "85vw", background: "var(--spx-canvas)", borderRight: "1px solid var(--spx-border)" }}
          >
            <div
              className="shrink-0"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderBottom: "1px solid var(--spx-border)",
                padding: "12px 16px",
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 500,
                  textTransform: "uppercase" as const,
                  letterSpacing: "2px",
                  color: "var(--spx-muted)",
                }}
              >
                Menu
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                style={{ color: "var(--spx-text)" }}
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 min-h-0">
              <Sidebar onNavigate={() => setMobileMenuOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="min-h-screen md:pl-[232px]" style={{ background: "var(--spx-canvas)" }}>
        {/* Top Bar */}
        <div
          className="sticky top-0 z-40 backdrop-blur-sm"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            borderBottom: "1px solid var(--spx-border)",
            background: "var(--spx-topbar-bg)",
            boxShadow: "var(--spx-topbar-shadow)",
            padding: "10px 24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="md:hidden"
              style={{ color: "var(--spx-text)" }}
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* Search Bar */}
            <div
              className="hidden md:flex"
              style={{
                alignItems: "center",
                gap: "8px",
                background: "var(--spx-input-bg)",
                border: "1px solid var(--spx-border)",
                padding: "7px 14px",
                minWidth: "300px",
              }}
            >
              <Search style={{ width: "15px", height: "15px", color: "var(--spx-muted)" }} strokeWidth={1.5} />
              <span style={{ fontSize: "13px", color: "var(--spx-muted)", letterSpacing: "0.3px" }}>
                Search invoices, clients, tasks...
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <TallyStatusIndicator />

            <ClientSwitcher initialClients={initialClients} initialActiveId={initialActiveId} />
          </div>
        </div>
        {/* A queued push does not move while the desktop agent is down, and no
            screen can make it move — so the warning lives above all of them. */}
        <ConnectorStatusBanner />

        {children}
      </main>

      <CommandPalette />
    </div>
  );
}

/**
 * The dot in the top bar, driven by the connector rather than by hope.
 *
 * It used to be a hardcoded green dot reading "Tally: Live Sync", rendered six
 * pixels above the banner that says "Connector offline". Whichever of the two a
 * user believed, one of them was lying to them about whether their client's
 * books were being written to.
 *
 * Three things can be true and they are not the same: the device may not exist
 * (never paired — that is not "offline", so we say nothing at all, matching
 * ConnectorStatusBanner's rule), the device may be up but unable to reach
 * TallyPrime on its own machine, or the device may simply be gone. Only the
 * first of those is a live sync.
 *
 * This polls /api/tally/company a second time — the banner has its own
 * subscription. Hoisting it into a provider around the whole dashboard to save
 * one request would be a lot of machinery for a 6px dot, so the trade taken
 * here is a slower interval instead: the banner is the thing that has to be
 * timely, this only has to stop being wrong.
 */
function TallyStatusIndicator() {
  const { data } = useConnectorStatus({ intervalMs: 60_000 });

  // Nothing to report before the first response, and nothing to report for a
  // workspace that exports XML by hand and has never paired a device.
  if (!data?.device) return null;

  const device = data.device;
  const online = data.connectorOnline;
  // `tallyReachable` is the connector's own last verdict on the Tally instance
  // beside it. null means it has never said — which is not the same as "yes".
  const reachable = device.tallyReachable;

  const { tone, label } = online
    ? reachable === true
      ? { tone: "#22c55e", label: "Tally: Live sync" }
      : reachable === false
        ? { tone: "#f59e0b", label: "Tally: Unreachable" }
        : { tone: "#f59e0b", label: "Tally: Unconfirmed" }
    : { tone: "#ef4444", label: "Tally: Offline" };

  const detail = [
    `${device.deviceName} last seen ${relativeTime(device.lastSeenAt)}`,
    device.tallyMessage,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href="/settings/tally"
      title={detail}
      aria-label={`${label}. ${detail}`}
      className="hidden cursor-pointer md:inline-flex focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-text)]"
      style={{
        alignItems: "center",
        gap: "8px",
        // Pointer-only affordance (md and up), sized to sit level with the
        // client switcher beside it rather than to a touch target.
        minHeight: "32px",
        padding: "0 4px",
        fontSize: "11px",
        letterSpacing: "1.2px",
        textTransform: "uppercase" as const,
        color: "var(--spx-muted)",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: tone,
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span>{label}</span>
    </Link>
  );
}