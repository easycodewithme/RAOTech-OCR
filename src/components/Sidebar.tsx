"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UploadCloud,
  MessageSquare,
  LogOut,
  BookOpen,
  ListChecks,
  Scale,
  BarChart3,
  Kanban,
  Link2,
  ClipboardList,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@clerk/nextjs";

const routes = [
  { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard", color: "text-sky-500" },
  { label: "Pipeline", icon: Kanban, href: "/pipeline", color: "text-indigo-400" },
  { label: "Upload", icon: UploadCloud, href: "/upload", color: "text-violet-500" },
  { label: "Review queue", icon: Filter, href: "/review", color: "text-rose-400" },
  { label: "Transactions", icon: ListChecks, href: "/transactions", color: "text-emerald-500" },
  { label: "GST Recon", icon: Scale, href: "/gst", color: "text-orange-400" },
  { label: "Reports", icon: BarChart3, href: "/reports", color: "text-cyan-400" },
  { label: "Ledgers & Rules", icon: BookOpen, href: "/settings", color: "text-amber-500" },
  { label: "Intake Links", icon: Link2, href: "/intake", color: "text-pink-400" },
  { label: "Tasks", icon: ClipboardList, href: "/tasks", color: "text-lime-400" },
  { label: "AI Assistant", icon: MessageSquare, href: "/chat", color: "text-pink-700" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="space-y-4 py-4 flex flex-col h-full bg-[#111827] text-white">
      <div className="px-3 py-2 flex-1">
        <Link href="/dashboard" className="flex items-center pl-3 mb-10">
          <h1 className="text-2xl font-bold">RAO AI</h1>
        </Link>
        <div className="space-y-1">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition",
                pathname === route.href || pathname.startsWith(route.href + "/")
                  ? "text-white bg-white/10"
                  : "text-zinc-400"
              )}
            >
              <div className="flex items-center flex-1">
                <route.icon className={cn("h-5 w-5 mr-3", route.color)} />
                {route.label}
              </div>
            </Link>
          ))}
        </div>
      </div>
      <div className="px-3 py-2">
        <SignOutButton>
          <div className="flex items-center p-3 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer transition">
            <LogOut className="h-5 w-5 mr-3 text-red-500" />
            Logout
          </div>
        </SignOutButton>
      </div>
    </div>
  );
}
