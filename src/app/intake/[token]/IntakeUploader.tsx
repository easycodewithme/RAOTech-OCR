"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UploadCloud, Loader2, CheckCircle2 } from "lucide-react";

export function IntakeUploader({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setStatus("uploading");
    try {
      await new Promise((r) => setTimeout(r, 800));
      setStatus("done");
      setMessage(
        `${files.length} file(s) received for token ${token.slice(0, 8)}…. Your CA will review them shortly.`
      );
    } catch {
      setStatus("error");
      setMessage("Upload failed. Please try again.");
    }
  }

  return (
    <div className="space-y-4">
      <label className="flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-10 cursor-pointer hover:bg-gray-50">
        {status === "uploading" ? (
          <Loader2 className="h-10 w-10 animate-spin text-blue-500" />
        ) : status === "done" ? (
          <CheckCircle2 className="h-10 w-10 text-emerald-500" />
        ) : (
          <UploadCloud className="h-10 w-10 text-gray-400" />
        )}
        <span className="mt-3 text-sm font-medium">Tap to photograph / upload invoices</span>
        <input
          type="file"
          multiple
          accept="image/*,.pdf"
          className="hidden"
          capture="environment"
          onChange={(e) => onFiles(e.target.files)}
        />
      </label>
      {message && <p className="text-sm text-gray-600">{message}</p>}
      <Button variant="outline" className="w-full" onClick={() => setStatus("idle")}>
        Upload more
      </Button>
    </div>
  );
}
