"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LedgerSelect, type LedgerOption } from "@/components/LedgerSelect";
import { TallySyncOverlay, type SyncPhase } from "@/components/TallySyncOverlay";
import { ArrowLeft, Save, Send, CheckCircle2, Landmark } from "lucide-react";

interface Txn {
  id: string;
  date: string | null;
  description: string;
  refNo: string | null;
  withdrawal: number;
  deposit: number;
  balance: number | null;
  ledgerId: string | null;
  ledgerNameSnapshot: string | null;
}

interface Statement {
  id: string;
  fileName: string;
  bankName: string | null;
  accountNumber: string | null;
  status: string;
  txns: Txn[];
}

const money = (n: number) => (n ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "");

export default function BankMapping({
  statement,
  ledgers: initialLedgers,
}: {
  statement: Statement;
  ledgers: LedgerOption[];
}) {
  const router = useRouter();
  const [ledgers, setLedgers] = useState<LedgerOption[]>(initialLedgers);
  const [txns, setTxns] = useState<Txn[]>(statement.txns);
  const [savedFlash, setSavedFlash] = useState(false);
  const [phase, setPhase] = useState<SyncPhase>(statement.status === "SYNCED" ? "synced" : "idle");

  const unmapped = txns.filter((t) => t.ledgerId === null).length;
  const totalIn = useMemo(() => txns.reduce((a, t) => a + (t.deposit || 0), 0), [txns]);
  const totalOut = useMemo(() => txns.reduce((a, t) => a + (t.withdrawal || 0), 0), [txns]);
  const locked = statement.status === "SYNCED" || phase === "synced";

  // Fire-and-forget persistence — UI never waits (prototype).
  function persistInBackground(current: Txn[], status?: string) {
    fetch(`/api/bank-statements/${statement.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txns: current.map((t) => ({ id: t.id, ledgerId: t.ledgerId })),
        ...(status ? { status } : {}),
      }),
    }).catch(() => {});
  }

  function setTxnLedger(txnId: string, ledgerId: string) {
    setTxns((prev) => {
      const next = prev.map((t) =>
        t.id === txnId
          ? { ...t, ledgerId, ledgerNameSnapshot: ledgers.find((x) => x.id === ledgerId)?.name ?? null }
          : t
      );
      persistInBackground(next);
      return next;
    });
  }

  function save() {
    setSavedFlash(true);
    persistInBackground(txns);
    window.setTimeout(() => setSavedFlash(false), 1500);
  }

  function sendToTally() {
    if (unmapped > 0) return;
    persistInBackground(txns, "SYNCED");
    setPhase("sending");
    window.setTimeout(() => setPhase("synced"), 2200);
  }

  return (
    <div className="p-6 md:p-10 space-y-6 relative min-h-screen">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push("/transactions")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Transactions
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

      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
          <Landmark className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{statement.bankName || "Bank Statement"}</h1>
          <p className="text-gray-500 text-sm">
            {statement.accountNumber ? `A/C ${statement.accountNumber} • ` : ""}
            {txns.length} transactions • In {money(totalIn)} • Out {money(totalOut)}
          </p>
        </div>
      </div>

      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-right">Withdrawal</th>
                <th className="px-3 py-2 text-right">Deposit</th>
                <th className="px-3 py-2 text-left w-[260px]">Ledger</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-b align-top hover:bg-gray-50/50">
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                    {t.date ? new Date(t.date).toLocaleDateString("en-IN") : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-800">{t.description}</div>
                    {t.refNo && <div className="text-xs text-gray-400">Ref: {t.refNo}</div>}
                  </td>
                  <td className="px-3 py-2 text-right text-red-600 font-medium whitespace-nowrap">{money(t.withdrawal)}</td>
                  <td className="px-3 py-2 text-right text-green-600 font-medium whitespace-nowrap">{money(t.deposit)}</td>
                  <td className="px-3 py-2">
                    {locked ? (
                      <span className="text-gray-800">{t.ledgerNameSnapshot || "—"}</span>
                    ) : (
                      <LedgerSelect
                        ledgers={ledgers}
                        value={t.ledgerId}
                        onChange={(id) => setTxnLedger(t.id, id)}
                        onCreated={(led) => setLedgers((prev) => [...prev, led])}
                      />
                    )}
                  </td>
                </tr>
              ))}
              {txns.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                    No transactions extracted from this statement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-3 text-xs text-gray-500 border-t">
          {unmapped > 0 ? (
            <span className="text-red-600">● {unmapped} transaction(s) need a ledger before sending</span>
          ) : (
            <span className="text-green-600">● All transactions mapped</span>
          )}
        </div>
      </div>

      <button
        onClick={sendToTally}
        disabled={unmapped > 0 || locked}
        className={`fixed bottom-6 left-6 md:left-[19.5rem] z-40 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold shadow-lg transition
          ${locked ? "bg-emerald-600 text-white cursor-default" : unmapped > 0 ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-[#0b6b3a] text-white hover:bg-[#0a5c32] hover:shadow-xl"}`}
        title={unmapped > 0 ? "Map all transactions first" : "Send to Tally"}
      >
        {locked ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
        {locked ? "Synced to Tally" : "Send to Tally"}
      </button>

      <TallySyncOverlay phase={phase} label="bank statement" onDone={() => router.push("/transactions")} />
    </div>
  );
}
