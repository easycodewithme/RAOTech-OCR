"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LedgerSelect, type LedgerOption, type LedgerSelectHandle } from "@/components/LedgerSelect";
import { TallySyncOverlay, type SyncPhase } from "@/components/TallySyncOverlay";
import { useToast } from "@/components/Toast";
import { ArrowLeft, Save, AlertTriangle, Send, CheckCircle2, Download } from "lucide-react";

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
const TYPES = ["PURCHASE", "SALE", "CREDIT_NOTE", "DEBIT_NOTE"];

export default function VoucherReview({
  voucher: initial,
  ledgers: initialLedgers,
  prevId,
  nextId,
}: {
  voucher: Voucher;
  ledgers: LedgerOption[];
  prevId?: string | null;
  nextId?: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [ledgers, setLedgers] = useState<LedgerOption[]>(initialLedgers);
  const [lines, setLines] = useState<Line[]>(initial.lines);
  const [voucherType, setVoucherType] = useState(initial.voucherType);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SyncPhase>(
    initial.status === "EXPORTED_DEMO" || initial.status === "APPROVED" ? "synced" : "idle"
  );
  const [status, setStatus] = useState(initial.status);
  const firstUnmappedRef = useRef<LedgerSelectHandle | null>(null);

  const inv = initial.invoice || {};
  const hasUnmapped = lines.some((l) => l.ledgerId === null);
  const totalDebit = useMemo(() => lines.reduce((s, l) => s + l.debit, 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((s, l) => s + l.credit, 0), [lines]);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const locked = status === "EXPORTED_DEMO" || phase === "synced";

  function setLineLedger(lineId: string, ledgerId: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? {
              ...l,
              ledgerId,
              ledgerNameSnapshot: ledgers.find((x) => x.id === ledgerId)?.name ?? null,
              mappedVia: "MANUAL",
              confidence: 1,
            }
          : l
      )
    );
  }

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
    setError(null);
    setSavedFlash(true);
    persistLinesInBackground();
    toast("Mapping saved", "success");
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  async function approveAndExport() {
    if (hasUnmapped || !balanced) return;
    setError(null);
    persistLinesInBackground();

    // Approve first
    const approveRes = await fetch(`/api/vouchers/${initial.id}/approve`, { method: "POST" });
    if (!approveRes.ok) {
      const data = await approveRes.json().catch(() => ({}));
      setError(data.error || "Approve failed");
      toast(data.error || "Approve failed", "error");
      return;
    }
    setStatus("APPROVED");
    toast("Approved — exporting Tally XML…", "success");

    // Demo animation + real XML export
    setPhase("sending");
    window.setTimeout(async () => {
      try {
        const res = await fetch("/api/export/tally", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voucherIds: [initial.id] }),
        });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `tally_${initial.id.slice(0, 8)}.xml`;
          a.click();
          URL.revokeObjectURL(url);
          setStatus("EXPORTED_DEMO");
        }
      } catch {
        /* still show synced demo */
      }
      setPhase("synced");
    }, 1800);
  }

  // Keyboard shortcuts: A approve, J/K nav, E edit first unmapped, S save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)
        return;
      const key = e.key.toLowerCase();
      if (key === "a" && !locked) {
        e.preventDefault();
        approveAndExport();
      } else if (key === "s") {
        e.preventDefault();
        save();
      } else if (key === "e" && !locked) {
        e.preventDefault();
        firstUnmappedRef.current?.focusOpen();
      } else if (key === "j" && nextId) {
        e.preventDefault();
        router.push(`/vouchers/${nextId}`);
      } else if (key === "k" && prevId) {
        e.preventDefault();
        router.push(`/vouchers/${prevId}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, hasUnmapped, balanced, nextId, prevId, lines]);

  return (
    <div className="p-6 md:p-10 space-y-6 relative min-h-screen">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push("/transactions")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Transactions
        </Button>
        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-xs text-gray-400">Shortcuts: A approve · E edit · J/K next/prev · S save</span>
          {locked && (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> {status === "EXPORTED_DEMO" ? "Exported XML" : "Synced"}
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
          Assign ledgers, approve, then download Tally XML.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {inv.isDuplicate && (
        <div className="rounded-lg bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
          Possible duplicate invoice detected (same number + vendor + amount).
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border rounded-xl bg-white shadow-sm lg:sticky lg:top-20 self-start">
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
            {inv.irn && <Field label="IRN" value={inv.irn} />}
            {inv.ewayBillNo && <Field label="E-way Bill" value={inv.ewayBillNo} />}
          </div>
          {Array.isArray(inv.validationFlags) && inv.validationFlags.length > 0 && (
            <div className="p-4 border-t space-y-1">
              <p className="text-xs uppercase text-gray-400 mb-2">Validations</p>
              {inv.validationFlags.slice(0, 8).map((issue: any, i: number) => (
                <div
                  key={i}
                  className={`text-xs rounded px-2 py-1 ${
                    issue.severity === "error"
                      ? "bg-red-50 text-red-700"
                      : issue.severity === "warning"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-50 text-slate-600"
                  }`}
                >
                  {issue.message}
                </div>
              ))}
            </div>
          )}
          {Array.isArray(inv.items) && inv.items.length > 0 && (
            <div className="p-4 border-t">
              <p className="text-xs uppercase text-gray-400 mb-2">Line items</p>
              <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
                {inv.items.map((it: any, i: number) => (
                  <div key={i} className="flex justify-between gap-2">
                    <span className="truncate text-gray-700">{it.name}</span>
                    <span className="text-gray-500 shrink-0">{money(Number(it.price) || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border rounded-xl bg-white shadow-sm">
          <div className="p-4 border-b bg-gray-50/50 flex items-center justify-between gap-2 flex-wrap">
            <span className="font-semibold">Voucher</span>
            <div className="flex rounded-lg border overflow-hidden text-xs">
              {TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => changeType(t)}
                  disabled={saving || locked}
                  className={`px-2 py-1.5 ${voucherType === t ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
                >
                  {t.replace("_", " ")}
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
                {(() => {
                  let assignedUnmappedRef = false;
                  return lines.map((l) => {
                    const isFirstUnmapped =
                      !assignedUnmappedRef &&
                      EDITABLE_ROLES.has(l.role) &&
                      !l.ledgerId &&
                      !locked;
                    if (isFirstUnmapped) assignedUnmappedRef = true;
                    return (
                  <tr key={l.id} className="border-b align-top">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-gray-400 w-14">{l.role}</span>
                        <ConfidenceChip line={l} />
                      </div>
                      {EDITABLE_ROLES.has(l.role) && !locked ? (
                        <LedgerSelect
                          ref={isFirstUnmapped ? firstUnmappedRef : undefined}
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
                    );
                  });
                })()}
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

      <button
        onClick={approveAndExport}
        disabled={hasUnmapped || !balanced || saving || locked}
        className={`fixed bottom-6 left-6 md:left-[19.5rem] z-40 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition
          ${
            locked
              ? "bg-emerald-600 text-white cursor-default"
              : hasUnmapped || !balanced
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-[#0b6b3a] text-white hover:bg-[#0a5c32] hover:shadow-xl"
          }`}
      >
        {locked ? <Download className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {locked ? "Exported to Tally XML" : "Approve & Export Tally XML"}
      </button>

      {phase !== "idle" && (
        <TallySyncOverlay
          phase={phase}
          onDone={() => router.push("/transactions")}
          label="voucher XML"
        />
      )}
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
