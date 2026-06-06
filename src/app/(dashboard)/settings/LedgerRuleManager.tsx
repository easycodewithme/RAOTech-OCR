"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LedgerSelect, type LedgerOption } from "@/components/LedgerSelect";
import { Plus, Trash2, Loader2 } from "lucide-react";

interface Ledger extends LedgerOption {
  group: string;
  ledgerType: string;
  isSystem?: boolean;
}
interface Rule {
  id: string;
  ruleType: string;
  pattern: string;
  priority: number;
  enabled: boolean;
  ledger: { id: string; name: string };
}

const GROUPS = [
  "SUNDRY_CREDITORS",
  "SUNDRY_DEBTORS",
  "DUTIES_AND_TAXES",
  "PURCHASE_ACCOUNTS",
  "SALES_ACCOUNTS",
  "DIRECT_EXPENSES",
  "INDIRECT_EXPENSES",
  "INDIRECT_INCOME",
  "BANK_ACCOUNTS",
  "CASH_IN_HAND",
  "CURRENT_ASSETS",
  "CURRENT_LIABILITIES",
  "FIXED_ASSETS",
];

const RULE_TYPES = [
  { value: "GSTIN_EQUALS", label: "Vendor GSTIN equals" },
  { value: "VENDOR_NAME_CONTAINS", label: "Vendor name contains" },
  { value: "VENDOR_NAME_EQUALS", label: "Vendor name equals" },
  { value: "HSN_EQUALS", label: "Item HSN equals" },
];

export default function LedgerRuleManager({
  ledgers: initialLedgers,
  rules: initialRules,
}: {
  ledgers: Ledger[];
  rules: Rule[];
}) {
  const [tab, setTab] = useState<"ledgers" | "rules">("ledgers");
  const [ledgers, setLedgers] = useState<Ledger[]>(initialLedgers);
  const [rules, setRules] = useState<Rule[]>(initialRules);

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Ledgers &amp; Rules</h1>
        <p className="text-gray-500 text-sm mt-1">Manage your chart of accounts and auto-mapping rules</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab("ledgers")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "ledgers" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}
        >
          Chart of Accounts ({ledgers.length})
        </button>
        <button
          onClick={() => setTab("rules")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === "rules" ? "bg-gray-900 text-white" : "bg-white border text-gray-600"}`}
        >
          Mapping Rules ({rules.length})
        </button>
      </div>

      {tab === "ledgers" ? (
        <LedgersTab ledgers={ledgers} setLedgers={setLedgers} />
      ) : (
        <RulesTab ledgers={ledgers} rules={rules} setRules={setRules} />
      )}
    </div>
  );
}

function LedgersTab({ ledgers, setLedgers }: { ledgers: Ledger[]; setLedgers: (l: Ledger[]) => void }) {
  const [name, setName] = useState("");
  const [group, setGroup] = useState("INDIRECT_EXPENSES");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ledgers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, group, ledgerType: "EXPENSE" }),
      });
      const data = await res.json();
      if (res.ok && data.ledger) {
        setLedgers([...ledgers, data.ledger]);
        setName("");
      }
    } finally {
      setSaving(false);
    }
  }

  const byGroup = ledgers.reduce<Record<string, Ledger[]>>((acc, l) => {
    (acc[l.group] ||= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="border rounded-xl bg-white shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-gray-500">Ledger name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Courier Charges" />
        </div>
        <div className="min-w-[180px]">
          <label className="text-xs text-gray-500">Group</label>
          <select
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {g.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={add} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add Ledger
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Object.entries(byGroup).map(([g, items]) => (
          <div key={g} className="border rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="px-4 py-2 border-b bg-gray-50/50 text-xs uppercase font-semibold text-gray-500">
              {g.replaceAll("_", " ")}
            </div>
            <div className="divide-y">
              {items.map((l) => (
                <div key={l.id} className="px-4 py-2 text-sm flex justify-between">
                  <span>{l.name}</span>
                  {l.isSystem && <span className="text-xs text-gray-400">system</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RulesTab({
  ledgers,
  rules,
  setRules,
}: {
  ledgers: Ledger[];
  rules: Rule[];
  setRules: (r: Rule[]) => void;
}) {
  const [ruleType, setRuleType] = useState("GSTIN_EQUALS");
  const [pattern, setPattern] = useState("");
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!pattern.trim() || !ledgerId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/mapping-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleType, pattern, ledgerId }),
      });
      const data = await res.json();
      if (res.ok && data.rule) {
        setRules([...rules, data.rule]);
        setPattern("");
        setLedgerId(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/mapping-rules/${id}`, { method: "DELETE" });
    if (res.ok) setRules(rules.filter((r) => r.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="border rounded-xl bg-white shadow-sm p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs text-gray-500">When</label>
            <select
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
            >
              {RULE_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Value</label>
            <Input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder={ruleType === "GSTIN_EQUALS" ? "27AABCT1234H2Z0" : "keyword / value"}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500">Map to ledger</label>
          <LedgerSelect ledgers={ledgers} value={ledgerId} onChange={setLedgerId} />
        </div>
        <Button onClick={add} disabled={saving || !pattern.trim() || !ledgerId}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add Rule
        </Button>
      </div>

      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
            <tr>
              <th className="px-4 py-3">Condition</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">Ledger</th>
              <th className="px-4 py-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-gray-400">
                  No rules yet. Rules take priority over learned mappings.
                </td>
              </tr>
            )}
            {rules.map((r) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-3">{RULE_TYPES.find((t) => t.value === r.ruleType)?.label || r.ruleType}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.pattern}</td>
                <td className="px-4 py-3">{r.ledger?.name}</td>
                <td className="px-4 py-3">
                  <button onClick={() => remove(r.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
