"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UploadCloud,
  FileSpreadsheet,
  MessageSquare,
  MessagesSquare,
  LogOut,
  BookOpen,
  ListChecks,
  Scale,
  BarChart3,
  Kanban,
  Link2,
  ClipboardList,
  Filter,
  History,
  Building2,
  PlugZap,
  Package,
  Settings,
} from "lucide-react";
import { SignOutButton } from "@clerk/nextjs";
import { extraPagesEnabled } from "@/lib/featureFlags";

const routes = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", color: "text-sky-500" },
  // Above the per-client screens on purpose: this is the one that answers
  // "which client needs me", and everything below it assumes that is settled.
  { label: "All Clients", icon: Building2, href: "/clients", color: "text-amber-300" },
  // Beside "All Clients" because it answers the other firm-wide question — not
  // "which client needs me" but "what has already been done to my clients'
  // books, and by whom". Both are the owner's screens; everything below is
  // scoped to whichever client is in the switcher.
  { label: "Activity", icon: History, href: "/activity", color: "text-slate-400" },
  { label: "Pipeline", icon: Kanban, href: "/pipeline", color: "text-indigo-400", localOnly: true },
  { label: "Upload", icon: UploadCloud, href: "/upload", color: "text-violet-500" },
  { label: "Review queue", icon: Filter, href: "/review", color: "text-rose-400", localOnly: true },
  { label: "Sheet Upload", icon: FileSpreadsheet, href: "/sheets", color: "text-teal-500" },
  { label: "Transactions", icon: ListChecks, href: "/transactions", color: "text-emerald-500" },
  // Stock sits with the other per-client work, not under Settings. The item
  // masters lived in a Settings tab while they were only a switch; once the
  // app could report a closing balance they became a place you go to look
  // something up, which is a different kind of screen.
  { label: "Inventory", icon: Package, href: "/inventory", color: "text-fuchsia-400" },
  { label: "GST Recon", icon: Scale, href: "/gst", color: "text-orange-400", localOnly: true },
  { label: "Reports", icon: BarChart3, href: "/reports", color: "text-cyan-400", localOnly: true },
  // exact: /settings/tally is its own entry and must not light this one up too.
  { label: "Ledgers & Rules", icon: BookOpen, href: "/settings", color: "text-amber-500", exact: true },
  { label: "Tally Connection", icon: PlugZap, href: "/settings/tally", color: "text-emerald-400" },
  { label: "Intake Links", icon: Link2, href: "/intake", color: "text-pink-400", localOnly: true },
  { label: "Tasks", icon: ClipboardList, href: "/tasks", color: "text-lime-400", localOnly: true },
  { label: "AI Assistant", icon: MessageSquare, href: "/chat", color: "text-pink-700" },
  // Mock data only — see LOCAL_ONLY_ROUTE_PREFIXES in featureFlags.ts.
  { label: "Communication", icon: MessagesSquare, href: "/communication", color: "text-teal-400", localOnly: true },
];

