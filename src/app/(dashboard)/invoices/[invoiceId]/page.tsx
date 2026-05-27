import InvoiceDetailView from "./InvoiceDetailView";
import { getMockInvoice } from "@/lib/mockData";

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const { invoiceId } = await params;

  const invoice = getMockInvoice(invoiceId);

  if (!invoice) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-700">Invoice not found</h2>
        <p className="text-gray-500 mt-2">The invoice you are looking for does not exist.</p>
      </div>
    );
  }

  return <InvoiceDetailView invoice={invoice} />;
}
