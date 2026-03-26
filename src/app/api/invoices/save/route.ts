import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const cleanMoney = (val: any): number => {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    return parseFloat(val.replace(/[^0-9.-]+/g, "")) || 0;
  }
  return 0;
};

const cleanDate = (val: any): Date => {
  if (!val) return new Date();
  // Handle DD/MM/YYYY and DD-MM-YYYY formats from Indian invoices
  if (typeof val === "string") {
    const ddmmyyyy = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmyyyy) {
      const d = new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date() : d;
};

export async function POST(req: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const email = user.emailAddresses[0]?.emailAddress;

    const dbUser = await prisma.user.upsert({
      where: { email: email },
      update: {},
      create: {
        id: user.id,
        clerkId: user.id,
        email: email,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim(),
        plan: "FREE",
      },
    });

    const body = await req.json();
    const { extractedData, gstValidation, fileName, processingTime, ocrEngine } = body;

    // extractedData comes from backend's response.data (the actual invoice fields)
    const invoice = await prisma.invoice.create({
      data: {
        userId: dbUser.id,
        fileUrl: fileName || "invoice",
        status: "PROCESSED",

        // Core fields
        invoiceNumber: extractedData.invoice_number || null,
        date: cleanDate(extractedData.date),
        totalAmount: cleanMoney(extractedData.total_amount),
        taxAmount: cleanMoney(extractedData.tax),

        // Vendor details
        vendor: extractedData.vendor || null,
        vendorGstin: extractedData.vendor_gstin || null,
        vendorAddress: extractedData.vendor_address || null,
        vendorPhone: extractedData.vendor_phone || null,

        // Customer details
        customerName: extractedData.customer_name || null,
        customerGstin: extractedData.customer_gstin || null,

        // Tax breakdown
        subtotal: cleanMoney(extractedData.subtotal) || null,
        cgst: cleanMoney(extractedData.cgst) || null,
        sgst: cleanMoney(extractedData.sgst) || null,
        igst: cleanMoney(extractedData.igst) || null,
        discount: cleanMoney(extractedData.discount) || null,

        // GST validation
        gstValid: gstValidation?.is_valid_invoice ?? null,
        gstState: gstValidation?.vendor_state ?? null,

        // Processing metadata
        ocrEngine: ocrEngine || null,
        processingTime: processingTime || null,

        // Full raw data
        extractedData: extractedData,
        items: extractedData.items || null,
      },
    });

    return NextResponse.json({ success: true, invoice });

  } catch (error) {
    console.error("[INVOICE_SAVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
  }
}
