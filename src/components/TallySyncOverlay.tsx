"use client";

import { CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SyncPhase = "idle" | "sending" | "synced";

/** Full-screen overlay: documents flying into a Tally box, then a success state.
 *  Purely visual (prototype) — no real Tally integration. */
export function TallySyncOverlay({
  phase,
  onDone,
  label = "voucher",
}: {
  phase: SyncPhase;
  onDone: () => void;
  label?: string;
}) {
  if (phase === "idle") return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm">
      <style>{`
        @keyframes flyToTally {
          0%   { left: 8%;  opacity: 0; transform: translateY(-50%) scale(1) rotate(-6deg); }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { left: 78%; opacity: 0; transform: translateY(-50%) scale(0.25) rotate(8deg); }
        }
        @keyframes tallyPulse {
          0%,100% { transform: translateY(-50%) scale(1); box-shadow: 0 0 0 0 rgba(11,107,58,0.5); }
          50%     { transform: translateY(-50%) scale(1.06); box-shadow: 0 0 0 14px rgba(11,107,58,0); }
        }
        @keyframes popIn {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .fly-doc { position:absolute; top:50%; animation: flyToTally 1.3s ease-in forwards; }
        .tally-target { animation: tallyPulse 1.2s ease-in-out infinite; }
        .pop-in { animation: popIn 0.4s ease-out forwards; }
      `}</style>

      <div className="relative w-[90vw] max-w-[560px] h-[320px] rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="absolute top-0 left-0 right-0 p-4 text-center font-semibold text-gray-700 border-b bg-gray-50/80">
          {phase === "sending" ? `Sending ${label} to Tally…` : "Done"}
        </div>

        <div className="absolute inset-0 top-14">
          <div className="tally-target absolute right-[10%] top-1/2 flex flex-col items-center justify-center h-24 w-24 rounded-2xl bg-[#0b6b3a] text-white">
            <span className="text-2xl font-black leading-none">Tally</span>
            <span className="text-[10px] opacity-80 mt-1">ERP</span>
          </div>

          {phase === "sending" &&
            [0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="fly-doc flex h-12 w-9 items-center justify-center rounded-md border-2 border-[#0b6b3a]/40 bg-white shadow-md"
                style={{ animationDelay: `${i * 0.28}s` }}
              >
                <FileText className="h-5 w-5 text-[#0b6b3a]" />
              </div>
            ))}

          {phase === "synced" && (
            <div className="pop-in absolute inset-0 flex flex-col items-center justify-center">
              <CheckCircle2 className="h-16 w-16 text-emerald-600" />
              <p className="mt-3 text-lg font-bold text-gray-800">Synced to Tally</p>
              <p className="text-sm text-gray-500">Pushed successfully</p>
              <div className="mt-5">
                <Button onClick={onDone} className="bg-emerald-600 hover:bg-emerald-700">Done</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
