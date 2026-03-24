import { currentUser } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";
import { redirect } from "next/navigation";
import InvoiceDetailView from "./InvoiceDetailView";

const prisma = new PrismaClient();

interface PageProps {
  params: Promise<{ invoiceId: string }>;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const { invoiceId } = await params;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
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
