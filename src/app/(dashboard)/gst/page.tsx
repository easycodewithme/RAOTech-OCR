import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import GstUploadClient from "./GstUploadClient";

export default async function GstPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");
  const { user, client } = ctx;

  const uploads = await prisma.gst2bUpload.findMany({
    where: { userId: user.id, clientId: client.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="p-6 md:p-10 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">GST Reconciliation</h1>
        <p className="text-gray-500 text-sm mt-1">
          Upload GSTR-2B (JSON/CSV) and match against {client.name}&apos;s purchase register
        </p>
      </div>

      <GstUploadClient />

      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="p-4 border-b font-semibold bg-gray-50/50">Recent reconciliations</div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-500 bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left">File</th>
              <th className="px-4 py-3 text-left">Period</th>
              <th className="px-4 py-3 text-right">Matched</th>
              <th className="px-4 py-3 text-right">Mismatch</th>
              <th className="px-4 py-3 text-right">Missing books</th>
              <th className="px-4 py-3 text-right">Missing 2B</th>
              <th className="px-4 py-3 text-right">ITC at risk</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {uploads.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                  No reconciliations yet
                </td>
              </tr>
            )}
            {uploads.map((u) => (
              <tr key={u.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{u.fileName}</td>
                <td className="px-4 py-3 text-gray-600">{u.period || "—"}</td>
                <td className="px-4 py-3 text-right text-emerald-600">{u.matched}</td>
                <td className="px-4 py-3 text-right text-amber-600">{u.mismatched}</td>
                <td className="px-4 py-3 text-right text-red-600">{u.missingBooks}</td>
                <td className="px-4 py-3 text-right text-orange-600">{u.missing2b}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  ₹{u.itcAtRisk.toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/gst/${u.id}`} className="text-blue-600 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
