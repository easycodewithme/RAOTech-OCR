"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LedgerSelect, type LedgerOption } from "@/components/LedgerSelect";
import { TallySyncOverlay, type SyncPhase } from "@/components/TallySyncOverlay";
import { ArrowLeft, Save, Loader2, AlertTriangle, Send, CheckCircle2 } from "lucide-react";

interface Line {
  id: string;
  ledgerId: string | null;
  ledgerNameSnapshot: string | null;
  role: string;
  debit: number;
  credit: number;
  confidence: number | null;
  mappedVia: string | null;
  hsnCode: string | null;
  gstRate: number | null;
  sortOrder: number;
}

interface Voucher {
  id: string;
  voucherType: string;
  status: string;
  date: string;
  narration: string | null;
  totalDebit: number;
  totalCredit: number;
  roundOff: number;
  lines: Line[];
  invoice: any;
}

const money = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

function ConfidenceChip({ line }: { line: Line }) {
  if (!line.ledgerId)
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Needs ledger</span>;
  const c = line.confidence ?? 0;
  if (line.mappedVia === "MANUAL")
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Manual</span>;
  if (c >= 0.9)
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">High</span>;
  if (c >= 0.6)
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">Review</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700">Low</span>;
}

const EDITABLE_ROLES = new Set(["PARTY", "ITEM"]);

