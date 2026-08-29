"use client";

import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A confirm that has room to say what it is about to do. Used where the
 *  consequence lands outside this app — in Tally's books, or on a paired
 *  machine — and a browser confirm() would be too thin to explain it. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 p-4 pt-[16vh] backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border bg-white shadow-2xl animate-in zoom-in-95 fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-start gap-2">
            {destructive && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
            <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          </div>
          <button type="button" aria-label="Cancel" onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3 text-sm leading-relaxed text-gray-600">{body}</div>
        <div className="flex justify-end gap-2 border-t bg-gray-50 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
