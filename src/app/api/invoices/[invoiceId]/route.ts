import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const cleanMoney = (val: any) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    return parseFloat(val.replace(/[^0-9.-]+/g,"")) || 0;
  }
  return 0;
};

export async function PATCH(
  req: Request,
  // 1. Define params as a Promise
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // 2. AWAIT the params to get the ID
    const { invoiceId } = await params;

    const body = await req.json();
    const { extractedData } = body;

    // 3. Use the awaited 'invoiceId' variable
    const existingInvoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!existingInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        invoiceNumber: extractedData.invoice_number || existingInvoice.invoiceNumber,
        date: extractedData.date ? new Date(extractedData.date) : existingInvoice.date,
        totalAmount: cleanMoney(extractedData.total_amount),
        taxAmount: cleanMoney(extractedData.tax),
        extractedData: extractedData,
      },
    });

    return NextResponse.json({ success: true, invoice: updatedInvoice });

  } catch (error) {
    console.error("[INVOICE_UPDATE_ERROR]", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}