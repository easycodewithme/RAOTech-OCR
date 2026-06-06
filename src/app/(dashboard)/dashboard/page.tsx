import { currentUser } from "@clerk/nextjs/server";
import {
  FileText,
  Plus,
  IndianRupee,
  Building2,
  Download,
  ClipboardList,
  ClipboardCheck,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";

export default async function Dashboard() {
  const clerk = await currentUser();
  if (!clerk) return redirect("/sign-in");

  let dbUser;
  try {
    dbUser = await getDbUser();
  } catch (error: any) {
    console.error("[DASHBOARD_DB_ERROR]", error?.message || error);
    return (
      <div className="p-10 text-center">
        <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
        <p className="text-gray-500">Unable to connect to database. Please try again in a moment.</p>
        <p className="text-xs text-red-400 mt-2">{error?.message || "Unknown error"}</p>
      </div>
    );
  }
  if (!dbUser) return redirect("/sign-in");

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({ where: { userId: dbUser.id }, orderBy: { createdAt: "desc" } }),
    prisma.voucher.findMany({
      where: { userId: dbUser.id, clientId: "" },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { vendor: true, invoiceNumber: true, taxAmount: true } },
        lines: { select: { ledgerId: true } },
      },
    }),
  ]);

  const drafts = vouchers.filter((v) => v.status === "DRAFT");
  const approved = vouchers.filter((v) => v.status === "APPROVED");
  const gstInput = vouchers
    .filter((v) => v.voucherType === "PURCHASE")
    .reduce((s, v) => s + (v.invoice?.taxAmount || 0), 0);
  const gstOutput = vouchers
    .filter((v) => v.voucherType === "SALE")
    .reduce((s, v) => s + (v.invoice?.taxAmount || 0), 0);
  const totalAmount = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);

  // Vendor breakdown (kept from the previous dashboard)
  const vendorMap: Record<string, { count: number; total: number; tax: number }> = {};
  for (const inv of invoices) {
    const v = inv.vendor || "Unknown";
    if (!vendorMap[v]) vendorMap[v] = { count: 0, total: 0, tax: 0 };
    vendorMap[v].count += 1;
    vendorMap[v].total += inv.totalAmount || 0;
    vendorMap[v].tax += inv.taxAmount || 0;
  }
  const topVendors = Object.entries(vendorMap)
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  const reviewList = drafts.map((v) => ({
    id: v.id,
    vendor: v.invoice?.vendor ?? "Unknown",
    invoiceNumber: v.invoice?.invoiceNumber ?? "—",
    type: v.voucherType,
    amount: v.totalDebit,
    hasUnmapped: v.lines.some((l) => l.ledgerId === null),
  }));

  return (
    <div className="p-6 md:p-10 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome back, {clerk.firstName || "User"}</p>
        </div>
        <div className="flex gap-3">
          <a href="/api/export?format=csv">
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </a>
          <Link href="/upload">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> New Invoice
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Cards — voucher-centric */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<ClipboardList className="h-5 w-5 text-yellow-600" />}
          label="Drafts to Review"
          value={drafts.length.toString()}
          bg="bg-yellow-50"
          href="/vouchers"
        />
        <StatCard
          icon={<ClipboardCheck className="h-5 w-5 text-emerald-600" />}
          label="Approved Vouchers"
          value={approved.length.toString()}
          bg="bg-emerald-50"
          valueColor="text-emerald-600"
        />
        <StatCard
          icon={<ArrowDownToLine className="h-5 w-5 text-blue-600" />}
          label="GST Input (Purchases)"
          value={`₹${gstInput.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<ArrowUpFromLine className="h-5 w-5 text-purple-600" />}
          label="GST Output (Sales)"
          value={`₹${gstOutput.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          bg="bg-purple-50"
        />
      </div>

      {/* Secondary stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<FileText className="h-5 w-5 text-sky-600" />}
          label="Total Vouchers"
          value={vouchers.length.toString()}
          bg="bg-sky-50"
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5 text-green-600" />}
          label="Total Invoiced"
          value={`₹${totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          bg="bg-green-50"
          valueColor="text-green-600"
        />
        <StatCard
          icon={<Building2 className="h-5 w-5 text-orange-600" />}
          label="Unique Vendors"
          value={Object.keys(vendorMap).length.toString()}
          bg="bg-orange-50"
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vouchers to review (2/3 width) */}
        <div className="lg:col-span-2 border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b bg-gray-50/50 flex justify-between items-center">
            <h3 className="font-semibold">Vouchers to Review</h3>
            <Link href="/vouchers" className="text-xs text-blue-600 hover:underline">
              View all
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {reviewList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      No drafts pending. Upload an invoice to generate a voucher.
                    </td>
                  </tr>
                )}
                {reviewList.slice(0, 20).map((v) => (
                  <tr key={v.id} className="border-b hover:bg-gray-50 transition group">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/vouchers/${v.id}`}
                        className="flex items-center gap-2 text-blue-600 group-hover:text-blue-800"
                      >
                        <FileText className="h-4 w-4" />
                        {v.vendor}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{v.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{v.type}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      ₹{v.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      {v.hasUnmapped ? (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          Needs ledger
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700">
                          Ready
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Vendors (1/3 width) */}
        <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b bg-gray-50/50">
            <h3 className="font-semibold">Top Vendors</h3>
          </div>
          <div className="divide-y">
            {topVendors.length === 0 && (
              <div className="p-6 text-center text-gray-400 text-sm">No vendor data yet</div>
            )}
            {topVendors.map((v, i) => (
              <div key={v.name} className="px-4 py-3 hover:bg-gray-50 transition">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                    <span className="font-medium text-sm text-gray-800 truncate max-w-[140px]">{v.name}</span>
                  </div>
                  <span className="font-semibold text-sm">₹{v.total.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between mt-1 ml-7">
                  <span className="text-xs text-gray-400">
                    {v.count} invoice{v.count > 1 ? "s" : ""}
                  </span>
                  <span className="text-xs text-gray-400">Tax: ₹{v.tax.toLocaleString("en-IN")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
  valueColor = "text-gray-900",
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg: string;
  valueColor?: string;
  href?: string;
}) {
  const card = (
    <div className="p-5 border rounded-xl bg-white shadow-sm hover:shadow transition">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className={`text-xl font-bold mt-0.5 ${valueColor}`}>{value}</p>
        </div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}
