"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Copy, Loader2, Plus, Trash2, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/Toast";
import {
  applyBankRules,
  cloneBankRules,
  createBankRule,
  deleteBankRule,
  fetchBankRules,
  type BankRuleCondition,
  type BankRuleField,
  type BankRuleRow,
} from "@/components/BankClient";

/**
 * The rule list, and the two things a firm actually does with it: run it over
 * this statement, and copy it onto the next client.
 *
 * It is a separate panel from the ledger column on purpose. What the app
 * *learned* from past narrations is invisible and per-row — it arrives as a
 * pre-filled ledger with a confidence. What the firm *decided* is this list:
 * ordered, readable top to bottom, and deletable. A partner signing off on a
 * client's books can be shown this; they cannot be shown a classifier.
 *
 * Every rule names its target ledger by name rather than pointing at a row,
 * which is what makes Clone possible at all — the same list means the same
 * thing in a workspace whose ledger ids are all different.
 */

const FIELD_OPTIONS: { value: BankRuleField; label: string }[] = [
  { value: "narration", label: "Narration" },
  { value: "amount", label: "Amount" },
  { value: "type", label: "Type" },
];

const CONDITIONS: Record<BankRuleField, { value: BankRuleCondition; label: string }[]> = {
  narration: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "is exactly" },
  ],
  amount: [
    { value: "gt", label: "is more than" },
    { value: "lt", label: "is less than" },
    { value: "equals", label: "is exactly" },
  ],
  type: [{ value: "equals", label: "is" }],
};

const CONDITION_LABEL: Record<BankRuleCondition, string> = {
  contains: "contains",
  equals: "is",
  gt: ">",
  lt: "<",
};

interface ClientOption {
  id: string;
  name: string;
}

