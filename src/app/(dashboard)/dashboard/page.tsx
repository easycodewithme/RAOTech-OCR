import { currentUser } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { redirect } from "next/navigation";

const prisma = new PrismaClient();

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) return redirect("/sign-in");

  const dbUser = await prisma.user.findUnique({
    where: { email: user.emailAddresses[0].emailAddress },
    include: { 
      invoices: { orderBy: { createdAt: 'desc' } } 
    }
  });

  const totalInvoices = dbUser?.invoices.length || 0;
  const totalRevenue = dbUser?.invoices.reduce((sum, inv) => sum + (inv.totalAmount || 0), 0) || 0;

  return (
    <div className="p-10 space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <Link href="/upload">
          <Button><Plus className="mr-2 h-4 w-4" /> New Invoice</Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="p-6 border rounded-xl bg-white shadow-sm">
          <h3 className="font-medium text-sm text-gray-500">Total Invoices</h3>
          <p className="text-2xl font-bold mt-2">{totalInvoices}</p>
        </div>
        <div className="p-6 border rounded-xl bg-white shadow-sm">
          <h3 className="font-medium text-sm text-gray-500">Total Value</h3>
          {/* CHANGED: Currency to ₹ */}
          <p className="text-2xl font-bold mt-2 text-green-600">
            ₹{totalRevenue.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      <div className="border rounded-xl bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b bg-gray-50/50">
          <h3 className="font-semibold">Recent Invoices</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-gray-500 bg-gray-50 uppercase text-xs">
              <tr>
                <th className="px-6 py-3">Invoice #</th>
                <th className="px-6 py-3">Date</th>
                <th className="px-6 py-3">Amount</th>
                <th className="px-6 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {dbUser?.invoices.map((inv) => (
                <tr key={inv.id} className="border-b hover:bg-gray-50 transition group">
                  {/* CHANGED: Wrapped content in Link to make it clickable */}
                  <td className="px-6 py-4 font-medium">
                    <Link href={`/invoices/${inv.id}`} className="flex items-center gap-2 w-full h-full text-blue-600 group-hover:text-blue-800">
                      <FileText className="h-4 w-4" />
                      {inv.invoiceNumber || "Untitled"}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                     <Link href={`/invoices/${inv.id}`} className="block w-full h-full text-gray-700">
                        {inv.date ? new Date(inv.date).toLocaleDateString() : "N/A"}
                     </Link>
                  </td>
                  <td className="px-6 py-4 font-semibold text-gray-900">
                    {/* CHANGED: Currency to ₹ */}
                     <Link href={`/invoices/${inv.id}`} className="block w-full h-full">
                        ₹{inv.totalAmount?.toLocaleString('en-IN') || "0"}
                     </Link>
                  </td>
                  <td className="px-6 py-4">
                    <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full text-xs font-bold">
                      {inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}