export default function VoucherReview({
  voucher: initial,
  ledgers: initialLedgers,
}: {
  voucher: Voucher;
  ledgers: LedgerOption[];
}) {
  const router = useRouter();
  const [ledgers, setLedgers] = useState<LedgerOption[]>(initialLedgers);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [voucherType, setVoucherType] = useState(initial.voucherType);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");

  const inv = initial.invoice || {};
  const hasUnmapped = lines.some((l) => l.ledgerId === null);
  const totalDebit = useMemo(() => lines.reduce((s, l) => s + l.debit, 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((s, l) => s + l.credit, 0), [lines]);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const locked = phase === "synced";

  function setLineLedger(lineId: string, ledgerId: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? { ...l, ledgerId, ledgerNameSnapshot: ledgers.find((x) => x.id === ledgerId)?.name ?? null, mappedVia: "MANUAL", confidence: 1 }
          : l
      )
    );
  }

  // Fire-and-forget persistence — never blocks the UI (prototype: feel instant).
  function persistLinesInBackground(current: Line[] = lines) {
    fetch(`/api/vouchers/${initial.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lines: current.map((l) => ({ id: l.id, ledgerId: l.ledgerId })) }),
    }).catch(() => {});
  }

  async function changeType(next: string) {
    if (next === voucherType || locked) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vouchers/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherType: next }),
      });
      const data = await res.json();
      if (res.ok && data.voucher) {
        setVoucherType(data.voucher.voucherType);
        setLines(data.voucher.lines);
      } else setError(data.error || "Failed to change type");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    // Optimistic: show saved instantly, persist in the background.
    setError(null);
    setSavedFlash(true);
    persistLinesInBackground();
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  // Frontend-only Tally sync: start the animation immediately and persist the
  // mapping in the background (so memory still learns). No blocking, no delay.
  function sendToTally() {
    if (hasUnmapped || !balanced) return;
    setError(null);
    persistLinesInBackground(); // background — does not delay the animation
    setPhase("sending");
    window.setTimeout(() => setPhase("synced"), 2200);
  }

  return (
    <div className="p-6 md:p-10 space-y-6 relative min-h-screen">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Dashboard
        </Button>
        <div className="flex items-center gap-3">
          {locked && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> Synced to Tally
            </span>
          )}
          <Button variant="outline" onClick={save} disabled={locked}>
            {savedFlash ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-600" /> : <Save className="mr-2 h-4 w-4" />}
            {savedFlash ? "Saved" : "Save mapping"}
          </Button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ledger Mapping</h1>
        <p className="text-gray-500 text-sm mt-1">
          Assign a ledger to every line, then send the voucher to Tally.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left — extracted document fields */}
        <div className="border rounded-xl bg-white shadow-sm">
          <div className="p-4 border-b bg-gray-50/50 font-semibold">Extracted Invoice</div>
          <div className="p-4 space-y-2 text-sm">
            <Field label="Vendor" value={inv.vendor} />
            <Field label="Vendor GSTIN" value={inv.vendorGstin} />
            <Field label="Invoice No." value={inv.invoiceNumber} />
            <Field label="Date" value={inv.date ? new Date(inv.date).toLocaleDateString("en-IN") : null} />
            <Field label="Subtotal" value={inv.subtotal != null ? money(inv.subtotal) : null} />
            <Field label="CGST" value={inv.cgst != null ? money(inv.cgst) : null} />
            <Field label="SGST" value={inv.sgst != null ? money(inv.sgst) : null} />
            <Field label="IGST" value={inv.igst != null ? money(inv.igst) : null} />
            <Field label="Total" value={inv.totalAmount != null ? money(inv.totalAmount) : null} />
          </div>
          {Array.isArray(inv.items) && inv.items.length > 0 && (
            <div className="p-4 border-t">
              <p className="text-xs uppercase text-gray-400 mb-2">Line items</p>
              <div className="space-y-1 text-sm">
                {inv.items.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span className="truncate text-gray-700">{it.name}</span>
                    <span className="text-gray-500">{money(Number(it.price) || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — voucher */}
        <div className="border rounded-xl bg-white shadow-sm">
          <div className="p-4 border-b bg-gray-50/50 flex items-center justify-between">
            <span className="font-semibold">Voucher</span>
            <div className="flex rounded-lg border overflow-hidden text-sm">
              {["PURCHASE", "SALE"].map((t) => (
                <button
                  key={t}
                  onClick={() => changeType(t)}
                  disabled={saving || locked}
                  className={`px-3 py-1.5 ${voucherType === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
                <tr>
                  <th className="px-3 py-2 text-left">Ledger</th>
                  <th className="px-3 py-2 text-right">Debit</th>
                  <th className="px-3 py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-b align-top">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-400 w-14">{l.role}</span>
                        <ConfidenceChip line={l} />
                      </div>
                      {EDITABLE_ROLES.has(l.role) && !locked ? (
                        <LedgerSelect
                          ledgers={ledgers}
                          value={l.ledgerId}
                          onChange={(id) => setLineLedger(l.id, id)}
                          onCreated={(led) => setLedgers((prev) => [...prev, led])}
                        />
                      ) : (
                        <span className="text-gray-800">{l.ledgerNameSnapshot || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{l.debit ? money(l.debit) : ""}</td>
                    <td className="px-3 py-2 text-right font-medium">{l.credit ? money(l.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold bg-gray-50">
                  <td className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right">{money(totalDebit)}</td>
                  <td className="px-3 py-2 text-right">{money(totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="p-3 text-xs text-gray-500 border-t">
            {balanced ? (
              <span className="text-green-600">● Balanced</span>
            ) : (
              <span className="text-red-600">● Not balanced — difference {money(Math.abs(totalDebit - totalCredit))}</span>
            )}
            {hasUnmapped && <span className="ml-3 text-red-600">● Assign all ledgers to send</span>}
          </div>
        </div>
      </div>

      {/* Bottom-left Send to Tally button */}
      <button
        onClick={sendToTally}
        disabled={hasUnmapped || !balanced || saving || locked}
        className={`fixed bottom-6 left-6 md:left-[19.5rem] z-40 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition
          ${locked
            ? "bg-emerald-600 text-white cursor-default"
            : hasUnmapped || !balanced
            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
            : "bg-[#0b6b3a] text-white hover:bg-[#0a5c32] hover:shadow-xl"}`}
        title={hasUnmapped ? "Map all ledgers first" : "Send this voucher to Tally"}
      >
        {locked ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {locked ? "Synced to Tally" : "Send to Tally"}
      </button>

      {phase !== "idle" && <TallySyncOverlay phase={phase} onDone={() => router.push("/dashboard")} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-900 text-right truncate">{value || "—"}</span>
    </div>
  );
}
