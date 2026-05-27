import { NextResponse } from "next/server";
import { deleteMockInvoice, getMockInvoice, updateMockInvoice } from "@/lib/mockData";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const invoice = getMockInvoice(invoiceId);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json(invoice);
  } catch (error) {
    console.error("[INVOICE_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to fetch mock invoice" }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const body = await req.json();
    const { extractedData } = body || {};

    if (!extractedData) {
      return NextResponse.json({ error: "Missing extracted data" }, { status: 400 });
    }

    const updatedInvoice = updateMockInvoice(invoiceId, extractedData);
    if (!updatedInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, invoice: updatedInvoice });
  } catch (error) {
    console.error("[INVOICE_UPDATE_ERROR]", error);
    return NextResponse.json({ error: "Failed to update mock invoice" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const { invoiceId } = await params;
    const deleted = deleteMockInvoice(invoiceId);

    if (!deleted) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: "Invoice deleted" });
  } catch (error) {
    console.error("[INVOICE_DELETE_ERROR]", error);
    return NextResponse.json({ error: "Failed to delete mock invoice" }, { status: 500 });
  }
}
