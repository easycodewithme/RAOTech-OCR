import { redirect } from "next/navigation";
import InvoiceDetailView from "./InvoiceDetailView";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const ctx = await getActiveClient();
  if (!ctx) redirect("/sign-in");
  const { user, client } = ctx;

  const { invoiceId } = await params;

  // Scoped to the caller's workspace — an unscoped findUnique here would render
  // any tenant's invoice to anyone holding the id.
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, userId: user.id, clientId: client.id },
  });

  if (!invoice) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-700">Invoice not found</h2>
        <p className="text-gray-500 mt-2">The invoice you are looking for does not exist.</p>
      </div>
    );
  }

  // Serialize for client component (dates become strings)
  const serialized = JSON.parse(JSON.stringify(invoice));

  return <InvoiceDetailView invoice={serialized} />;
}
