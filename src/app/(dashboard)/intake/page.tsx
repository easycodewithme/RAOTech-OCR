"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Link2, Plus } from "lucide-react";

type LinkRow = {
  id: string;
  token: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
};

export default function IntakePage() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/intake");
    if (res.ok) {
      const data = await res.json();
      setLinks(data.links || []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    try {
      await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label || undefined }),
      });
      setLabel("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  function copyUrl(token: string) {
    const url = `${window.location.origin}/intake/${token}`;
    navigator.clipboard.writeText(url);
  }

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Client intake links</h1>
        <p className="text-gray-500 text-sm mt-1">
          Share a link so clients can upload invoices/docs directly (TaxOne auto-collect style).
        </p>
      </div>

      <div className="border rounded-xl bg-white p-4 flex gap-2 shadow-sm">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
        />
        <Button onClick={create} disabled={busy}>
          <Plus className="mr-2 h-4 w-4" /> Create link
        </Button>
      </div>

      <div className="space-y-2">
        {links.map((l) => (
          <div key={l.id} className="border rounded-xl bg-white p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <Link2 className="h-4 w-4 text-pink-500" />
              <div>
                <div className="font-medium">{l.label || "Intake link"}</div>
                <div className="text-xs text-gray-400 font-mono">/intake/{l.token.slice(0, 8)}…</div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => copyUrl(l.token)}>
              <Copy className="mr-2 h-3.5 w-3.5" /> Copy URL
            </Button>
          </div>
        ))}
        {links.length === 0 && (
          <div className="text-sm text-gray-400 text-center py-8">No intake links yet</div>
        )}
      </div>
    </div>
  );
}