export function BankRulePanel({
  statementId,
  onApplied,
  onClose,
}: {
  statementId: string;
  /** Rules wrote ledgers onto rows; the grid has to re-read them. */
  onApplied: () => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [rules, setRules] = useState<BankRuleRow[]>([]);
  const [durable, setDurable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [field, setField] = useState<BankRuleField>("narration");
  const [condition, setCondition] = useState<BankRuleCondition>("contains");
  const [value, setValue] = useState("");
  const [ledgerName, setLedgerName] = useState("");

  const [preview, setPreview] = useState<{ count: number; unresolved: string[] } | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [cloneTarget, setCloneTarget] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchBankRules();
      setRules(data.rules);
      setDurable(data.durable);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not load the rule list", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // Rules live on the server and change without us; reading them on mount is
    // a subscription, not a render-time computation.
    void load();
  }, [load]);

  useEffect(() => {
    let alive = true;
    fetch("/api/clients", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { clients?: ClientOption[]; activeClientId?: string }) => {
        if (!alive) return;
        setClients((body.clients ?? []).filter((c) => c.id !== body.activeClientId));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function add() {
    if (!value.trim() || !ledgerName.trim()) return;
    setBusy(true);
    try {
      const res = await createBankRule({ field, condition, value, ledgerName });
      setRules((prev) => [...prev, res.rule]);
      setValue("");
      setLedgerName("");
      if (res.warning) toast(res.warning, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add the rule", "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(ruleId: string) {
    setRules((prev) => prev.filter((r) => r.id !== ruleId));
    await deleteBankRule(ruleId).catch(() => void load());
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    try {
      const res = await applyBankRules(statementId, { dryRun });
      if (dryRun) {
        setPreview({ count: res.wouldApply ?? 0, unresolved: res.unresolved });
      } else {
        setPreview(null);
        toast(`${res.applied} row(s) mapped by rules. They are unsaved — check them, then Save.`, "success");
        if (res.warning) toast(res.warning, "info");
        onApplied();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not run the rules", "error");
    } finally {
      setBusy(false);
    }
  }

  async function clone(dryRun: boolean) {
    if (!cloneTarget) return;
    setBusy(true);
    try {
      const res = await cloneBankRules(cloneTarget, dryRun);
      if (dryRun) {
        toast(
          res.unresolved.length
            ? `${res.target} is missing ${res.unresolved.length} ledger(s): ${res.unresolved.join(", ")}. Clone anyway to put the rules in place.`
            : `Every ledger these rules name already exists in ${res.target}.`,
          res.unresolved.length ? "info" : "success"
        );
      } else {
        toast(`${res.cloned} rule(s) copied to ${res.target}.`, "success");
        if (res.warning) toast(res.warning, "info");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not clone the rules", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[8vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-xl border bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b bg-slate-50 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Ledger rules</h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Explicit and ordered — the first rule that matches a row wins. Separate from the
              narration suggestions the app learns on its own.
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

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4">
          {!durable && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p>
                Rules are held in the server&apos;s memory for now, not the database — they survive
                page reloads but not a restart. The schema has no column that can hold a rule
                keyed on a ledger <em>name</em>, and adding one is outside this change.
              </p>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Then use ledger</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                      <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                    </td>
                  </tr>
                )}
                {!loading && rules.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-sm text-slate-400">
                      No rules yet. A first one worth writing: narration contains &ldquo;BANK
                      CHARGES&rdquo; &rarr; Bank Charges.
                    </td>
                  </tr>
                )}
                {rules.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-3 py-2 text-slate-700">
                      <span className="capitalize">{r.field}</span>{" "}
                      <span className="text-slate-400">{CONDITION_LABEL[r.condition]}</span>{" "}
                      <span className="font-medium">{r.value}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={r.ledgerId ? "text-slate-800" : "text-red-600"}>
                        {r.ledgerName}
                      </span>
                      {!r.ledgerId && (
                        <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                          no such ledger here
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label="Delete rule"
                        onClick={() => void remove(r.id)}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 p-3">
            <select
              value={field}
              onChange={(e) => {
                const next = e.target.value as BankRuleField;
                setField(next);
                setCondition(CONDITIONS[next][0].value);
              }}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {FIELD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as BankRuleCondition)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {CONDITIONS[field].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {field === "type" ? (
              <select
                value={value || "PAYMENT"}
                onChange={(e) => setValue(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="PAYMENT">Payment</option>
                <option value="RECEIPT">Receipt</option>
                <option value="CONTRA">Contra</option>
              </select>
            ) : (
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={field === "amount" ? "5000" : "BANK CHARGES"}
                className="w-40 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
              />
            )}
            <span className="text-sm text-slate-500">&rarr;</span>
            <input
              value={ledgerName}
              onChange={(e) => setLedgerName(e.target.value)}
              placeholder="Ledger name"
              className="w-52 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
            />
            <Button size="sm" disabled={busy || !value.trim() || !ledgerName.trim()} onClick={add}>
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={busy || !rules.length} onClick={() => run(true)}>
              <Sparkles className="mr-1 h-4 w-4" /> Preview on this statement
            </Button>
            {preview && (
              <>
                <span className="text-sm text-slate-700">
                  {preview.count} blank row(s) would be mapped.
                </span>
                <Button size="sm" disabled={busy || preview.count === 0} onClick={() => run(false)}>
                  Apply to {preview.count} row(s)
                </Button>
              </>
            )}
          </div>
          {preview?.unresolved.length ? (
            <p className="text-xs text-amber-700">
              Rules pointing at {preview.unresolved.join(", ")} will not fire — this workspace has
              no ledger by that name.
            </p>
          ) : null}

          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium text-slate-800">Clone this list to another client</p>
            <p className="text-xs text-slate-600">
              Rules store a ledger <em>name</em>, so the same list works in any workspace that has
              ledgers by those names. Preview first — it reports which are missing there.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={cloneTarget}
                onChange={(e) => setCloneTarget(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
              >
                <option value="">Choose a workspace…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !cloneTarget || !rules.length}
                onClick={() => clone(true)}
              >
                Check
              </Button>
              <Button
                size="sm"
                disabled={busy || !cloneTarget || !rules.length}
                onClick={() => clone(false)}
              >
                <Copy className="mr-1 h-4 w-4" /> Clone {rules.length} rule(s)
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
