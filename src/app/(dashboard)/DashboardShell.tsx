"use client";

import { useEffect, useState } from "react";
import { Menu, X, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/Sidebar";
import { ClientSwitcher } from "@/components/ClientSwitcher";
import { CommandPalette } from "@/components/CommandPalette";
import { ConnectorStatusBanner } from "@/components/ConnectorStatusBanner";

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
            {/* Tally Sync Status */}
            <div
              className="hidden md:flex"
              style={{
                alignItems: "center",
                gap: "8px",
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
                  background: "#22c55e",
                  display: "inline-block",
                }}
              />
              <span>Tally: Live Sync</span>
            </div>

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