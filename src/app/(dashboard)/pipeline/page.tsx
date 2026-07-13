import { redirect } from "next/navigation";
import Link from "next/link";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";

export default async function PipelinePage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;

  const [invoices, vouchers] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        vendor: true,
        invoiceNumber: true,
        status: true,
        totalAmount: true,
        voucher: { select: { id: true, status: true, avgConfidence: true, lines: { select: { ledgerId: true } } } },
      },
    }),
    prisma.voucher.findMany({
      where: { userId: user.id, clientId: client.id },
      include: { invoice: { select: { vendor: true, invoiceNumber: true } }, lines: { select: { ledgerId: true } } },
    }),
  ]);

  const uploaded = invoices.filter((i) => i.status === "PENDING");
  const extracted = invoices.filter((i) => i.status === "PROCESSED" && !i.voucher);
  const mapped = vouchers.filter(
    (v) => v.status === "DRAFT" && v.lines.every((l) => l.ledgerId !== null)
  );
  const needsMap = vouchers.filter(
    (v) => v.status === "DRAFT" && v.lines.some((l) => l.ledgerId === null)
  );
  const approved = vouchers.filter((v) => v.status === "APPROVED");
  const exported = vouchers.filter((v) => v.status === "EXPORTED_DEMO" || v.status === "POSTED");

  const columns = [
    { key: "uploaded", title: "Uploaded", items: uploaded.map(cardFromInvoice), color: "border-slate-300" },
    { key: "extracted", title: "Extracted", items: extracted.map(cardFromInvoice), color: "border-violet-300" },
    {
      key: "needs",
      title: "Needs mapping",
      items: needsMap.map(cardFromVoucher),
      color: "border-red-300",
    },
    { key: "mapped", title: "Mapped / Ready", items: mapped.map(cardFromVoucher), color: "border-yellow-300" },
    { key: "approved", title: "Approved", items: approved.map(cardFromVoucher), color: "border-emerald-300" },
    { key: "exported", title: "Exported", items: exported.map(cardFromVoucher), color: "border-sky-300" },
  ];

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
        <p className="text-gray-500 text-sm mt-1">
          Uploaded → Extracted → Mapped → Approved → Exported · {client.name}
        </p>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => (
          <div key={col.key} className={`min-w-[220px] flex-1 rounded-xl border-t-4 bg-white shadow-sm ${col.color}`}>
            <div className="px-3 py-2 border-b flex justify-between items-center">
              <span className="text-sm font-semibold">{col.title}</span>
              <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5">{col.items.length}</span>
            </div>
            <div className="p-2 space-y-2 max-h-[70vh] overflow-y-auto">
              {col.items.length === 0 && (
                <div className="text-xs text-gray-400 p-3 text-center">Empty</div>
              )}
              {col.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="block rounded-lg border p-2 hover:bg-gray-50 text-sm"
                >
                  <div className="font-medium truncate">{item.title}</div>
                  <div className="text-xs text-gray-500 truncate">{item.subtitle}</div>
                  {item.amount != null && (
                    <div className="text-xs font-semibold mt-1">
                      ₹{item.amount.toLocaleString("en-IN")}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function cardFromInvoice(i: {
  id: string;
  vendor: string | null;
  invoiceNumber: string | null;
  totalAmount: number | null;
  voucher: { id: string } | null;
}) {
  return {
    id: i.id,
    title: i.vendor || "Unknown",
    subtitle: i.invoiceNumber || i.id.slice(0, 8),
    amount: i.totalAmount,
    href: i.voucher ? `/vouchers/${i.voucher.id}` : `/invoices/${i.id}`,
  };
}

function cardFromVoucher(v: {
  id: string;
  totalDebit: number;
  invoice: { vendor: string | null; invoiceNumber: string | null } | null;
}) {
  return {
    id: v.id,
    title: v.invoice?.vendor || "Unknown",
    subtitle: v.invoice?.invoiceNumber || v.id.slice(0, 8),
    amount: v.totalDebit,
    href: `/vouchers/${v.id}`,
  };
}
