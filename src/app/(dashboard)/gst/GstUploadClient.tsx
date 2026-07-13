"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, UploadCloud } from "lucide-react";

export default function GstUploadClient() {
  const router = useRouter();
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      let data: unknown = text;
      if (file.name.toLowerCase().endsWith(".json")) {
        data = JSON.parse(text);
      }
      const res = await fetch("/api/gst/2b", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, period: period || null, data }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Upload failed");
        return;
      }
      router.push(`/gst/${json.upload.id}`);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to parse file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-xl bg-white shadow-sm p-6 space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-gray-500">Period (YYYY-MM)</label>
          <Input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-06"
            className="w-40"
          />
        </div>
        <label className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 cursor-pointer hover:bg-gray-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          <span className="text-sm font-medium">{busy ? "Reconciling…" : "Upload GSTR-2B JSON/CSV"}</span>
          <input
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.currentTarget.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-gray-500">
        Supports GST portal GSTR-2B JSON or a CSV with columns like Invoice Number, GSTIN, Taxable Value, CGST, SGST, IGST.
      </p>
    </div>
  );
}
