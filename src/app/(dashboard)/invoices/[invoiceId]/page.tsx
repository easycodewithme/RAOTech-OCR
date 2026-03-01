import { currentUser } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { redirect } from "next/navigation";
import EditInvoiceForm from "./EditInvoiceForm";

const prisma = new PrismaClient();

// In Next.js 15, params is a Promise!
interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // 1. AWAIT the params here
  const { invoiceId } = await params;

  // 2. Now use the awaited ID in Prisma
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
  });

  if (!invoice) {
    return <div className="p-8">Invoice not found</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold tracking-tight">Edit Invoice</h2>
        <span className="text-sm text-gray-500">ID: {invoice.invoiceNumber}</span>
      </div>
      
      <EditInvoiceForm invoice={invoice} />
    </div>
  );
}