type SidebarProps = {
  onNavigate?: () => void;
};

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const showExtraPages = extraPagesEnabled();
  const visibleRoutes = routes.filter((route) => showExtraPages || !route.localOnly);

  const logNavClick = (href: string, label: string) => {
    if (process.env.NEXT_PUBLIC_TRACE_LOGS === "0") return;
    console.log("[trace][sidebar] nav:click", {
      from: pathname,
      to: href,
      label,
      at: new Date().toISOString(),
    });
  };

  const isSettingsActive = pathname === "/app-settings" || pathname.startsWith("/app-settings/");

  // The hover styling is applied by mutating inline styles, which a keyboard
  // never triggers — so focus mirrors it. Without this, tabbing through the
  // sidebar moves an invisible cursor: the only cue is the focus ring, and the
  // row under it stays unlit.
  const lit = (el: HTMLElement) => {
    el.style.background = "var(--spx-sidebar-hover-bg)";
    el.style.color = "var(--spx-sidebar-text)";
  };
  const unlit = (el: HTMLElement) => {
    el.style.background = "transparent";
    el.style.color = "var(--spx-sidebar-muted)";
  };

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--spx-sidebar-bg)", color: "var(--spx-sidebar-text)" }}>
      {/* ── Brand ── */}
      <div className="px-5 pt-5 pb-0">
        <Link href="/dashboard" className="block">
          <h1
            className="font-bold uppercase"
            style={{
              fontSize: "22px",
              letterSpacing: "3px",
              lineHeight: "1.1",
              fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif",
              color: "var(--spx-sidebar-text)",
            }}
          >
            RAO TECH
          </h1>
        </Link>
      </div>
      <div className="px-5 pt-1 pb-4" style={{ borderBottom: "1px solid var(--spx-sidebar-border)" }}>
        <p
          className="uppercase"
          style={{
            fontSize: "10px",
            letterSpacing: "2.4px",
            fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif",
            color: "var(--spx-sidebar-muted)",
          }}
        >
          Operational Center
        </p>
      </div>

      {/* ── Navigation ── */}
      <nav
        aria-label="Main"
        className="flex-1 min-h-0 px-2 pt-3 pb-2 space-y-[2px] overflow-y-auto overscroll-contain"
        style={{ minHeight: 0, overflowY: "auto" }}
      >
        {visibleRoutes.map((route) => {
          const isActive =
            pathname === route.href ||
            (!("exact" in route && route.exact) && pathname.startsWith(route.href + "/"));
          return (
            <Link
              key={route.href}
              href={route.href}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                logNavClick(route.href, route.label);
                onNavigate?.();
              }}
              className="group flex items-center gap-3 w-full cursor-pointer transition-all duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--spx-sidebar-active-border)]"
              style={{
                // 44px floor: these are the app's primary targets and were
                // landing around 38px, under the minimum for a touch device.
                minHeight: "44px",
                padding: "10px 16px",
                borderLeft: isActive ? `3px solid var(--spx-sidebar-active-border)` : "3px solid transparent",
                background: isActive ? "var(--spx-sidebar-active-bg)" : "transparent",
                color: isActive ? "var(--spx-sidebar-text)" : "var(--spx-sidebar-muted)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) lit(e.currentTarget);
              }}
              onMouseLeave={(e) => {
                if (!isActive) unlit(e.currentTarget);
              }}
              onFocus={(e) => {
                if (!isActive) lit(e.currentTarget);
              }}
              onBlur={(e) => {
                if (!isActive) unlit(e.currentTarget);
              }}
            >
              <route.icon
                className="flex-shrink-0"
                style={{ width: "18px", height: "18px", color: "inherit" }}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span
                className="uppercase"
                style={{
                  fontSize: "12px",
                  letterSpacing: "1.5px",
                  fontWeight: 500,
                  fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif",
                }}
              >
                {route.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── Bottom: App Settings + Logout ── */}
      <div style={{ borderTop: "1px solid var(--spx-sidebar-border)" }}>
        {/* "App Settings", not "Settings". Two different screens were called
            Settings: the /settings route, which is the per-client chart of
            accounts and mapping rules and appears above as "Ledgers & Rules",
            and this one, which is the signed-in user's own theme and account
            preferences. Someone told to "check the settings" had no way to know
            which was meant, and the two have nothing in common. */}
        <Link
          href="/app-settings"
          aria-current={isSettingsActive ? "page" : undefined}
          onClick={() => {
            logNavClick("/app-settings", "App Settings");
            onNavigate?.();
          }}
          className="flex items-center gap-3 cursor-pointer transition-all duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--spx-sidebar-active-border)]"
          style={{
            minHeight: "44px",
            padding: "12px 16px",
            borderLeft: isSettingsActive ? `3px solid var(--spx-sidebar-active-border)` : "3px solid transparent",
            background: isSettingsActive ? "var(--spx-sidebar-active-bg)" : "transparent",
            color: isSettingsActive ? "var(--spx-sidebar-text)" : "var(--spx-sidebar-muted)",
          }}
          onMouseEnter={(e) => {
            if (!isSettingsActive) lit(e.currentTarget);
          }}
          onMouseLeave={(e) => {
            if (!isSettingsActive) unlit(e.currentTarget);
          }}
          onFocus={(e) => {
            if (!isSettingsActive) lit(e.currentTarget);
          }}
          onBlur={(e) => {
            if (!isSettingsActive) unlit(e.currentTarget);
          }}
        >
          <Settings
            className="flex-shrink-0"
            style={{ width: "18px", height: "18px", color: "inherit" }}
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <span
            className="uppercase"
            style={{
              fontSize: "12px",
              letterSpacing: "1.5px",
              fontWeight: 500,
              fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif",
            }}
          >
            App Settings
          </span>
        </Link>

        {/* Logout. A <button>, not a <div>: Clerk's SignOutButton clones its
            child and hangs an onClick on it (calling the child's own handler
            first, so onNavigate still runs), which means a div gets no tab
            stop, no Enter key and no role — the one control that ends the
            session was unreachable without a mouse. */}
        <SignOutButton>
          <button
            type="button"
            className="flex items-center gap-3 w-full text-left cursor-pointer transition-all duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--spx-sidebar-active-border)]"
            style={{
              minHeight: "44px",
              padding: "12px 16px",
              borderLeft: "3px solid transparent",
              color: "var(--spx-sidebar-muted)",
            }}
            onMouseEnter={(e) => lit(e.currentTarget)}
            onMouseLeave={(e) => unlit(e.currentTarget)}
            onFocus={(e) => lit(e.currentTarget)}
            onBlur={(e) => unlit(e.currentTarget)}
            onClick={onNavigate}
          >
            <LogOut
              className="flex-shrink-0"
              style={{ width: "18px", height: "18px", color: "inherit" }}
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span
              className="uppercase"
              style={{
                fontSize: "12px",
                letterSpacing: "1.5px",
                fontWeight: 500,
                fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif",
              }}
            >
              Logout
            </span>
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
