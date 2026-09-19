"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SignedIn, SignedOut, SignInButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InteractiveHoverButton } from "@/registry/magicui/interactive-hover-button";
import { AnimatedButton } from "@/components/ui/animated-button";
import {
  ScrollVelocityContainer,
  ScrollVelocityRow,
} from "@/registry/magicui/scroll-based-velocity";

import {
  ArrowRight,
  FileStack,
  MessageSquareText,
  FileSpreadsheet,
  Users,
  Clock,
  CheckCircle2,
  Zap,
  ShieldCheck,
  ChevronDown,
  Menu,
  X,
  Mail,
  Check,
  Upload,
  BookOpen,
  RefreshCw,
  FileText,
  Layers,
  Sparkles,
  ExternalLink,
  Factory,
  Pill,
  Truck,
  ShoppingBag,
  Database,
  Lock,
  Volume2,
  VolumeX,
  Search,
  Download,
  Laptop,
  Plus,
  ChevronRight,
  Bot,
  Send,
} from "lucide-react";

/* ── Smooth Scroll Reveal Hook ── */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, visible };
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
      className={`transition-all duration-700 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}



/* ── Showcase UI Mockups Recreated from Real Product Screenshots ── */

/* 1. Recreating Upload & Extract Invoices (from Screenshot 2026-09-19 024435.png) */
/* ── Showcase UI Mockups Recreated from Real Product Screenshots ── */

/* 1. Recreating Upload & Extract Invoices (from Screenshot 2026-09-19 024435.png) */
function IntakeMockup() {
  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-border/90 bg-white p-3.5 sm:p-5 shadow-sm text-xs relative overflow-hidden">
      {/* Top Application Bar with Search & Status */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2.5 mb-2.5 sm:pb-3 sm:mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-secondary/50 border border-border/80 rounded-md px-2 py-1 text-muted-foreground flex-1 min-w-0 max-w-[150px] sm:max-w-64">
          <Search className="h-3 w-3 shrink-0" />
          <span className="text-[10px] sm:text-[11px] truncate">Search invoices, clients...</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-[#16a34a] animate-pulse" />
            <span className="tracking-wide hidden sm:inline">TALLY: </span><span>LIVE SYNC</span>
          </div>
          <span className="rounded border border-border bg-white px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium text-foreground">
            test ▾
          </span>
        </div>
      </div>

      {/* Page Header Strip */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="font-extrabold tracking-tight text-foreground text-xs uppercase">
            Upload &amp; Extract Invoices
          </div>
          <div className="font-mono text-[9px] text-muted-foreground tracking-wider uppercase mt-0.5">
            AI Ingestion &amp; OCR Extraction Pipeline
          </div>
        </div>
        <div className="flex items-center gap-1 bg-secondary/60 p-0.5 rounded-md border border-border/60">
          <span className="rounded bg-[#111827] text-white px-2.5 py-1 text-[10px] font-bold shadow-xs">
            INVOICE
          </span>
          <span className="text-muted-foreground px-2 py-1 text-[10px] font-medium">
            BANK STATEMENT
          </span>
        </div>
      </div>

      {/* Drag & Drop Dotted Zone */}
      <div className="flex-1 flex flex-col justify-center rounded-xl border border-dashed border-border/90 bg-secondary/20 p-4 sm:p-5 text-center my-2">
        <div className="flex justify-center mb-1.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-border text-foreground shadow-2xs">
            <Upload className="h-4 w-4" />
          </div>
        </div>
        <div className="font-semibold text-foreground text-xs">
          Drag &amp; drop up to 15 invoice files here
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          Supports PDF, JPG, PNG, BMP, TIFF, WEBP (max 20MB each)
        </div>
      </div>

      {/* Active Extracted File Queue Items */}
      <div className="space-y-2 mt-auto">
        <div className="rounded-lg border border-border/80 bg-white p-2.5 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-blue-50 text-blue-600 font-bold text-[10px] shrink-0">
              PDF
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-foreground text-[11px] truncate">
                TATA_COMMERCIAL_BATCH_09.pdf
              </div>
              <div className="text-[9px] text-muted-foreground">4 pages auto-split · 28 line items parsed</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
              ✓ 100% Extracted
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border/80 bg-white p-2.5 flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-emerald-50 text-emerald-600 font-bold text-[10px] shrink-0">
              XLS
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-foreground text-[11px] truncate">
                SUPPLIER_PURCHASE_SHEET_AUG.xlsx
              </div>
              <div className="text-[9px] text-muted-foreground">240 rows · GSTR-2B columns auto-mapped</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-semibold text-blue-700">
              Columns Synced
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 2. Recreating Transactions Table (from Screenshot 2026-09-19 024443.png) */
function TransactionsMockup() {
  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-border/90 bg-white p-3.5 sm:p-5 shadow-sm text-xs relative overflow-hidden">
      {/* Top Search & Status Strip */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2.5 mb-2.5 sm:pb-3 sm:mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-secondary/50 border border-border/80 rounded-md px-2 py-1 text-muted-foreground flex-1 min-w-0 max-w-[150px] sm:max-w-64">
          <Search className="h-3 w-3 shrink-0" />
          <span className="text-[10px] sm:text-[11px] truncate">Search invoices, clients...</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-[#16a34a] animate-pulse" />
            <span className="tracking-wide hidden sm:inline">TALLY: </span><span>LIVE SYNC</span>
          </div>
          <span className="rounded border border-border bg-white px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium text-foreground">
            test ▾
          </span>
        </div>
      </div>

      {/* Header & Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
        <div>
          <div className="font-bold text-foreground text-sm">Transactions</div>
          <div className="text-[10px] text-muted-foreground">
            Map ledgers, approve, and export Tally XML
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="rounded border border-border bg-white px-2 py-1 text-[10px] font-medium text-foreground">
            Select ready
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded bg-[#16a34a] text-white px-2.5 py-1 text-[10px] font-semibold shadow-xs"
          >
            <Download className="h-3 w-3" />
            <span>Export XML</span>
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded bg-[#16a34a] text-white px-2.5 py-1 text-[10px] font-semibold shadow-xs"
          >
            <ArrowRight className="h-3 w-3" />
            <span>Push to Tally (2)</span>
          </button>
        </div>
      </div>

      {/* Filter Pills Rail */}
      <div className="flex items-center gap-1.5 mb-2.5 overflow-x-auto no-scrollbar pb-1 text-[10px]">
        <span className="rounded bg-[#111827] text-white px-2.5 py-0.5 font-semibold shrink-0">
          Invoices (3)
        </span>
        <span className="rounded border border-border bg-white text-muted-foreground px-2 py-0.5 shrink-0">
          Bank Statements (0)
        </span>
        <span className="rounded bg-[#111827] text-white px-2 py-0.5 font-medium shrink-0">
          All
        </span>
        <span className="rounded border border-border bg-white text-muted-foreground px-2 py-0.5 shrink-0">
          Ready
        </span>
        <span className="rounded border border-border bg-white text-muted-foreground px-2 py-0.5 shrink-0">
          Needs attention
        </span>
      </div>

      {/* Real Table from Screenshot with 4 Rows for uniform height - with mobile horizontal scrolling */}
      <div className="rounded-lg border border-border overflow-hidden text-[11px] flex-1 flex flex-col justify-between">
        <div className="overflow-x-auto no-scrollbar">
          <div className="min-w-[460px]">
            <div className="grid grid-cols-12 bg-secondary/60 p-2 font-bold text-muted-foreground border-b border-border text-[9px] uppercase tracking-wider">
              <div className="col-span-4">VENDOR</div>
              <div className="col-span-2">INVOICE #</div>
              <div className="col-span-2">TYPE</div>
              <div className="col-span-2 text-right">AMOUNT</div>
              <div className="col-span-2 text-right">STATUS</div>
            </div>
            <div className="divide-y divide-border/60 bg-white">
              <div className="grid grid-cols-12 p-2 items-center text-foreground font-medium">
                <div className="col-span-4 flex items-center gap-1.5 truncate">
                  <input type="checkbox" defaultChecked className="rounded border-border" />
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate text-[10px] font-semibold">Tata Motors Commercial</span>
                </div>
                <div className="col-span-2 text-[10px] font-mono text-muted-foreground">INV-8832</div>
                <div className="col-span-2 text-[10px] text-muted-foreground">SALE</div>
                <div className="col-span-2 text-right font-bold font-mono text-[10px]">₹1,29,800</div>
                <div className="col-span-2 text-right">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                    Approved
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-12 p-2 items-center text-foreground font-medium bg-secondary/10">
                <div className="col-span-4 flex items-center gap-1.5 truncate">
                  <input type="checkbox" defaultChecked className="rounded border-border" />
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate text-[10px] font-semibold">JSW Steel Industrial</span>
                </div>
                <div className="col-span-2 text-[10px] font-mono text-muted-foreground">INV-4419</div>
                <div className="col-span-2 text-[10px] text-muted-foreground">SALE</div>
                <div className="col-span-2 text-right font-bold font-mono text-[10px]">₹3,54,000</div>
                <div className="col-span-2 text-right">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                    Approved
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-12 p-2 items-center text-foreground font-medium">
                <div className="col-span-4 flex items-center gap-1.5 truncate">
                  <input type="checkbox" defaultChecked className="rounded border-border" />
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate text-[10px] font-semibold">Mahindra Logistics Ltd</span>
                </div>
                <div className="col-span-2 text-[10px] font-mono text-muted-foreground">LR-9021</div>
                <div className="col-span-2 text-[10px] text-muted-foreground">SALE</div>
                <div className="col-span-2 text-right font-bold font-mono text-[10px]">₹42,500</div>
                <div className="col-span-2 text-right">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                    Approved
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-12 p-2 items-center text-foreground font-medium bg-secondary/10">
                <div className="col-span-4 flex items-center gap-1.5 truncate">
                  <input type="checkbox" className="rounded border-border" />
                  <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate text-[10px] font-semibold">Unknown</span>
                </div>
                <div className="col-span-2 text-[10px] font-mono text-muted-foreground">—</div>
                <div className="col-span-2 text-[10px] text-muted-foreground">SALE</div>
                <div className="col-span-2 text-right font-bold font-mono text-[10px]">₹0</div>
                <div className="col-span-2 text-right">
                  <span className="rounded bg-secondary text-muted-foreground px-2 py-0.5 text-[9px] font-medium">
                    Map →
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Parity Footer */}
        <div className="p-2 border-t border-border/70 bg-secondary/20 flex flex-col sm:flex-row items-start sm:items-center justify-between text-[10px] gap-1">
          <span className="flex items-center gap-1 text-emerald-700 font-medium">
            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
            <span>Arithmetic Parity: CGST + SGST Verified</span>
          </span>
          <span className="font-mono font-bold text-foreground">Total: ₹5,26,300.00</span>
        </div>
      </div>
    </div>
  );
}

/* 3. Recreating Ledgers & Rules (from Screenshot 2026-09-19 024452.png) */
function RulesMockup() {
  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-border/90 bg-white p-3.5 sm:p-5 shadow-sm text-xs relative overflow-hidden">
      {/* Top Search & Status Strip */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2.5 mb-2.5 sm:pb-3 sm:mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-secondary/50 border border-border/80 rounded-md px-2 py-1 text-muted-foreground flex-1 min-w-0 max-w-[150px] sm:max-w-64">
          <Search className="h-3 w-3 shrink-0" />
          <span className="text-[10px] sm:text-[11px] truncate">Search invoices, clients...</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-[#16a34a] animate-pulse" />
            <span className="tracking-wide hidden sm:inline">TALLY: </span><span>LIVE SYNC</span>
          </div>
          <span className="rounded border border-border bg-white px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium text-foreground">
            test ▾
          </span>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <div className="min-w-0">
          <div className="font-bold text-foreground text-sm truncate">Ledgers &amp; Rules</div>
          <div className="text-[10px] text-muted-foreground truncate">
            test · Chart of accounts &amp; auto-mapping
          </div>
        </div>
        <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-50/60 px-2 py-1 text-[10px] font-semibold text-emerald-700 shrink-0">
          <Zap className="h-3 w-3" />
          <span>Tally Sync</span>
        </span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-2.5 text-[10px] overflow-x-auto no-scrollbar pb-1">
        <span className="rounded border border-border bg-white px-2.5 py-1 font-bold text-foreground shadow-2xs shrink-0">
          Chart of Accounts (32)
        </span>
        <span className="px-2 py-1 text-muted-foreground font-medium shrink-0">Mapping Rules (0)</span>
        <span className="px-2 py-1 text-muted-foreground font-medium shrink-0">Stock Items</span>
      </div>

      {/* Add Ledger Row */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 rounded-lg border border-border bg-secondary/20 p-2 mb-2.5 text-[10px]">
        <div className="flex-1 min-w-[120px] bg-white border border-border/80 rounded px-2.5 py-1 text-muted-foreground truncate">
          e.g. Courier Charges
        </div>
        <div className="bg-white border border-border/80 rounded px-2 py-1 font-semibold text-foreground shrink-0 text-[10px]">
          INDIRECT EXPENSES ▾
        </div>
        <button
          type="button"
          className="flex items-center gap-1 rounded bg-[#111827] text-white px-2.5 py-1 font-semibold shrink-0"
        >
          <Plus className="h-3 w-3" />
          <span>Add</span>
        </button>
      </div>

      {/* 2-Column Ledger Boxes (1 column on mobile, 2 on sm+) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] flex-1">
        <div className="space-y-2">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-secondary/60 px-2.5 py-1 font-bold text-[9px] text-muted-foreground uppercase border-b border-border">
              SUNDRY CREDITORS
            </div>
            <div className="p-2 bg-white font-medium text-foreground">Sundry Creditors</div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-secondary/60 px-2.5 py-1 font-bold text-[9px] text-muted-foreground uppercase border-b border-border">
              DUTIES AND TAXES
            </div>
            <div className="divide-y divide-border/60 bg-white">
              <div className="p-1.5 flex justify-between items-center text-foreground font-medium">
                <span>CGST Input</span>
                <span className="rounded bg-secondary px-1.5 py-0.2 text-[8px] text-muted-foreground">system</span>
              </div>
              <div className="p-1.5 flex justify-between items-center text-foreground font-medium">
                <span>CGST Output</span>
                <span className="rounded bg-secondary px-1.5 py-0.2 text-[8px] text-muted-foreground">system</span>
              </div>
              <div className="p-1.5 flex justify-between items-center text-foreground font-medium">
                <span>IGST Input</span>
                <span className="rounded bg-secondary px-1.5 py-0.2 text-[8px] text-muted-foreground">system</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-secondary/60 px-2.5 py-1 font-bold text-[9px] text-muted-foreground uppercase border-b border-border">
              SUNDRY DEBTORS
            </div>
            <div className="p-2 bg-white font-medium text-foreground">Sundry Debtors</div>
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-secondary/60 px-2.5 py-1 font-bold text-[9px] text-muted-foreground uppercase border-b border-border">
              PURCHASE ACCOUNTS
            </div>
            <div className="divide-y divide-border/60 bg-white">
              <div className="p-1.5 text-foreground font-medium">Purchase - GST 12%</div>
              <div className="p-1.5 text-foreground font-medium">Purchase - GST 18%</div>
              <div className="p-1.5 text-foreground font-medium">Purchase - GST 28%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* 4. Recreating Tally Connection (from Screenshot 2026-09-19 024501.png) */
function TallyMockup() {
  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-border/90 bg-white p-3.5 sm:p-5 shadow-sm text-xs relative overflow-hidden">
      {/* Top Search & Status Strip */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2.5 mb-2.5 sm:pb-3 sm:mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-secondary/50 border border-border/80 rounded-md px-2 py-1 text-muted-foreground flex-1 min-w-0 max-w-[150px] sm:max-w-64">
          <Search className="h-3 w-3 shrink-0" />
          <span className="text-[10px] sm:text-[11px] truncate">Search invoices, clients...</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-[#16a34a] animate-pulse" />
            <span className="tracking-wide hidden sm:inline">TALLY: </span><span>LIVE SYNC</span>
          </div>
          <span className="rounded border border-border bg-white px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium text-foreground">
            test ▾
          </span>
        </div>
      </div>

      {/* Breadcrumb & Title */}
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <div className="min-w-0">
          <div className="text-[10px] text-muted-foreground font-medium truncate">← Ledgers &amp; Rules</div>
          <div className="font-bold text-foreground text-sm mt-0.5 truncate">Tally Connection</div>
          <div className="text-[10px] text-muted-foreground truncate">
            test · Desktop connector &amp; gateway
          </div>
        </div>
        <span className="flex items-center gap-1 rounded border border-border bg-white px-2 py-1 text-[10px] font-medium text-foreground shadow-2xs shrink-0">
          <RefreshCw className="h-3 w-3" />
          <span>Refresh</span>
        </span>
      </div>

      {/* Connector Device & Tally Company */}
      <div className="space-y-2.5 flex-1 flex flex-col justify-center">
        {/* Card 1: Connector Device */}
        <div className="rounded-xl border border-border bg-white p-3 shadow-2xs">
          <div className="flex items-center gap-1.5 font-bold text-foreground text-xs mb-2">
            <Laptop className="h-3.5 w-3.5" />
            <span>Connector device</span>
          </div>

          {/* Green banner box */}
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-50/50 p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-emerald-600 text-white shrink-0">
                <Download className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-emerald-950 text-[11px] truncate">
                  Rao-Tech Desktop Connector (.exe)
                </div>
                <div className="text-[9px] text-emerald-800 line-clamp-1 sm:line-clamp-none">
                  Install once on Windows PC running TallyPrime to bridge vouchers.
                </div>
              </div>
            </div>
            <span className="self-start sm:self-auto rounded border border-emerald-600/30 bg-white px-2 py-1 text-[9px] font-semibold text-emerald-800 shrink-0 shadow-2xs">
              Download .exe
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1">
            <div className="text-[10px] text-muted-foreground">
              Desktop Port 9000: <span className="text-emerald-700 font-bold">CONNECTED</span>
            </div>
            <span className="self-start sm:self-auto rounded bg-[#111827] text-white px-2.5 py-0.5 text-[9px] sm:text-[10px] font-semibold">
              Device Paired ✓
            </span>
          </div>
        </div>

        {/* Card 2: Tally Company */}
        <div className="rounded-xl border border-border bg-white p-3 shadow-2xs">
          <div className="font-bold text-foreground text-xs mb-1.5">Tally company</div>
          <div className="text-[10px] text-muted-foreground mb-1">
            Company name, exactly as it appears in Tally
          </div>
          <div className="flex items-center border border-border rounded-md overflow-hidden mb-2">
            <div className="flex-1 px-2.5 py-1 font-mono font-bold text-foreground text-xs bg-slate-50/50 truncate">
              RAOTECH TRADERS
            </div>
            <span className="bg-slate-600 text-white px-3 py-1 text-[10px] font-semibold shrink-0">
              Save
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex items-center gap-1 rounded bg-[#16a34a] text-white px-3 py-1 text-[10px] font-semibold shadow-xs"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Sync Master</span>
            </button>
            <span className="rounded border border-border bg-white px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              Test Connection
            </span>
          </div>
        </div>
      </div>

      {/* Tally Live Gateway Footer */}
      <div className="p-2 border-t border-border/70 bg-secondary/20 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between text-[10px] mt-2 gap-1">
        <span className="flex items-center gap-1 text-emerald-700 font-medium">
          <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
          <span>Gateway Status: Active (Port 9000)</span>
        </span>
        <span className="font-mono text-muted-foreground">Vouchers Ready: 2</span>
      </div>
    </div>
  );
}

/* 5. Recreating AI Assistant (from Screenshot ai assistant.png) */
function AssistantMockup() {
  return (
    <div className="h-full flex flex-col justify-between rounded-2xl border border-border/90 bg-white p-3.5 sm:p-5 shadow-sm text-xs relative overflow-hidden">
      {/* Top Application Bar with Search & Status */}
      <div className="flex items-center justify-between border-b border-border/80 pb-2.5 mb-2.5 sm:pb-3 sm:mb-3 gap-2">
        <div className="flex items-center gap-1.5 bg-secondary/50 border border-border/80 rounded-md px-2 py-1 text-muted-foreground flex-1 min-w-0 max-w-[150px] sm:max-w-64">
          <Search className="h-3 w-3 shrink-0" />
          <span className="text-[10px] sm:text-[11px] truncate">Search invoices, clients...</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-semibold text-foreground">
            <span className="h-2 w-2 rounded-full bg-[#16a34a] animate-pulse" />
            <span className="tracking-wide hidden sm:inline">TALLY: </span><span>LIVE SYNC</span>
          </div>
          <span className="rounded border border-border bg-white px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-medium text-foreground">
            test ▾
          </span>
        </div>
      </div>

      {/* Subheader */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-secondary text-foreground">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold text-foreground text-sm">AI Assistant</span>
        </div>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>ONLINE</span>
        </span>
      </div>

      {/* Chat Thread */}
      <div className="space-y-2 mb-2 flex-1">
        {/* Message 1: Initial Bot Greeting from Screenshot */}
        <div className="rounded-xl border border-border/80 bg-secondary/20 p-2 sm:p-2.5">
          <div className="flex items-center justify-between border-b border-border/60 pb-1 mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-foreground font-mono uppercase">
              <Bot className="h-3 w-3 text-muted-foreground" />
              <span>AI ASSISTANT</span>
            </div>
            <span className="font-mono text-[9px] text-muted-foreground">[02:45:07]</span>
          </div>
          <p className="text-foreground text-[10.5px] sm:text-[11px] leading-relaxed">
            Hello! I am RAO AI. Ask about this client&apos;s ITC, drafts, vendors, or reconciliation.
          </p>
        </div>

        {/* Message 2: Live Query Example */}
        <div className="rounded-xl border border-border/80 bg-white p-2 flex items-start gap-2 shadow-2xs">
          <span className="rounded bg-[#111827] text-white text-[9px] font-bold px-1.5 py-0.5 mt-0.5 shrink-0">
            YOU
          </span>
          <div className="text-[10.5px] sm:text-[11px] text-foreground font-medium">
            Which vendors have pending GSTR-2B mismatches for Tata Motors?
          </div>
        </div>

        {/* Message 3: Rich AI Response */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/40 p-2 sm:p-2.5">
          <div className="flex items-center justify-between border-b border-emerald-600/20 pb-1 mb-1.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-900 font-mono uppercase">
              <Bot className="h-3 w-3 text-emerald-700" />
              <span>AUDIT INSIGHT</span>
            </div>
            <span className="rounded bg-emerald-100 text-emerald-800 text-[9px] font-semibold px-1.5 py-0.2">
              1 Match Found
            </span>
          </div>
          <p className="text-emerald-950 text-[10.5px] sm:text-[11px] leading-relaxed mb-1.5">
            Invoice <span className="font-mono font-bold">INV-8832</span> (₹1,29,800) is extracted and verified. Tax ₹19,800 is eligible for ITC claim upon next portal filing sync.
          </p>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-[#111827] text-white text-[9px] font-semibold px-2 py-0.5">
              Push to Tally
            </span>
            <span className="rounded border border-border bg-white text-muted-foreground text-[9px] font-medium px-2 py-0.5">
              Export Audit CSV
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Chat Input Bar from Screenshot */}
      <div className="rounded-xl border border-border bg-white p-2 shadow-2xs mt-auto">
        <div className="flex items-center justify-between text-muted-foreground px-2 py-0.5 gap-2">
          <span className="text-[10.5px] sm:text-[11px] truncate">&gt; Ask about invoices, Tally, GST...</span>
          <Send className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-pointer shrink-0" />
        </div>
        <div className="border-t border-border/60 pt-1 mt-1 flex flex-wrap items-center justify-between gap-1 text-[8.5px] sm:text-[9px] text-muted-foreground font-mono">
          <span>PRESS <span className="rounded bg-secondary px-1 py-0.2 border border-border">CMD + K</span> FOR ACTIONS</span>
          <span className="flex items-center gap-1 text-emerald-700 font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            ONLINE
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 5 Core Showcase Stages ── */
const SHOWCASE_STAGES = [
  {
    id: "upload",
    tabLabel: "Document & Sheet Intake",
    eyebrow: "INVOICE & SHEET PIPELINE",
    title: "Upload PDFs, scanned bills, or excel sheets in any layout",
    description:
      "Drop multi-vendor PDF invoices, scanned paper bills, or Excel supplier sheets. RAO AI automatically rotates skewed scans, splits multi-page manifests into single invoices, and maps custom spreadsheet columns in seconds.",
    ctaText: "Explore Ingestion Pipeline",
    ctaLink: "/dashboard",
    checklist: [
      "Multi-page PDF auto-splitting",
      "Excel column auto-mapping",
      "Perspective skew & contrast repair",
      "Drag & drop 15+ files at once",
      "Bank statement parsing",
      "Automatic OCR enhancement",
    ],
    Mockup: IntakeMockup,
  },
  {
    id: "transactions",
    tabLabel: "Transactions",
    eyebrow: "TRANSACTIONS & OCR",
    title: "Sub-second line-item extraction with instant approval",
    description:
      "Review extracted vendor names, GSTINs, invoice numbers, line items, and tax amounts. Flag discrepancies, approve verified entries in bulk, and push directly to Tally or export XML in a single click.",
    ctaText: "View Transactions",
    ctaLink: "/dashboard",
    checklist: [
      "Live vendor GSTIN portal check",
      "8-digit HSN code recognition",
      "Row-level arithmetic parity check",
      "One-click XML export",
      "Direct push to Tally Prime",
      "Bulk approval workflows",
    ],
    Mockup: TransactionsMockup,
  },
  {
    id: "rules",
    tabLabel: "Ledgers & Rules",
    eyebrow: "LEDGERS & RULES",
    title: "Automated Chart of Accounts and auto-mapping rules",
    description:
      "Configure intelligent accounting rules that automatically link vendors to Sundry Creditors, route line items to proper Purchase and Expense ledgers, and maintain strict double-entry balance locks.",
    ctaText: "Configure Ledgers & Rules",
    ctaLink: "/dashboard",
    checklist: [
      "Chart of Accounts mapping",
      "Sundry Creditor allocation",
      "Automated expense routing",
      "Duties & Taxes group rules",
      "Stock item categorization",
      "Custom auto-posting triggers",
    ],
    Mockup: RulesMockup,
  },
  {
    id: "tally",
    tabLabel: "Tally Connection",
    eyebrow: "TALLY CONNECTION",
    title: "Zero-friction desktop bridge for Tally Prime",
    description:
      "Download our lightweight Windows desktop connector to link your local TallyPrime instance. Push certified vouchers directly over ODBC and synchronize your master ledgers without manual re-entry.",
    ctaText: "Connect Your ERP",
    ctaLink: "/pricing",
    checklist: [
      "Lightweight .exe connector",
      "Port 9000 ODBC bridge",
      "Master ledger 2-way sync",
      "Certified XML voucher push",
      "Real-time gateway status",
      "Zero manual data re-entry",
    ],
    Mockup: TallyMockup,
  },
  {
    id: "assistant",
    tabLabel: "AI Assistant",
    eyebrow: "CONTEXTUAL INTELLIGENCE",
    title: "Instant conversational answers across your ledgers and GST data",
    description:
      "Ask questions in plain English about vendor balances, pending GSTR-2B ITC, discrepancy flags, or Tally voucher statuses. RAO AI queries your live transactional graph to provide audit-ready answers in seconds.",
    ctaText: "Chat with AI Assistant",
    ctaLink: "/dashboard",
    checklist: [
      "Natural language ITC & GST queries",
      "Vendor balance & draft ledger search",
      "Automated reconciliation audits",
      "One-click discrepancy remediation",
      "CMD + K quick action palette",
      "Real-time live Tally status feed",
    ],
    Mockup: AssistantMockup,
  },
];



/* ── FAQ Data ── */
const FAQS = [
  {
    q: "How does RAO AI handle crumpled, stamped, or low-contrast paper bills?",
    a: "Our dual-engine architecture combines high-resolution preprocessing with deep vision intelligence. It automatically enhances contrast, removes background bleed-through, and deciphers text even when warehouse stamps or signatures partially overlap line items.",
  },
  {
    q: "How does the direct integration with Tally Prime and SAP work?",
    a: "Once vouchers are reviewed and approved, RAO AI exports certified XML files formatted strictly to Tally’s Purchase Voucher schemas. You can import the XML into Tally in a single click, or use our desktop connector for automated real-time synchronization.",
  },
  {
    q: "How does GSTR-2B reconciliation protect our Input Tax Credit (ITC)?",
    a: "The system matches your purchase register against the official GSTR-2B data filed on the GST portal. Any missing vendor invoice, GSTIN mismatch, or tax amount disparity is flagged before payment, ensuring you never lose eligible ITC.",
  },
  {
    q: "Can this system run offline or in a private cloud for confidential records?",
    a: "Yes. In addition to our secure cloud deployment, RAO AI can be hosted inside your private VPC or on-premise infrastructure with local Docker containers, ensuring complete data sovereignty.",
  },
  {
    q: "How long does setup and Chart of Accounts mapping take?",
    a: "Most accounting teams are operational within a few hours. Simply upload your existing Tally or ERP ledger master file, configure default tax rules, and the system learns your vendor-to-ledger mappings automatically.",
  },
];

/* ── Premier Indian CA & Audit Firms (Social Proof) ── */
const CA_FIRMS = [
  {
    logo: "/logos/deloitte.svg",
    alt: "Deloitte",
    practice: "Deloitte Haskins & Sells",
    sub: "Chartered Accountants",
    heightClass: "h-4 sm:h-5",
  },
  {
    logo: "/logos/pwc.svg",
    alt: "PricewaterhouseCoopers",
    practice: "Price Waterhouse & Co.",
    sub: "Statutory Audit",
    heightClass: "h-7 sm:h-8",
  },
  {
    logo: "/logos/ey.svg",
    alt: "Ernst & Young",
    practice: "S.R. Batliboi & Co.",
    sub: "Assurance & Tax",
    heightClass: "h-7 sm:h-8",
  },
  {
    logo: "/logos/kpmg.svg",
    alt: "KPMG",
    practice: "BSR & Co. LLP",
    sub: "Chartered Accountants",
    heightClass: "h-5 sm:h-6",
  },
  {
    logo: "/logos/bdo.svg",
    alt: "BDO",
    practice: "BDO India LLP",
    sub: "Tax & Advisory",
    heightClass: "h-6 sm:h-7",
  },
  {
    logo: "/logos/grant_thornton.svg",
    alt: "Grant Thornton",
    practice: "Walker Chandiok & Co",
    sub: "Chartered Accountants",
    heightClass: "h-4 sm:h-4.5",
  },
];

/* ── Customer Testimonials (PRD Section 06) ── */
const TESTIMONIALS = [
  {
    quote: "RAO AI cut our manual data entry time by over 70% in the first month alone. Our month-end book closing dropped from 8 days to under 4 hours.",
    author: "Sarah Jenkins",
    role: "VP of Operations",
    company: "FinTech Global",
    initials: "SJ",
    rating: 5,
  },
  {
    quote: "Our finance team set up our entire invoice intake pipeline without waiting on developer bandwidth. The Tally Prime XML connector worked right out of the box.",
    author: "Marcus Chen",
    role: "Lead Product Manager",
    company: "SaaS Scaling Corp",
    initials: "MC",
    rating: 5,
  },
  {
    quote: "Converted our invoice audit from days of stressful firefighting into automated real-time approvals. The 3-way GSTR-2B reconciliation is rock-solid.",
    author: "Elena Rostova",
    role: "CTO",
    company: "Enterprise Cloud Solutions",
    initials: "ER",
    rating: 5,
  },
];

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [isMuted, setIsMuted] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  /* ── Showcase Stacking Cards Scroll Spy & Navigation ── */
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  const cardRef0 = useRef<HTMLDivElement | null>(null);
  const cardRef1 = useRef<HTMLDivElement | null>(null);
  const cardRef2 = useRef<HTMLDivElement | null>(null);
  const cardRef3 = useRef<HTMLDivElement | null>(null);
  const cardRef4 = useRef<HTMLDivElement | null>(null);
  const cardRefs = [cardRef0, cardRef1, cardRef2, cardRef3, cardRef4];

  const cardInnerRef0 = useRef<HTMLDivElement | null>(null);
  const cardInnerRef1 = useRef<HTMLDivElement | null>(null);
  const cardInnerRef2 = useRef<HTMLDivElement | null>(null);
  const cardInnerRef3 = useRef<HTMLDivElement | null>(null);
  const cardInnerRef4 = useRef<HTMLDivElement | null>(null);
  const cardInnerRefs = [cardInnerRef0, cardInnerRef1, cardInnerRef2, cardInnerRef3, cardInnerRef4];

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
          const vh = window.innerHeight || 800;

          if (!isDesktop) {
            // On mobile screen: calculate activeCardIndex based on vertical visibility
            let activeIdx = 0;
            for (let i = 0; i < cardRefs.length; i++) {
              const el = cardRefs[i]?.current;
              if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.top <= vh * 0.45 && rect.bottom >= vh * 0.1) {
                  activeIdx = i;
                }
              }
            }
            setActiveCardIndex(activeIdx);

            // Clean desktop 3D transforms on mobile to avoid scroll jank or trapping
            for (let i = 0; i < cardInnerRefs.length; i++) {
              const innerEl = cardInnerRefs[i]?.current;
              if (innerEl) {
                innerEl.style.transform = "none";
                innerEl.style.opacity = "1";
                innerEl.style.filter = "none";
                innerEl.style.boxShadow = "";
              }
            }
            if (tabBarRef.current) {
              tabBarRef.current.style.transform = "none";
            }
            ticking = false;
            return;
          }

          const CARD_STICKY_TOP = 126;

          // 1. Determine active card index for floating tab selector (Desktop)
          let activeIdx = 0;
          for (let i = 0; i < cardRefs.length; i++) {
            const el = cardRefs[i]?.current;
            if (el) {
              const rect = el.getBoundingClientRect();
              if (rect.top <= CARD_STICKY_TOP + 30) {
                activeIdx = i;
              }
            }
          }
          setActiveCardIndex(activeIdx);

          // 2. Continuous 3D Perspective Stacking & Depth Animation (Desktop)
          for (let i = 0; i < cardRefs.length; i++) {
            const cardEl = cardRefs[i]?.current;
            const innerEl = cardInnerRefs[i]?.current;
            if (!cardEl || !innerEl) continue;

            const rect = cardEl.getBoundingClientRect();

            if (rect.top > CARD_STICKY_TOP) {
              // Incoming Card: Smooth 3D tilt, subtle scale-up, and elevation shadow
              const entryProgress = Math.max(0, Math.min(1, (vh - rect.top) / (vh - CARD_STICKY_TOP)));
              const scale = 0.96 + 0.04 * entryProgress;
              const rotateX = (1 - entryProgress) * 3.5;
              const translateY = (1 - entryProgress) * 20;

              innerEl.style.transform = `perspective(1200px) translateY(${translateY.toFixed(1)}px) rotateX(${rotateX.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
              innerEl.style.opacity = "1";
              innerEl.style.filter = "none";
              innerEl.style.boxShadow = `0 -6px 20px -4px rgba(0, 0, 0, ${(0.05 * entryProgress).toFixed(3)}), 0 22px 50px -10px rgba(0, 0, 0, ${(0.08 + 0.08 * entryProgress).toFixed(3)})`;
            } else {
              // Docked Card: Calculate depth behind subsequent cards to create physical stacked receding deck
              let depth = 0;
              for (let j = i + 1; j < cardRefs.length; j++) {
                const nextEl = cardRefs[j]?.current;
                if (!nextEl) continue;
                const nextRect = nextEl.getBoundingClientRect();
                const nextProgress = Math.max(0, Math.min(1, (vh - nextRect.top) / (vh - CARD_STICKY_TOP)));
                depth += nextProgress;
              }

              // Smooth 3D scale-down as subsequent cards stack over this one (e.g. 1.0 -> 0.96 -> 0.92 -> 0.88 -> 0.84)
              const scale = Math.max(0.82, 1 - 0.042 * depth);
              // Subtle upward translation enhances the tiered cascading lips
              const translateY = -depth * 6;
              // Subtle brightness reduction for realistic depth perception without making the card see-through
              const brightness = Math.max(0.92, 1 - 0.02 * depth);

              innerEl.style.transform = `perspective(1200px) translateY(${translateY.toFixed(1)}px) rotateX(0deg) scale(${scale.toFixed(4)})`;
              innerEl.style.opacity = "1";
              innerEl.style.filter = `brightness(${brightness.toFixed(3)})`;
              innerEl.style.boxShadow = `0 -4px 18px -4px rgba(0, 0, 0, 0.04), 0 15px 35px -8px rgba(0, 0, 0, 0.08)`;
            }
          }

          // 3. Synchronize upper floating toggle with the stack as it unpins into the next section
          const lastCard = cardRefs[cardRefs.length - 1]?.current;
          if (lastCard && tabBarRef.current) {
            const lastRect = lastCard.getBoundingClientRect();
            if (lastRect.top < CARD_STICKY_TOP) {
              const diff = lastRect.top - CARD_STICKY_TOP;
              tabBarRef.current.style.transform = `translateY(${diff}px)`;
            } else {
              tabBarRef.current.style.transform = "translateY(0px)";
            }
          }

          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });
    handleScroll();
    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
    };
  }, []);

  const scrollToCard = (index: number) => {
    const el = cardRefs[index]?.current;
    if (el) {
      const isDesktop = typeof window !== "undefined" && window.innerWidth >= 1024;
      const stickyTop = isDesktop ? 126 : 76;
      const rect = el.getBoundingClientRect();
      const currentScrollY = window.scrollY || window.pageYOffset;
      const targetY = currentScrollY + rect.top - stickyTop;
      window.scrollTo({ top: targetY, behavior: "smooth" });
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground antialiased selection:bg-primary selection:text-primary-foreground">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 lg:px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="text-xl font-bold tracking-tight text-foreground">
                RAO AI
              </span>
            </Link>

            <nav className="hidden items-center gap-7 text-[13.5px] font-semibold text-foreground/80 md:flex">
              <a href="#platform" className="transition-colors hover:text-foreground">
                Platform
              </a>
              <a href="#problem-solution" className="transition-colors hover:text-foreground">
                Overview
              </a>
              <a href="#testimonials" className="transition-colors hover:text-foreground">
                Testimonials
              </a>
              <a href="#faq" className="transition-colors hover:text-foreground">
                FAQ
              </a>
              <Link href="/pricing" className="transition-colors hover:text-foreground">
                Pricing
              </Link>
            </nav>
          </div>

          {/* Header Right Actions */}
          <div className="flex items-center gap-3">
            <Link
              href="/pricing"
              className="hidden rounded-full border border-border bg-card px-4 py-2 text-xs font-medium text-foreground shadow-xs transition-all hover:bg-secondary sm:inline-flex"
            >
              Book a Demo
            </Link>

            <SignedOut>
              <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                <InteractiveHoverButton className="px-5 py-2 text-xs shadow-xs">
                  Try RAO AI
                </InteractiveHoverButton>
              </SignInButton>
            </SignedOut>

            <SignedIn>
              <Link href="/dashboard">
                <InteractiveHoverButton className="px-5 py-2 text-xs shadow-xs">
                  Dashboard
                </InteractiveHoverButton>
              </Link>
            </SignedIn>

            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground md:hidden"
            >
              {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-border bg-background/95 backdrop-blur-md px-4 py-4 shadow-xl md:hidden animate-in fade-in slide-in-from-top-2 duration-200">
            <nav className="flex flex-col space-y-1">
              {[
                { href: "#platform", label: "Platform" },
                { href: "#problem-solution", label: "Overview" },
                { href: "#results", label: "Results" },
                { href: "#testimonials", label: "Testimonials" },
                { href: "#faq", label: "FAQ" },
                { href: "/pricing", label: "Pricing" },
              ].map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
                >
                  <span>{item.label}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </a>
              ))}
            </nav>

            <div className="mt-4 border-t border-border pt-4 flex flex-col gap-2.5">
              <Link
                href="/pricing"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full flex items-center justify-center rounded-full border border-border bg-card py-2.5 text-xs font-semibold text-foreground shadow-2xs hover:bg-secondary transition-colors"
              >
                Book a Demo
              </Link>
              <SignedOut>
                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                  <InteractiveHoverButton className="w-full py-2.5 text-xs shadow-xs justify-center">
                    Try RAO AI
                  </InteractiveHoverButton>
                </SignInButton>
              </SignedOut>
              <SignedIn>
                <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)} className="w-full">
                  <InteractiveHoverButton className="w-full py-2.5 text-xs shadow-xs justify-center">
                    Go to Dashboard
                  </InteractiveHoverButton>
                </Link>
              </SignedIn>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        {/* ── 1. Hero Section (2-Column Split Wash Container - Theme Gray Wash) ── */}
        <section className="px-3 sm:px-6 lg:px-8 pt-3 pb-4 sm:pb-6">
          <div className="mx-auto max-w-[1340px] rounded-[22px] sm:rounded-[36px] bg-[#f4f5f8] border border-[#e2e5ec] p-4 sm:p-8 lg:p-11 shadow-xs relative overflow-hidden">
            {/* Subtle radial ambient light matching theme */}
            <div className="pointer-events-none absolute -top-24 -right-24 h-96 w-96 rounded-full bg-white/80 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-24 h-96 w-96 rounded-full bg-[#d8dde6]/40 blur-3xl" />

            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-10 items-center">
              {/* Left Column: Headline & High-Converting Direct CTA (5 cols on lg) */}
              <div className="lg:col-span-5 flex flex-col justify-center">
                <h1 className="text-3xl sm:text-4xl lg:text-[45px] xl:text-[49px] font-bold tracking-tight text-[#111827] leading-[1.15]">
                  Every Invoice Extracted.
                  <br />
                  Zero <em className="font-serif italic font-normal text-primary">Discrepancies.</em>
                </h1>

                <p className="mt-3 sm:mt-5 text-xs sm:text-base text-[#4b5563] leading-relaxed">
                  Automate multi-page invoice extraction, 3-way GSTR-2B tax reconciliation, and ledger
                  postings in real-time. RAO AI catches mismatches before they hit your books—so your
                  finance team stays audit-ready without manual data entry.
                </p>

                {/* High-Converting Action CTAs */}
                <div className="mt-5 sm:mt-8">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <SignedOut>
                      <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                        <InteractiveHoverButton className="w-full sm:w-auto px-6 py-3 text-xs sm:text-sm shadow-sm h-auto justify-center">
                          Start Free Trial
                        </InteractiveHoverButton>
                      </SignInButton>
                    </SignedOut>
                    <SignedIn>
                      <Link href="/dashboard" className="w-full sm:w-auto">
                        <InteractiveHoverButton className="w-full sm:w-auto px-6 py-3 text-xs sm:text-sm shadow-sm h-auto justify-center">
                          Go to Dashboard
                        </InteractiveHoverButton>
                      </Link>
                    </SignedIn>

                    <Link
                      href="/pricing"
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-[#d1d5db] bg-white hover:bg-[#f9fafb] text-[#111827] px-6 py-3 text-xs sm:text-sm font-semibold shadow-2xs transition-all hover:border-[#9ca3af] cursor-pointer text-center"
                    >
                      <span>Book a Demo</span>
                    </Link>
                  </div>

                  {/* Micro-trust indicators */}
                  <div className="mt-3.5 sm:mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] sm:text-xs text-[#6b7280]">
                    <span className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      No credit card required
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      Tally Prime &amp; SAP ready
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      Instant 2-min setup
                    </span>
                  </div>

                  {/* Rating Trust Snippet (PRD Section 01) */}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#4b5563]">
                    <div className="flex text-amber-500 text-xs">
                      {"★".repeat(5)}
                    </div>
                    <span className="font-semibold text-[#111827]">Rated 4.9/5</span>
                    <span className="text-muted-foreground">by 12,000+ teams</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Clean Video Frame (7 cols on lg) */}
              <div className="lg:col-span-7">
                <div className="relative aspect-[16/10] w-full rounded-[16px] sm:rounded-[22px] bg-black border border-black/10 shadow-xl overflow-hidden">
                  <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    autoPlay
                    muted={isMuted}
                    loop
                    playsInline
                    preload="auto"
                    onLoadedData={() => setVideoError(false)}
                    onError={() => setVideoError(true)}
                  >
                    <source
                      src="/static/kling_20260815_VIDEO_Updated_10_6126_0.mp4"
                      type="video/mp4"
                    />
                  </video>

                  {/* Fallback if video fails to decode */}
                  {videoError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#11141a] p-6 text-center text-white">
                      <div>
                        <p className="font-mono text-xs uppercase tracking-widest text-[#a0a0a8]">
                          Interactive Console Ready
                        </p>
                        <p className="mt-2 text-sm text-[#e8e8ed]">
                          Video preview loaded below in the live inspection console.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Subtle Floating Mute Button */}
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="absolute bottom-3 right-3 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white/80 backdrop-blur-sm transition-all hover:bg-black/90 hover:text-white cursor-pointer"
                    aria-label={isMuted ? "Unmute video" : "Mute video"}
                  >
                    {isMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Enterprise Social Proof Logo Bar (PRD Section 02 with Scroll Velocity) ── */}
        <section className="border-b border-border/80 bg-white/70 py-5 sm:py-8 overflow-hidden relative">
          <div className="mx-auto max-w-6xl px-4 text-center md:px-6 mb-3 sm:mb-5">
            <p className="font-mono text-[9px] sm:text-[11px] uppercase tracking-[0.16em] sm:tracking-[0.2em] text-[#64748b] font-semibold">
              TRUSTED BY LEADING CA FIRMS &amp; AUDIT PRACTITIONERS ACROSS INDIA
            </p>
          </div>

          <div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
            <ScrollVelocityContainer className="w-full">
              <ScrollVelocityRow baseVelocity={3} direction={1} className="py-2">
                {CA_FIRMS.map((co, idx) => (
                  <div
                    key={`${co.alt}-${idx}`}
                    className="mx-4 sm:mx-10 inline-flex flex-col items-center justify-center gap-1.5 group transition-all duration-300 hover:-translate-y-0.5"
                  >
                    <div className="h-8 sm:h-9 flex items-center justify-center">
                      <img
                        src={co.logo}
                        alt={co.alt}
                        className={`${co.heightClass} w-auto max-w-[110px] sm:max-w-[125px] object-contain opacity-85 group-hover:opacity-100 transition-opacity`}
                        loading="lazy"
                      />
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] sm:text-[11px] font-bold text-foreground leading-tight">{co.practice}</div>
                      <div className="text-[8px] sm:text-[9px] text-muted-foreground font-mono">{co.sub}</div>
                    </div>
                  </div>
                ))}
              </ScrollVelocityRow>
            </ScrollVelocityContainer>

            {/* Responsive gradient edge masks so logos remain clear on mobile screens */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-8 sm:w-24 md:w-40 bg-gradient-to-r from-white to-transparent z-10" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-8 sm:w-24 md:w-40 bg-gradient-to-l from-white to-transparent z-10" />
          </div>
        </section>

        {/* ── 4. Showcase Section (Sequential Cards with Sticky Pinned Tab Navigation) ── */}
        <section id="platform" className="scroll-mt-14 border-b border-border bg-[#fafbfc] pt-8 sm:pt-10 pb-14 sm:pb-20">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            {/* Section Header */}
            <div className="text-center max-w-3xl mx-auto mb-6 sm:mb-8">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Platform Architecture
              </span>
              <h2 className="mt-2 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground">
                Power the Autonomous Flow of Your Accounts
              </h2>
              <p className="mt-2.5 text-xs sm:text-sm text-muted-foreground">
                One unified platform for document intake, extraction, automated ledger classification, and real-time Tally Prime synchronization.
              </p>
            </div>

            {/* Sticky Floating Tab Selector Bar */}
            <div
              ref={tabBarRef}
              className="sticky top-14 sm:top-16 z-40 py-2 sm:py-3 -mx-4 px-4 bg-[#fafbfc]/90 backdrop-blur-md transition-shadow"
            >
              <div className="flex justify-start sm:justify-center overflow-x-auto no-scrollbar py-1">
                <div className="inline-flex items-center gap-1 sm:gap-2 rounded-full border border-border/90 bg-white p-1 sm:p-1.5 shadow-sm shrink-0">
                  {SHOWCASE_STAGES.map((stage, idx) => {
                    const isActive = activeCardIndex === idx;
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => scrollToCard(idx)}
                        className={`rounded-full px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs font-semibold whitespace-nowrap shrink-0 transition-all duration-300 ${
                          isActive
                            ? "bg-[#111827] text-white shadow-xs font-bold scale-[1.02]"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                        }`}
                      >
                        {stage.tabLabel}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Scroll-Driven Pinned Stacking Showcase Cards */}
            <div className="relative mt-6 sm:mt-8">
              {SHOWCASE_STAGES.map((stage, idx) => {
                const MockupComponent = stage.Mockup;
                const isLast = idx === SHOWCASE_STAGES.length - 1;
                return (
                  <div
                    key={stage.id}
                    ref={cardRefs[idx]}
                    style={{
                      zIndex: 10 + idx,
                    }}
                    className="relative lg:sticky lg:top-[126px] w-full mb-8 sm:mb-12 lg:mb-[32vh]"
                  >
                    <div
                      ref={cardInnerRefs[idx]}
                      style={{
                        transformOrigin: "top center",
                        willChange: "transform, opacity, filter",
                      }}
                      className="w-full rounded-[22px] sm:rounded-[32px] lg:rounded-[36px] border border-border/80 bg-white p-4 sm:p-6 lg:p-8 shadow-md lg:shadow-xl lg:h-[550px] flex flex-col justify-between overflow-hidden"
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-stretch h-full">
                        {/* Left Column: Feature Storytelling */}
                        <div className="lg:col-span-5 flex flex-col justify-between h-full">
                          <div>
                            <span className="inline-block rounded-full bg-secondary text-foreground px-2.5 py-0.5 sm:px-3 sm:py-1 text-[9px] sm:text-[10px] font-bold tracking-wider uppercase font-mono border border-border/70">
                              {stage.eyebrow}
                            </span>
                            <h3 className="mt-2.5 sm:mt-3 text-lg sm:text-2xl lg:text-3xl font-extrabold text-[#111827] tracking-tight leading-snug">
                              {stage.title}
                            </h3>
                            <p className="mt-2 sm:mt-3 text-xs sm:text-sm leading-relaxed text-muted-foreground">
                              {stage.description}
                            </p>

                            {/* Signature Animated Card CTA Button (Uiverse ryota1231 in RAO AI theme) */}
                            <div className="mt-4 sm:mt-6">
                              <SignedOut>
                                <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                                  <AnimatedButton type="button" className="w-full sm:w-auto">
                                    {stage.ctaText}
                                  </AnimatedButton>
                                </SignInButton>
                              </SignedOut>
                              <SignedIn>
                                <Link href={stage.ctaLink} className="inline-block w-full sm:w-auto">
                                  <AnimatedButton type="button" className="w-full sm:w-auto">
                                    {stage.ctaText}
                                  </AnimatedButton>
                                </Link>
                              </SignedIn>
                            </div>
                          </div>

                          {/* IN THIS CAPABILITY Checklist */}
                          <div className="mt-5 pt-4 sm:mt-6 sm:pt-5 border-t border-border/70">
                            <div className="text-[10px] font-mono font-bold tracking-widest text-muted-foreground uppercase mb-2 sm:mb-3">
                              IN THIS CAPABILITY
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-2 text-xs">
                              {stage.checklist.map((item, itemIdx) => (
                                <div
                                  key={itemIdx}
                                  className="flex items-center gap-1.5 text-foreground font-medium"
                                >
                                  <ChevronRight className="h-3.5 w-3.5 text-[#111827] shrink-0 font-bold" />
                                  <span className="truncate">{item}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Right Column: Recreated Product Screenshot UI */}
                        <div className="lg:col-span-7 h-full flex flex-col justify-center min-w-0">
                          <MockupComponent />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Dwell spacer: Shown only on desktop where stacking cards pin */}
              <div className="hidden lg:block h-[16vh] sm:h-[20vh] w-full pointer-events-none" aria-hidden="true" />
            </div>
          </div>
        </section>

        {/* ── 3. Problem vs. Solution Framework (PRD Section 03) ── */}
        <section id="problem-solution" className="scroll-mt-14 border-b border-border bg-white py-12 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                Problem vs. Solution
              </span>
              <h2 className="mt-2 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground">
                Stop Wasting Time on Repetitive Manual Operations
              </h2>
              <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-muted-foreground max-w-xl mx-auto">
                Compare the friction of legacy spreadsheet bookkeeping against RAO AI&apos;s autonomous accounting pipeline.
              </p>
            </div>

            <div className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8">
              {/* Column A: The Old Way */}
              <div className="rounded-2xl sm:rounded-3xl border border-red-200/80 bg-red-50/20 p-4 sm:p-8 flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-100/60 px-3 py-1 text-[10px] sm:text-[11px] font-semibold text-red-700">
                    <span>The Old Way</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider">(Legacy Friction)</span>
                  </div>
                  <h3 className="mt-3 sm:mt-4 text-lg sm:text-xl font-bold text-foreground">
                    Manual Friction &amp; Disjointed Spreadsheets
                  </h3>
                  <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-muted-foreground">
                    Outdated workflows that drain finance team morale, delay month-end close, and invite audit penalties.
                  </p>

                  <div className="mt-4 sm:mt-6 space-y-3 sm:space-y-4">
                    {[
                      {
                        title: "Manual Data Entry",
                        desc: "Finance teams spend 4–6 hours daily copying vendor line items, GST numbers, and tax totals into spreadsheets.",
                      },
                      {
                        title: "Fragmented Systems",
                        desc: "Invoices live across email inboxes, WhatsApp messages, and desktop folders with no centralized source of truth.",
                      },
                      {
                        title: "Human Errors & ITC Loss",
                        desc: "Typographical slips lead to costly GSTR-2B mismatches and blocked Input Tax Credit during statutory tax filing.",
                      },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 sm:gap-3 rounded-xl border border-red-100 bg-white/80 p-3 sm:p-4">
                        <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                          ✕
                        </div>
                        <div>
                          <div className="text-xs sm:text-sm font-bold text-foreground">{item.title}</div>
                          <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 sm:mt-6 pt-3 sm:pt-4 border-t border-red-200/60 text-[11px] sm:text-xs font-mono text-red-700 font-medium">
                  Legacy Reality: 8+ days lost on every month-end closing cycle
                </div>
              </div>

              {/* Column B: The RAO AI Way */}
              <div className="rounded-2xl sm:rounded-3xl border border-emerald-500/40 bg-emerald-50/15 p-4 sm:p-8 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-emerald-100/70 px-3 py-1 text-[10px] sm:text-[11px] font-semibold text-emerald-800">
                    <span>The RAO AI Way</span>
                    <span className="font-mono text-[9px] uppercase tracking-wider">(Autonomous Flow)</span>
                  </div>
                  <h3 className="mt-3 sm:mt-4 text-lg sm:text-xl font-bold text-foreground">
                    1-Click Autonomous Ledger Sync
                  </h3>
                  <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-muted-foreground">
                    Sub-second invoice extraction, automated Chart of Accounts classification, and direct Tally ERP sync.
                  </p>

                  <div className="mt-4 sm:mt-6 space-y-3 sm:space-y-4">
                    {[
                      {
                        title: "1-Click Automation",
                        desc: "Upload 50+ multi-page bills at once. RAO AI extracts line items, validates tax arithmetic, and exports ready Tally XML in seconds.",
                      },
                      {
                        title: "Unified Real-Time Dashboard",
                        desc: "Centralized live view of intake status, automated ledger mappings, and audit-ready vendor records with sub-second search.",
                      },
                      {
                        title: "99.9% Arithmetic Accuracy",
                        desc: "Automated row-level checksum and live GSTR-2B validation guarantee zero tax claim leakage and audit peace of mind.",
                      },
                    ].map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2.5 sm:gap-3 rounded-xl border border-emerald-200/80 bg-white p-3 sm:p-4 shadow-2xs">
                        <div className="h-5 w-5 sm:h-6 sm:w-6 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                          <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                        </div>
                        <div>
                          <div className="text-xs sm:text-sm font-bold text-foreground">{item.title}</div>
                          <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 leading-relaxed">{item.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 sm:mt-6 pt-3 sm:pt-4 border-t border-emerald-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-[11px] sm:text-xs">
                  <span className="font-mono text-emerald-800 font-semibold">RAO AI: Cleared in under 4 hours</span>
                  <span className="text-emerald-700 font-bold">99.9% Verified</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Proven Results & Impact ── */}
        <section id="results" className="scroll-mt-14 border-b border-border py-12 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Measurable Impact
              </span>
              <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                Proven Results Across Manufacturing &amp; Accounting Teams
              </h2>
            </div>

            <div className="mt-8 sm:mt-10 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
              {[
                {
                  icon: Clock,
                  value: "80%",
                  label: "Time Saved",
                  detail: "Manual data entry eliminated across intake, voucher creation, and review.",
                },
                {
                  icon: CheckCircle2,
                  value: "100%",
                  label: "Accuracy",
                  detail: "Every extracted line item is arithmetic-verified before ERP sync.",
                },
                {
                  icon: Zap,
                  value: "5x",
                  label: "Faster Clearing",
                  detail: "Tax matching and invoice validation that took days now clears in minutes.",
                },
                {
                  icon: ShieldCheck,
                  value: "0",
                  label: "Duplicate Bills",
                  detail: "Automated ledger mapping rules detect duplicate submissions before export.",
                },
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={idx}
                    className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-2xs transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-lg border border-border bg-secondary/60 text-foreground">
                        <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                      </div>

                      <div className="mt-3 sm:mt-4 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground">
                        {item.value}
                      </div>

                      <div className="mt-1 font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.12em] sm:tracking-[0.15em] text-muted-foreground">
                        {item.label}
                      </div>
                    </div>

                    <p className="mt-2.5 sm:mt-3 text-[11px] sm:text-xs leading-relaxed text-muted-foreground">
                      {item.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 5. Customer Testimonials & Trust (PRD Section 06) ── */}
        <section id="testimonials" className="scroll-mt-14 border-b border-border bg-[#fafbfc] py-12 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 md:px-6">
            <div className="text-center max-w-3xl mx-auto">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                Social Proof
              </span>
              <h2 className="mt-2 text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-foreground">
                Loved by Teams Running High-Scale Operations
              </h2>
              <p className="mt-2 sm:mt-3 text-xs sm:text-sm text-muted-foreground">
                See how finance leaders, operations heads, and enterprise CAs eliminate invoice backlogs with RAO AI.
              </p>
            </div>

            <div className="mt-8 sm:mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-8">
              {TESTIMONIALS.map((testimonial, idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-border bg-card p-5 sm:p-7 shadow-xs flex flex-col justify-between transition-all hover:shadow-md hover:-translate-y-0.5"
                >
                  <div>
                    <div className="flex text-amber-500 gap-0.5 text-xs mb-3 sm:mb-4">
                      {"★".repeat(testimonial.rating)}
                    </div>
                    <p className="text-xs sm:text-sm leading-relaxed text-foreground font-medium">
                      &ldquo;{testimonial.quote}&rdquo;
                    </p>
                  </div>

                  <div className="mt-5 sm:mt-6 pt-4 sm:pt-5 border-t border-border flex items-center gap-3">
                    <div className="h-8 w-8 sm:h-9 sm:w-9 rounded-full bg-[#111827] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {testimonial.initials}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-foreground truncate">{testimonial.author}</div>
                      <div className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
                        {testimonial.role}, <span className="text-foreground/80">{testimonial.company}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 sm:mt-10 text-center">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-primary hover:underline"
              >
                <span>Read customer case studies</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        {/* ── 6. FAQ Section ── */}
        <section id="faq" className="scroll-mt-14 border-b border-border py-12 sm:py-24">
          <div className="mx-auto max-w-3xl px-4 md:px-6">
            <div className="text-center">
              <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                FAQ
              </span>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-4xl">
                Frequently Asked Questions
              </h2>
            </div>

            <div className="mt-8 sm:mt-10 divide-y divide-border border-y border-border">
              {FAQS.map((faq, i) => {
                const isOpen = openFaq === i;
                return (
                  <div key={i} className="py-4 sm:py-5">
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between gap-4 text-left font-semibold text-foreground text-sm sm:text-base hover:text-primary transition-colors py-1 cursor-pointer"
                    >
                      <span className="pr-2">{faq.q}</span>
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${isOpen ? "rotate-180" : ""
                          }`}
                      />
                    </button>

                    <div
                      className={`grid overflow-hidden transition-all duration-300 ease-out ${isOpen ? "grid-rows-[1fr] pt-2.5 sm:pt-3 opacity-100" : "grid-rows-[0fr] opacity-0"
                        }`}
                    >
                      <div className="min-h-0 text-xs sm:text-sm leading-relaxed text-muted-foreground">
                        {faq.a}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── 8. High-Converting Bottom CTA ── */}
        <section className="border-b border-border bg-secondary/30 py-12 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 text-center md:px-6">
            <div className="rounded-2xl sm:rounded-3xl border border-border bg-card p-6 sm:p-14 shadow-sm">
              <h2 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-5xl">
                Ready to Eliminate Invoice Data Entry?
              </h2>
              <p className="mx-auto mt-3 sm:mt-4 max-w-xl text-xs sm:text-base text-muted-foreground">
                Join leading finance teams and CAs saving over 80% of data entry time.
                Process 50 invoices free today. No credit card required.
              </p>

              {/* Bottom Direct CTAs */}
              <div className="mx-auto mt-6 sm:mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
                <SignedOut>
                  <SignInButton mode="modal" forceRedirectUrl="/dashboard">
                    <InteractiveHoverButton className="w-full sm:w-auto px-7 py-3 text-xs sm:text-sm shadow-sm h-auto justify-center">
                      Start Free Trial
                    </InteractiveHoverButton>
                  </SignInButton>
                </SignedOut>
                <SignedIn>
                  <Link href="/dashboard" className="w-full sm:w-auto">
                    <InteractiveHoverButton className="w-full sm:w-auto px-7 py-3 text-xs sm:text-sm shadow-sm h-auto justify-center">
                      Go to Dashboard
                    </InteractiveHoverButton>
                  </Link>
                </SignedIn>

                <Link
                  href="/pricing"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-[#d1d5db] bg-white hover:bg-[#f9fafb] text-[#111827] px-6 py-3 text-xs sm:text-sm font-semibold shadow-2xs transition-all hover:border-[#9ca3af] cursor-pointer text-center"
                >
                  <span>Book a Demo</span>
                </Link>
              </div>

              <div className="mt-3.5 sm:mt-4 text-[11px] sm:text-xs text-muted-foreground">
                Setup in 2 minutes · No credit card required · Full Tally XML export included
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── 9. Professional Enterprise Footer ── */}
      <footer className="border-t border-border bg-background">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:py-12 grid-cols-2 md:grid-cols-4 md:px-6">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight text-foreground">RAO AI</span>
              <span className="rounded border border-border bg-secondary px-1.5 py-0.2 font-mono text-[9px] text-muted-foreground uppercase">
                v2.5
              </span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Intelligent invoice extraction, automated GSTR-2B reconciliation, and double-entry accounting sync for finance teams.
            </p>

            {/* Social Icons (PRD Section 08) */}
            <div className="mt-4 flex items-center gap-3 text-muted-foreground">
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Twitter / X"
                className="hover:text-foreground transition-colors p-1"
              >
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn"
                className="hover:text-foreground transition-colors p-1"
              >
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                  <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.2V10.9H6.46M7.83 6.45a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3" />
                </svg>
              </a>
              <a
                href="https://github.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                className="hover:text-foreground transition-colors p-1"
              >
                <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2" />
                </svg>
              </a>
            </div>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Platform
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              <li>
                <Link href="/upload" className="text-muted-foreground hover:text-foreground transition-colors">
                  Upload &amp; Intake
                </Link>
              </li>
              <li>
                <Link href="/gst" className="text-muted-foreground hover:text-foreground transition-colors">
                  GST Reconciliation
                </Link>
              </li>
              <li>
                <Link href="/transactions" className="text-muted-foreground hover:text-foreground transition-colors">
                  Transactions &amp; Export
                </Link>
              </li>
              <li>
                <Link href="/chat" className="text-muted-foreground hover:text-foreground transition-colors">
                  Conversational AI
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Connectors
            </p>
            <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
              <li>Tally Prime (XML &amp; ODBC)</li>
              <li>SAP S/4HANA (BAPI)</li>
              <li>Zoho Books &amp; Busy</li>
              <li>QuickBooks Cloud</li>
              <li>Excel / CSV Export</li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground font-semibold">
              Account &amp; Legal
            </p>
            <ul className="mt-3 space-y-2 text-xs">
              <li>
                <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                  Pricing Plans
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li className="text-muted-foreground font-mono text-[11px]">DPDPA 2023 Compliant</li>
              <li className="text-muted-foreground font-mono text-[11px]">On-Premise Ready</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border px-4 py-4 md:px-6">
          <div className="mx-auto flex max-w-6xl flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-2 text-center sm:text-left">
            <p>© {new Date().getFullYear()} RAO AI. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                All Systems Operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}