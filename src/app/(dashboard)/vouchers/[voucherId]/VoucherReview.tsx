"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LedgerSelect, type LedgerOption } from "@/components/LedgerSelect";
import { ArrowLeft, Save, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";

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
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inv = initial.invoice || {};
  const hasUnmapped = lines.some((l) => l.ledgerId === null);
  const totalDebit = useMemo(() => lines.reduce((s, l) => s + l.debit, 0), [lines]);
  const totalCredit = useMemo(() => lines.reduce((s, l) => s + l.credit, 0), [lines]);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  function setLineLedger(lineId: string, ledgerId: string) {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId
          ? { ...l, ledgerId, ledgerNameSnapshot: ledgers.find((x) => x.id === ledgerId)?.name ?? null, mappedVia: "MANUAL", confidence: 1 }
          : l
      )
    );
  }

  async function changeType(next: string) {
    if (next === voucherType) return;
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

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/vouchers/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: lines.map((l) => ({ id: l.id, ledgerId: l.ledgerId })) }),
      });
      const data = await res.json();
      if (res.ok && data.voucher) {
        setLines(data.voucher.lines);
      } else setError(data.error || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      // Persist any pending remaps first
      await fetch(`/api/vouchers/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: lines.map((l) => ({ id: l.id, ledgerId: l.ledgerId })) }),
      });
      const res = await fetch(`/api/vouchers/${initial.id}/approve`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        router.push("/vouchers");
        router.refresh();
      } else {
        setError(data.error || "Failed to approve");
      }
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push("/vouchers")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to queue
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={save} disabled={saving || approving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save
          </Button>
          <Button
            onClick={approve}
            disabled={hasUnmapped || !balanced || approving || saving || initial.status !== "DRAFT"}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
            Approve
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}
      {initial.status !== "DRAFT" && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
          This voucher is <strong>{initial.status}</strong> and is read-only.
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
                  disabled={saving || initial.status !== "DRAFT"}
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
                      {EDITABLE_ROLES.has(l.role) && initial.status === "DRAFT" ? (
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
            {hasUnmapped && <span className="ml-3 text-red-600">● Assign all ledgers to approve</span>}
          </div>
        </div>
      </div>
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
