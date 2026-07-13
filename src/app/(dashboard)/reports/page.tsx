import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";

export default async function ReportsPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;

  const vouchers = await prisma.voucher.findMany({
    where: { userId: user.id, clientId: client.id },
    include: {
      invoice: true,
      lines: { include: { ledger: true } },
    },
  });

  const purchases = vouchers.filter((v) => v.voucherType === "PURCHASE" || v.voucherType === "DEBIT_NOTE");
  const sales = vouchers.filter((v) => v.voucherType === "SALE" || v.voucherType === "CREDIT_NOTE");

  const purchaseRegister = purchases.map((v) => ({
    date: v.date,
    vendor: v.invoice?.vendor,
    gstin: v.invoice?.vendorGstin,
    invoiceNumber: v.invoice?.invoiceNumber,
    taxable: v.invoice?.subtotal || 0,
    cgst: v.invoice?.cgst || 0,
    sgst: v.invoice?.sgst || 0,
    igst: v.invoice?.igst || 0,
    total: v.invoice?.totalAmount || v.totalDebit,
  }));

  const gstr1Like = sales.map((v) => ({
    date: v.date,
    customer: v.invoice?.customerName || v.invoice?.vendor,
    gstin: v.invoice?.customerGstin || v.invoice?.vendorGstin,
    invoiceNumber: v.invoice?.invoiceNumber,
    taxable: v.invoice?.subtotal || 0,
    cgst: v.invoice?.cgst || 0,
    sgst: v.invoice?.sgst || 0,
    igst: v.invoice?.igst || 0,
    total: v.invoice?.totalAmount || v.totalDebit,
  }));

  // Simple party outstanding: sum of purchase party credits - (no payments yet => full outstanding)
  const partyMap: Record<string, { name: string; amount: number }> = {};
  for (const v of purchases) {
    const party = v.lines.find((l) => l.role === "PARTY");
    const name = party?.ledgerNameSnapshot || v.invoice?.vendor || "Unknown";
    if (!partyMap[name]) partyMap[name] = { name, amount: 0 };
    partyMap[name].amount += party?.credit || v.totalCredit || 0;
  }
  const parties = Object.values(partyMap).sort((a, b) => b.amount - a.amount);

  // P&L sketch: sales income - purchase expense
  const income = sales.reduce((s, v) => s + (v.invoice?.subtotal || 0), 0);
  const expense = purchases.reduce((s, v) => s + (v.invoice?.subtotal || 0), 0);
  const taxInput = purchases.reduce((s, v) => s + (v.invoice?.taxAmount || 0), 0);
  const taxOutput = sales.reduce((s, v) => s + (v.invoice?.taxAmount || 0), 0);

  // Balance sheet sketch
  const assets = taxInput; // ITC asset
  const liabilities = parties.reduce((s, p) => s + p.amount, 0) + taxOutput;
  const equity = income - expense;

  return (
    <div className="p-6 md:p-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
        <p className="text-gray-500 text-sm mt-1">{client.name} · prototype pack</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card label="Sales (taxable)" value={income} />
        <Card label="Purchases (taxable)" value={expense} />
        <Card label="GST Output" value={taxOutput} />
        <Card label="GST Input / ITC" value={taxInput} />
      </div>

      <Section title="GSTR-1 style (outward)">
        <SimpleTable
          rows={gstr1Like}
          cols={[
            ["Date", (r) => new Date(r.date).toLocaleDateString("en-IN")],
            ["Customer", (r) => r.customer || "—"],
            ["GSTIN", (r) => r.gstin || "—"],
            ["Invoice", (r) => r.invoiceNumber || "—"],
            ["Taxable", (r) => money(r.taxable)],
            ["Tax", (r) => money(r.cgst + r.sgst + r.igst)],
            ["Total", (r) => money(r.total)],
          ]}
        />
      </Section>

      <Section title="Purchase register">
        <SimpleTable
          rows={purchaseRegister}
          cols={[
            ["Date", (r) => new Date(r.date).toLocaleDateString("en-IN")],
            ["Vendor", (r) => r.vendor || "—"],
            ["GSTIN", (r) => r.gstin || "—"],
            ["Invoice", (r) => r.invoiceNumber || "—"],
            ["Taxable", (r) => money(r.taxable)],
            ["Tax", (r) => money(r.cgst + r.sgst + r.igst)],
            ["Total", (r) => money(r.total)],
          ]}
        />
      </Section>

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Party outstanding (creditors)">
          <SimpleTable
            rows={parties.slice(0, 20)}
            cols={[
              ["Party", (r) => r.name],
              ["Outstanding", (r) => money(r.amount)],
            ]}
          />
        </Section>
        <Section title="P&L + Balance sheet (sketch)">
          <div className="p-4 space-y-2 text-sm">
            <Row k="Income (sales taxable)" v={money(income)} />
            <Row k="Expenses (purchase taxable)" v={money(expense)} />
            <Row k="Gross profit (sketch)" v={money(income - expense)} bold />
            <hr />
            <Row k="Assets (ITC)" v={money(assets)} />
            <Row k="Liabilities (creditors + output tax)" v={money(liabilities)} />
            <Row k="Equity / retained (sketch)" v={money(equity)} bold />
          </div>
        </Section>
      </div>
    </div>
  );
}

function money(n: number) {
  return `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className="text-xl font-bold mt-1">{money(value)}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50/50 font-semibold">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-600">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function SimpleTable<T>({
  rows,
  cols,
}: {
  rows: T[];
  cols: Array<[string, (r: T) => string]>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-gray-500 bg-gray-50">
          <tr>
            {cols.map(([h]) => (
              <th key={h} className="px-3 py-2 text-left">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols.length} className="px-3 py-8 text-center text-gray-400">
                No data
              </td>
            </tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {cols.map(([h, fn]) => (
                <td key={h} className="px-3 py-2">
                  {fn(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
