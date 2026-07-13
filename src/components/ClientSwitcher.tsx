"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Client = {
  id: string;
  name: string;
  gstin: string | null;
  isDefault: boolean;
};

export function ClientSwitcher() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/clients");
    if (!res.ok) return;
    const data = await res.json();
    setClients(data.clients || []);
    setActiveId(data.activeClientId);
  }

  useEffect(() => {
    load();
  }, []);

  const active = clients.find((c) => c.id === activeId) || clients[0];

  async function switchClient(id: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id }),
      });
      if (res.ok) {
        setActiveId(id);
        setOpen(false);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  async function createClient() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.client) {
        setNewName("");
        setCreating(false);
        await switchClient(data.client.id);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-gray-50"
      >
        <Building2 className="h-4 w-4 text-emerald-600" />
        <span className="max-w-[180px] truncate">{active?.name || "Select client"}</span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border bg-white shadow-xl">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-gray-400">
            Clients
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {clients.map((c) => (
              <button
                key={c.id}
                disabled={saving}
                onClick={() => switchClient(c.id)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-50"
              >
                <div>
                  <div className="font-medium">{c.name}</div>
                  {c.gstin && <div className="text-xs text-gray-400">{c.gstin}</div>}
                </div>
                {c.id === activeId && <Check className="h-4 w-4 text-emerald-600" />}
              </button>
            ))}
          </div>
          <div className="border-t p-2">
            {creating ? (
              <div className="flex gap-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Client name"
                  className="h-8"
                  autoFocus
                />
                <Button size="sm" onClick={createClient} disabled={saving}>
                  Add
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setCreating(true)}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> New client
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
