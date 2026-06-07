"use client";

import { useState } from "react";
import Link from "next/link";
import { FileText, Landmark, ArrowRight } from "lucide-react";

interface VoucherRow {
  id: string;
  vendor: string;
  invoiceNumber: string;
  type: string;
  amount: number;
  status: string;
  hasUnmapped: boolean;
}
interface BankRow {
  id: string;
  fileName: string;
  bankName: string | null;
  status: string;
  txnCount: number;
  unmapped: number;
  totalIn: number;
  totalOut: number;
}

const money = (n: number) => `₹${(n || 0).toLocaleString("en-IN")}`;

function StatusChip({ status, unmapped }: { status: string; unmapped: boolean }) {
  if (status === "SYNCED" || status === "APPROVED" || status === "POSTED")
    return <span className="px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">Synced</span>;
  if (unmapped)
    return <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Needs ledger</span>;
  return <span className="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">Ready</span>;
}

export default function TransactionsList({
  vouchers,
  statements,
}: {
  vouchers: VoucherRow[];
  statements: BankRow[];
}) {
  const [tab, setTab] = useState<"invoices" | "bank">("invoices");

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
        <p className="text-gray-500 text-sm mt-1">Map ledgers and send to Tally</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("invoices")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "invoices" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}
        >
          Invoices ({vouchers.length})
        </button>
        <button
          onClick={() => setTab("bank")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "bank" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}
        >
          Bank Statements ({statements.length})
        </button>
      </div>

      {tab === "invoices" ? (
        <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {vouchers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      No invoices yet. Upload to create vouchers.
                    </td>
                  </tr>
                )}
                {vouchers.map((v) => (
                  <tr key={v.id} className="border-b hover:bg-gray-50 transition group">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/vouchers/${v.id}`} className="flex items-center gap-2 text-blue-600 group-hover:text-blue-800">
                        <FileText className="h-4 w-4" /> {v.vendor}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{v.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{v.type}</td>
                    <td className="px-4 py-3 text-right font-semibold">{money(v.amount)}</td>
                    <td className="px-4 py-3"><StatusChip status={v.status} unmapped={v.hasUnmapped} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/vouchers/${v.id}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                        Map <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Bank</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3 text-center">Txns</th>
                  <th className="px-4 py-3 text-right">In / Out</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {statements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      No bank statements yet. Upload one from the Upload page.
                    </td>
                  </tr>
                )}
                {statements.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-gray-50 transition group">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/bank/${s.id}`} className="flex items-center gap-2 text-amber-700 group-hover:text-amber-900">
                        <Landmark className="h-4 w-4" /> {s.bankName || "Bank Statement"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600 truncate max-w-[160px]">{s.fileName}</td>
                    <td className="px-4 py-3 text-center text-gray-600">{s.txnCount}</td>
                    <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">
                      <span className="text-green-600">{money(s.totalIn)}</span> / <span className="text-red-600">{money(s.totalOut)}</span>
                    </td>
                    <td className="px-4 py-3"><StatusChip status={s.status} unmapped={s.unmapped > 0} /></td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/bank/${s.id}`} className="inline-flex items-center gap-1 text-amber-700 hover:underline">
                        Map <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
