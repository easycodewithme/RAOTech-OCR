"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, X, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LedgerSelect, type LedgerOption } from "@/components/LedgerSelect";
import { money, rowAmount, type BankTxnRow } from "@/components/BankClient";

/**
 * One statement line across several ledgers.
 *
 * The rule this screen exists to enforce: the legs must total the transaction
 * exactly. `buildBankVoucher` refuses anything else, and refuses it for a
 * reason worth repeating — Tally would happily accept a voucher we balanced
 * with a round-off plug, and the books would then be wrong by whatever the user
 * failed to allocate, silently, under a ledger nobody chose. So the running
 * total is live and Apply stays disabled until it matches, rather than the
 * mismatch being discovered at push time.
 *
 * Ledger creation from inside here is deliberate: the reason a line needs
 * splitting is usually a payment that covered a bill plus a charge nobody has a
 * ledger for yet, and sending the user to another screen loses the split.
 */

const EPSILON = 0.005;

export interface SplitLeg {
  key: string;
  ledgerId: string | null;
  /** Kept as text so a half-typed "12." does not become 12 under the cursor. */
  amount: string;
}

let legSeq = 0;
const newLeg = (ledgerId: string | null = null, amount = ""): SplitLeg => ({
  key: `leg-${++legSeq}`,
  ledgerId,
  amount,
});

export function BankSplitEditor({
  txn,
  ledgers,
  onLedgerCreated,
  onApply,
  onClose,
  busy = false,
}: {
  txn: BankTxnRow;
  ledgers: LedgerOption[];
  onLedgerCreated: (ledger: LedgerOption) => void;
  onApply: (allocations: { ledgerId: string; amount: number }[]) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const total = rowAmount(txn);

  const [legs, setLegs] = useState<SplitLeg[]>(() => {
    if (txn.allocations.length) {
      return txn.allocations.map((a) => newLeg(a.ledgerId, a.amount.toFixed(2)));
    }
    // Seed with the row's current ledger taking the whole amount, then an empty
    // second leg — the split someone is about to make is almost always "this,
    // minus a bit".
    return [newLeg(txn.ledgerId, total ? total.toFixed(2) : ""), newLeg()];
  });

  const allocated = useMemo(
    () => legs.reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
    [legs]
  );
  const difference = total - allocated;
  const matches = Math.abs(difference) <= EPSILON;
  const everyLegNamed = legs.every((l) => !Number(l.amount) || !!l.ledgerId);
  const hasLiveLegs = legs.some((l) => (Number(l.amount) || 0) > EPSILON && !!l.ledgerId);
  const canApply = matches && everyLegNamed && hasLiveLegs && !busy;

  function update(key: string, patch: Partial<SplitLeg>) {
    setLegs((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /**
   * "Difference amount will be auto fill" — the one convenience worth copying
   * from the competitor's bank-allocation editor. Splitting 50,000 into
   * 42,372.88 taxable and the GST balance by hand is where paise get lost.
   */
  function fillRemainder(key: string) {
    const others = legs
      .filter((l) => l.key !== key)
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const remainder = Math.max(0, total - others);
    update(key, { amount: remainder.toFixed(2) });
  }

  function apply() {
    const allocations = legs
      .filter((l) => l.ledgerId && (Number(l.amount) || 0) > EPSILON)
      .map((l) => ({ ledgerId: l.ledgerId as string, amount: Number(l.amount) }));
    onApply(allocations);
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b bg-slate-50 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Split this transaction</h2>
            <p className="mt-0.5 max-w-lg truncate text-xs text-slate-600">
              {txn.description}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-slate-600">
              {txn.withdrawal > 0 ? "Withdrawal" : "Deposit"}
            </span>
            <span className="font-semibold text-slate-900">{money(total)}</span>
          </div>

          <div className="space-y-2">
            {legs.map((leg) => (
              <div key={leg.key} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <LedgerSelect
                    ledgers={ledgers}
                    value={leg.ledgerId}
                    onChange={(id) => update(leg.key, { ledgerId: id })}
                    onCreated={(created) => {
                      onLedgerCreated(created);
                      update(leg.key, { ledgerId: created.id });
                    }}
                  />
                </div>
                <input
                  inputMode="decimal"
                  value={leg.amount}
                  onChange={(e) =>
                    update(leg.key, { amount: e.target.value.replace(/[^0-9.]/g, "") })
                  }
                  placeholder="0.00"
                  className="w-32 rounded-md border border-gray-300 px-3 py-2 text-right text-sm outline-none focus:ring-1 focus:ring-blue-400"
                />
                <button
                  type="button"
                  title="Fill with the remaining amount"
                  onClick={() => fillRemainder(leg.key)}
                  className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Wand2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Remove this line"
                  disabled={legs.length <= 1}
                  onClick={() => setLegs((prev) => prev.filter((l) => l.key !== leg.key))}
                  className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setLegs((prev) => [...prev, newLeg()])}
            className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" /> Add a ledger
          </button>

          <div
            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
              matches
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            <span>Allocated {money(allocated)}</span>
            <span className="font-semibold">
              {matches
                ? "Matches the transaction"
                : `${money(Math.abs(difference))} ${difference > 0 ? "left to allocate" : "over-allocated"}`}
            </span>
          </div>

          {!everyLegNamed && (
            <p className="text-xs text-amber-700">
              Every line with an amount needs a ledger.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-4 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canApply} onClick={apply}>
            Apply split
          </Button>
        </div>
      </div>
    </div>
  );
}
