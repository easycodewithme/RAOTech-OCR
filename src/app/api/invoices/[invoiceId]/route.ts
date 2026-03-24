import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const cleanMoney = (val: any): number => {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    return parseFloat(val.replace(/[^0-9.-]+/g, "")) || 0;
  }
  return 0;
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { invoiceId } = await params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json(invoice);

  } catch (error) {
    console.error("[INVOICE_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { invoiceId } = await params;

    const body = await req.json();
    const { extractedData } = body;

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

        vendor: extractedData.vendor ?? existingInvoice.vendor,
        vendorGstin: extractedData.vendor_gstin ?? existingInvoice.vendorGstin,
        vendorAddress: extractedData.vendor_address ?? existingInvoice.vendorAddress,
        vendorPhone: extractedData.vendor_phone ?? existingInvoice.vendorPhone,
        customerName: extractedData.customer_name ?? existingInvoice.customerName,
        customerGstin: extractedData.customer_gstin ?? existingInvoice.customerGstin,

        subtotal: cleanMoney(extractedData.subtotal) || existingInvoice.subtotal,
        cgst: cleanMoney(extractedData.cgst) || existingInvoice.cgst,
        sgst: cleanMoney(extractedData.sgst) || existingInvoice.sgst,
        igst: cleanMoney(extractedData.igst) || existingInvoice.igst,
        discount: cleanMoney(extractedData.discount) || existingInvoice.discount,

        extractedData: extractedData,
        items: extractedData.items || existingInvoice.items,
      },
    });

    return NextResponse.json({ success: true, invoice: updatedInvoice });

  } catch (error) {
    console.error("[INVOICE_UPDATE_ERROR]", error);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { invoiceId } = await params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    await prisma.invoice.delete({ where: { id: invoiceId } });

    return NextResponse.json({ success: true, message: "Invoice deleted" });

  } catch (error) {
    console.error("[INVOICE_DELETE_ERROR]", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
