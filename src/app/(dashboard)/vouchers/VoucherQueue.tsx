"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, FileText } from "lucide-react";

interface QueueVoucher {
  id: string;
  voucherType: string;
  status: string;
  date: string;
  totalDebit: number;
  totalCredit: number;
  hasUnmapped: boolean;
  vendor: string | null;
  invoiceNumber: string | null;
}

const money = (n: number) => `₹${(n || 0).toLocaleString("en-IN")}`;

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-700",
  APPROVED: "bg-green-100 text-green-700",
  POSTED: "bg-blue-100 text-blue-700",
};

export default function VoucherQueue({ vouchers }: { vouchers: QueueVoucher[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () =>
      vouchers.filter(
        (v) =>
          (statusFilter === "ALL" || v.status === statusFilter) &&
          (typeFilter === "ALL" || v.voucherType === typeFilter)
      ),
    [vouchers, statusFilter, typeFilter]
  );

  const approvableSelected = filtered.filter(
    (v) => selected.has(v.id) && v.status === "DRAFT" && !v.hasUnmapped
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function bulkApprove() {
    if (approvableSelected.length === 0) return;
    setBusy(true);
    try {
      await fetch("/api/vouchers/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucherIds: approvableSelected.map((v) => v.id) }),
      });
      setSelected(new Set());
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vouchers</h1>
          <p className="text-gray-500 text-sm mt-1">Review and approve accounting vouchers</p>
        </div>
        <Button
          onClick={bulkApprove}
          disabled={approvableSelected.length === 0 || busy}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Approve selected ({approvableSelected.length})
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {["ALL", "DRAFT", "APPROVED", "POSTED"].map((s) => (
          <FilterPill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} label={s} />
        ))}
        <span className="w-px bg-gray-200 mx-1" />
        {["ALL", "PURCHASE", "SALE"].map((t) => (
          <FilterPill key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)} label={t} />
        ))}
      </div>

      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 w-8"></th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    No vouchers. Upload an invoice to generate one.
                  </td>
                </tr>
              )}
              {filtered.map((v) => (
                <tr key={v.id} className="border-b hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggle(v.id)}
                      disabled={v.status !== "DRAFT"}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/vouchers/${v.id}`} className="flex items-center gap-2 text-blue-600 hover:text-blue-800">
                      <FileText className="h-4 w-4" />
                      {v.vendor || "Unknown"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{v.invoiceNumber || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{v.voucherType}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {v.date ? new Date(v.date).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{money(v.totalDebit)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-bold ${STATUS_STYLE[v.status]}`}>
                        {v.status}
                      </span>
                      {v.hasUnmapped && v.status === "DRAFT" && (
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          Unmapped
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
        active ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
      }`}
    >
      {label}
    </button>
  );
}
