"use client";

import { AlertTriangle, CheckCircle2, HelpCircle } from "lucide-react";
import { money, type BankBalanceCheck } from "@/components/BankClient";

/**
 * The reconciliation verdict, at the top of the statement.
 *
 * It is here, above the grid, because of when it matters: a statement whose
 * rows do not add up from opening to closing balance has lost or duplicated a
 * line, and every minute spent assigning ledgers to it is wasted. Vyapar TaxOne
 * rejects the upload outright on a closing-balance mismatch
 * (`unsupported-bank-statement-formats.md`); we would rather show the accountant
 * exactly which row the arithmetic stops agreeing at and let them decide,
 * because sometimes the answer is "the bank printed it that way".
 *
 * Three states, and the third is not the second. "Reconciled" and "does not
 * reconcile" are both answers; "no opening balance, so this was never checked"
 * is the absence of one, and quietly showing a green tick for it would be a
 * lie about the strongest trust signal a bank import has.
 */
export function BankBalanceBanner({
  balance,
  onJumpToBreak,
}: {
  balance: BankBalanceCheck;
  onJumpToBreak?: (txnId: string) => void;
}) {
  if (!balance.checked) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div>
          <p className="font-medium text-slate-800">Not reconciled</p>
          <p className="text-slate-600">{balance.note}</p>
        </div>
      </div>
    );
  }

  if (balance.ok) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <p className="font-medium">Reconciled</p>
          <p className="text-emerald-800">{balance.note}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      <div className="space-y-1">
        <p className="font-semibold">This statement does not reconcile</p>
        <p className="text-red-800">{balance.note}</p>
        <p className="text-xs text-red-700">
          Opening {money(balance.openingBalance)} · rows add up to{" "}
          {money(balance.computedClosing)} · statement closes at {money(balance.closingBalance)}.
          Nothing is blocked, but check the file before mapping the rest of it.
        </p>
        {balance.firstBreakTxnId && onJumpToBreak && (
          <button
            type="button"
            onClick={() => onJumpToBreak(balance.firstBreakTxnId as string)}
            className="text-xs font-semibold underline underline-offset-2 hover:text-red-950"
          >
            Show row {balance.firstBreakRow}
          </button>
        )}
      </div>
    </div>
  );
}
