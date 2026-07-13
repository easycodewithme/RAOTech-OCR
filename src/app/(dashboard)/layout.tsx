import { Sidebar } from "@/components/Sidebar";
import { ClientSwitcher } from "@/components/ClientSwitcher";
import { ToastProvider } from "@/components/Toast";
import { CommandPalette } from "@/components/CommandPalette";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="h-full relative">
        <div className="hidden h-full md:flex md:w-72 md:flex-col md:fixed md:inset-y-0 z-[80] bg-gray-900">
          <Sidebar />
        </div>
        <main className="md:pl-72 pb-10 min-h-screen bg-slate-50">
          <div className="sticky top-0 z-40 flex items-center justify-between border-b bg-white/90 px-6 py-3 backdrop-blur">
            <div className="text-sm text-gray-500">
              CA workspace ·{" "}
              <kbd className="rounded border bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                ⌘K
              </kbd>
            </div>
            <ClientSwitcher />
          </div>
          {children}
        </main>
        <CommandPalette />
      </div>
    </ToastProvider>
  );
}
