import { redirect, notFound } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

const STATUS_STYLE: Record<string, string> = {
  MATCHED: "bg-emerald-100 text-emerald-700",
  VALUE_MISMATCH: "bg-amber-100 text-amber-800",
  MISSING_IN_BOOKS: "bg-red-100 text-red-700",
  MISSING_IN_2B: "bg-orange-100 text-orange-700",
  DUPLICATE: "bg-purple-100 text-purple-700",
};

export default async function GstDetailPage({
  params,
}: {
  params: Promise<{ uploadId: string }>;
}) {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;
  const { uploadId } = await params;

  const upload = await prisma.gst2bUpload.findFirst({
    where: { id: uploadId, userId: user.id, clientId: client.id },
    include: {
      matches: {
        include: {
          gst2bRow: true,
          invoice: {
            select: {
              id: true,
              vendor: true,
              invoiceNumber: true,
              subtotal: true,
              taxAmount: true,
            },
          },
        },
      },
    },
  });
  if (!upload) return notFound();

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/gst" className="text-sm text-blue-600 hover:underline">
            ← Back
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{upload.fileName}</h1>
          <p className="text-gray-500 text-sm">Period {upload.period || "—"}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Matched" value={upload.matched} color="text-emerald-600" />
        <Kpi label="Value mismatch" value={upload.mismatched} color="text-amber-600" />
        <Kpi label="Missing in books" value={upload.missingBooks} color="text-red-600" />
        <Kpi label="Missing in 2B" value={upload.missing2b} color="text-orange-600" />
        <Kpi
          label="ITC eligible / at risk"
          value={`₹${upload.itcEligible.toLocaleString("en-IN")} / ₹${upload.itcAtRisk.toLocaleString("en-IN")}`}
          color="text-gray-900"
        />
      </div>

      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-500 bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">2B Supplier</th>
              <th className="px-3 py-2 text-left">2B Inv #</th>
              <th className="px-3 py-2 text-right">2B Taxable</th>
              <th className="px-3 py-2 text-right">2B Tax</th>
              <th className="px-3 py-2 text-left">Books</th>
              <th className="px-3 py-2 text-right">Δ Taxable</th>
              <th className="px-3 py-2 text-right">Δ Tax</th>
              <th className="px-3 py-2 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {upload.matches.map((m) => {
              const rowClass =
                m.status === "MATCHED"
                  ? ""
                  : m.status === "VALUE_MISMATCH"
                    ? "bg-amber-50/60"
                    : m.status === "MISSING_IN_BOOKS"
                      ? "bg-red-50/50"
                      : "bg-orange-50/50";
              return (
                <tr key={m.id} className={`border-t ${rowClass}`}>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_STYLE[m.status]}`}>
                      {m.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{m.gst2bRow?.supplierName || "—"}</div>
                    <div className="text-xs text-gray-400">{m.gst2bRow?.supplierGstin}</div>
                  </td>
                  <td className="px-3 py-2">{m.gst2bRow?.invoiceNumber || "—"}</td>
                  <td className="px-3 py-2 text-right">{m.gst2bRow?.taxableValue?.toLocaleString("en-IN") ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{m.gst2bRow?.totalTax?.toLocaleString("en-IN") ?? "—"}</td>
                  <td className="px-3 py-2">
                    {m.invoice ? (
                      <>
                        <div className="font-medium">{m.invoice.vendor}</div>
                        <div className="text-xs text-gray-400">{m.invoice.invoiceNumber}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{m.taxableDiff.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{m.taxDiff.toFixed(2)}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{m.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div className={`text-xl font-bold mt-1 ${color}`}>{value}</div>
    </div>
  );
}
