"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  UploadCloud,
  LayoutDashboard,
  ListChecks,
  Scale,
  BookOpen,
  Kanban,
  Filter,
} from "lucide-react";

const COMMANDS = [
  { id: "dash", label: "Go to Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: "home kpi" },
  { id: "upload", label: "Upload documents", href: "/upload", icon: UploadCloud, keywords: "ocr extract" },
  { id: "tx", label: "Transactions", href: "/transactions", icon: ListChecks, keywords: "vouchers approve" },
  { id: "review", label: "Review queue (low confidence)", href: "/review", icon: Filter, keywords: "confidence queue" },
  { id: "pipeline", label: "Pipeline board", href: "/pipeline", icon: Kanban, keywords: "kanban" },
  { id: "gst", label: "GST reconciliation", href: "/gst", icon: Scale, keywords: "2b itc" },
  { id: "settings", label: "Ledgers & rules", href: "/settings", icon: BookOpen, keywords: "mapping" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(needle) ||
        c.keywords.includes(needle) ||
        c.href.includes(needle)
    );
  }, [q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border bg-white shadow-2xl animate-in zoom-in-95 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="h-4 w-4 text-gray-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to… (⌘K / Ctrl+K)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            onKeyDown={(e) => {
              if (e.key === "Enter" && filtered[0]) {
                router.push(filtered[0].href);
                setOpen(false);
              }
            }}
          />
          <kbd className="hidden rounded border bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400 sm:inline">
            ESC
          </kbd>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-gray-400">No matches</li>
          )}
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  router.push(c.href);
                  setOpen(false);
                }}
              >
                <c.icon className="h-4 w-4 text-gray-400" />
                <span className="font-medium text-gray-800">{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
