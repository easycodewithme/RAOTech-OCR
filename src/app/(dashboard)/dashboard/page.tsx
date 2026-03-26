import { currentUser } from "@clerk/nextjs/server";
import {
  FileText,
  Plus,
  IndianRupee,
  Receipt,
  Building2,
  TrendingUp,
  Download,
  CheckCircle2,
  XCircle,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const email = user.emailAddresses[0]?.emailAddress;
  if (!email) return redirect("/sign-in");

  // Auto-create user on first login
  const dbUser = await prisma.user.upsert({
    where: { email },
    update: { name: user.firstName || user.username || undefined },
    create: {
      clerkId: user.id,
      email,
      name: user.firstName || user.username || "User",
    },
    include: {
      invoices: { orderBy: { createdAt: "desc" } },
    },
  });

  const invoices = dbUser?.invoices || [];
  const totalInvoices = invoices.length;
  const totalAmount = invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0);
  const totalTax = invoices.reduce((sum, inv) => sum + (inv.taxAmount || 0), 0);
  const uniqueVendors = new Set(invoices.map((inv) => inv.vendor).filter(Boolean)).size;
  const avgAmount = totalInvoices > 0 ? totalAmount / totalInvoices : 0;

  // Vendor breakdown
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

  return (
    <div className="p-6 md:p-10 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            Welcome back, {user.firstName || "User"}
          </p>
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

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Receipt className="h-5 w-5 text-blue-600" />}
          label="Total Invoices"
          value={totalInvoices.toString()}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5 text-green-600" />}
          label="Total Amount"
          value={`₹${totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          bg="bg-green-50"
          valueColor="text-green-600"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-orange-600" />}
          label="Total Tax (GST)"
          value={`₹${totalTax.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`}
          bg="bg-orange-50"
          valueColor="text-orange-600"
        />
        <StatCard
          icon={<Building2 className="h-5 w-5 text-purple-600" />}
          label="Unique Vendors"
          value={uniqueVendors.toString()}
          bg="bg-purple-50"
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Invoices (2/3 width) */}
        <div className="lg:col-span-2 border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b bg-gray-50/50 flex justify-between items-center">
            <h3 className="font-semibold">Recent Invoices</h3>
            <span className="text-xs text-gray-500">{totalInvoices} total</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">GST</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                      No invoices yet. Upload your first invoice to get started.
                    </td>
                  </tr>
                )}
                {invoices.slice(0, 20).map((inv) => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50 transition group">
                    <td className="px-4 py-3 font-medium">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="flex items-center gap-2 text-blue-600 group-hover:text-blue-800"
                      >
                        <FileText className="h-4 w-4" />
                        {inv.invoiceNumber || "Untitled"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <Link href={`/invoices/${inv.id}`} className="block">
                        {inv.vendor || "-"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {inv.date ? new Date(inv.date).toLocaleDateString("en-IN") : "N/A"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      ₹{inv.totalAmount?.toLocaleString("en-IN") || "0"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.gstValid != null ? (
                        inv.gstValid ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-400 mx-auto" />
                        )
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-bold ${
                          inv.status === "PROCESSED"
                            ? "bg-green-100 text-green-700"
                            : inv.status === "FAILED"
                            ? "bg-red-100 text-red-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {inv.status}
                      </span>
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
              <div className="p-6 text-center text-gray-400 text-sm">
                No vendor data yet
              </div>
            )}
            {topVendors.map((v, i) => (
              <div key={v.name} className="px-4 py-3 hover:bg-gray-50 transition">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                    <span className="font-medium text-sm text-gray-800 truncate max-w-[140px]">
                      {v.name}
                    </span>
                  </div>
                  <span className="font-semibold text-sm">
                    ₹{v.total.toLocaleString("en-IN")}
                  </span>
                </div>
                <div className="flex justify-between mt-1 ml-7">
                  <span className="text-xs text-gray-400">{v.count} invoice{v.count > 1 ? "s" : ""}</span>
                  <span className="text-xs text-gray-400">
                    Tax: ₹{v.tax.toLocaleString("en-IN")}
                  </span>
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
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg: string;
  valueColor?: string;
}) {
  return (
    <div className="p-5 border rounded-xl bg-white shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg}`}>{icon}</div>
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
          <p className={`text-xl font-bold mt-0.5 ${valueColor}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}
