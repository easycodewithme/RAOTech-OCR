"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, UploadCloud, MessageSquare, LogOut, Receipt } from "lucide-react";
import { cn } from "@/lib/utils"; // Shadcn utility

const routes = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/dashboard",
    color: "text-sky-500",
  },
  {
    label: "Upload Invoice",
    icon: UploadCloud,
    href: "/upload",
    color: "text-violet-500",
  },
  {
    label: "AI Assistant",
    icon: MessageSquare,
    href: "/chat",
    color: "text-pink-700",
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="space-y-4 py-4 flex flex-col h-full bg-[#111827] text-white">
      <div className="px-3 py-2 flex-1">
        <Link href="/dashboard" className="flex items-center pl-3 mb-14">
          <h1 className="text-2xl font-bold">RAO AI</h1>
        </Link>
        <div className="space-y-1">
          {routes.map((route) => (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                "text-sm group flex p-3 w-full justify-start font-medium cursor-pointer hover:text-white hover:bg-white/10 rounded-lg transition",
                pathname === route.href ? "text-white bg-white/10" : "text-zinc-400"
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
        <Link
          href="/"
          className="flex items-center p-3 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer transition"
        >
          <LogOut className="h-5 w-5 mr-3 text-red-500" />
          Logout
        </Link>
      </div>
    </div>
  );
}