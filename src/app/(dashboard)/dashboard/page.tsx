import { currentUser } from "@clerk/nextjs/server";
import {
  Plus,
  Download,
  ClipboardList,
  AlertTriangle,
  IndianRupee,
  Send,
  Users,
  Scale,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { extraPagesEnabled } from "@/lib/featureFlags";

export default async function Dashboard() {
  const clerk = await currentUser();
  if (!clerk) return redirect("/sign-in");

  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;
  const showExtraPages = extraPagesEnabled();

  const [invoices, vouchers, latestRecon, unmappedParties] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.voucher.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { vendor: true, invoiceNumber: true, taxAmount: true } },
        lines: { select: { ledgerId: true, role: true } },
      },
    }),
    prisma.gst2bUpload.findFirst({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.voucherLine.count({
      where: {
        ledgerId: null,
        role: "PARTY",
        voucher: { userId: user.id, clientId: client.id, status: "DRAFT" },
      },
    }),
  ]);

  const drafts = vouchers.filter((v) => v.status === "DRAFT");
  const approved = vouchers.filter((v) => v.status === "APPROVED");
  const exported = vouchers.filter((v) => v.status === "EXPORTED_DEMO" || v.status === "POSTED");
  const pendingReview = drafts.filter((v) => v.lines.some((l) => l.ledgerId === null) || (v.avgConfidence ?? 1) < 0.7);
  const gstInput = vouchers
    .filter((v) => v.voucherType === "PURCHASE")
    .reduce((s, v) => s + (v.invoice?.taxAmount || 0), 0);
  const gstOutput = vouchers
    .filter((v) => v.voucherType === "SALE")
    .reduce((s, v) => s + (v.invoice?.taxAmount || 0), 0);
  const itcAtStake = latestRecon?.itcAtRisk ?? 0;
  const gstLiability = Math.max(0, gstOutput - gstInput);

  const reviewList = drafts.slice(0, 20).map((v) => ({
    id: v.id,
    vendor: v.invoice?.vendor ?? "Unknown",
    invoiceNumber: v.invoice?.invoiceNumber ?? "—",
    type: v.voucherType,
    amount: v.totalDebit,
    hasUnmapped: v.lines.some((l) => l.ledgerId === null),
    confidence: v.avgConfidence,
  }));

  return (
    <div className="p-6 md:p-10 space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-gray-500 text-sm mt-1">
            {client.name} · Welcome back, {clerk.firstName || "User"}
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<ClipboardList className="h-5 w-5 text-yellow-600" />}
          label="Pending Review"
          value={pendingReview.length.toString()}
          bg="bg-yellow-50"
          href={showExtraPages ? "/review" : "/transactions"}
        />
        <StatCard
          icon={<Scale className="h-5 w-5 text-orange-600" />}
          label="ITC at Stake"
          value={`₹${itcAtStake.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          bg="bg-orange-50"
          href={showExtraPages ? "/gst" : undefined}
        />
        <StatCard
          icon={<IndianRupee className="h-5 w-5 text-purple-600" />}
          label="GST Liability (est.)"
          value={`₹${gstLiability.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
          bg="bg-purple-50"
        />
        <StatCard
          icon={<Users className="h-5 w-5 text-red-600" />}
          label="Unmapped Parties"
          value={unmappedParties.toString()}
          bg="bg-red-50"
          href="/transactions"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
          label="Draft Vouchers"
          value={drafts.length.toString()}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<Send className="h-5 w-5 text-emerald-600" />}
          label="Ready to Export"
          value={approved.length.toString()}
          bg="bg-emerald-50"
          valueColor="text-emerald-600"
        />
        <StatCard
          icon={<Download className="h-5 w-5 text-sky-600" />}
          label="Exported (demo)"
          value={exported.length.toString()}
          bg="bg-sky-50"
        />
        <StatCard
          icon={<ClipboardList className="h-5 w-5 text-blue-600" />}
          label="Invoices"
          value={invoices.length.toString()}
          bg="bg-blue-50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 border rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="p-5 border-b bg-gray-50/50 flex justify-between items-center">
            <h3 className="font-semibold">Vouchers to Review</h3>
            {showExtraPages ? (
              <Link href="/review" className="text-xs text-blue-600 hover:underline">
                Open review queue
              </Link>
            ) : (
              <Link href="/transactions" className="text-xs text-blue-600 hover:underline">
                Open transactions
              </Link>
            )}
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
                {reviewList.map((v) => (
                  <tr key={v.id} className="border-b hover:bg-gray-50 transition">
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/vouchers/${v.id}`} className="text-blue-600 hover:underline">
                        {v.vendor}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{v.invoiceNumber}</td>
                    <td className="px-4 py-3 text-gray-600">{v.type}</td>
                    <td className="px-4 py-3 text-right font-semibold">
                      ₹{v.amount.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      {v.hasUnmapped ? (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">
                          Needs ledger
                        </span>
                      ) : (v.confidence ?? 1) < 0.7 ? (
                        <span className="px-2 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-700">
                          Low confidence
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

        <div className="border rounded-xl bg-white shadow-sm p-5 space-y-4">
          <h3 className="font-semibold">Quick actions</h3>
          {showExtraPages && (
            <Link href="/gst" className="block rounded-lg border p-3 hover:bg-gray-50 text-sm">
              Run GST reconciliation (GSTR-2B)
            </Link>
          )}
          {showExtraPages && (
            <Link href="/pipeline" className="block rounded-lg border p-3 hover:bg-gray-50 text-sm">
              View pipeline board
            </Link>
          )}
          {showExtraPages && (
            <Link href="/reports" className="block rounded-lg border p-3 hover:bg-gray-50 text-sm">
              GST summary &amp; reports
            </Link>
          )}
          <Link
            href="/transactions"
            className="block rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 font-medium"
          >
            Export approved vouchers to Tally XML
          </Link>
          {showExtraPages && latestRecon && (
            <div className="rounded-lg bg-orange-50 border border-orange-100 p-3 text-sm">
              <div className="font-medium text-orange-800">Latest 2B recon</div>
              <div className="text-orange-700 mt-1">
                {latestRecon.matched} matched · {latestRecon.mismatched} mismatch · ITC at risk ₹
                {latestRecon.itcAtRisk.toLocaleString("en-IN")}
              </div>
            </div>
          )}
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

