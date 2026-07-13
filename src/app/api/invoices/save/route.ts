import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { createDraftVoucherForInvoice } from "@/lib/accounting/createVoucher";
import { cleanMoney, cleanDate } from "@/lib/accounting/normalize";
import { detectDuplicateKey, validateInvoiceGstExtended } from "@/lib/gst/validate";

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

    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "No active client" }, { status: 400 });
    const { client } = ctx;

    const body = await req.json();
    const {
      extractedData,
      gstValidation,
      fileName,
      processingTime,
      ocrEngine,
      partyLedgerId,
      forceNewParty,
      documentType,
      allowDuplicate,
      checkDuplicateOnly,
    } = body;

    const validation = validateInvoiceGstExtended({
      vendorGstin: extractedData?.vendor_gstin,
      customerGstin: extractedData?.customer_gstin,
      subtotal: cleanMoney(extractedData?.subtotal),
      cgst: cleanMoney(extractedData?.cgst),
      sgst: cleanMoney(extractedData?.sgst),
      igst: cleanMoney(extractedData?.igst),
      taxAmount: cleanMoney(extractedData?.tax),
      totalAmount: cleanMoney(extractedData?.total_amount),
      discount: cleanMoney(extractedData?.discount),
      items: extractedData?.items,
      documentType: documentType || extractedData?.document_type,
    });

    // Duplicate detection
    const dupKey = detectDuplicateKey({
      invoiceNumber: extractedData?.invoice_number,
      vendorGstin: extractedData?.vendor_gstin,
      vendor: extractedData?.vendor,
      totalAmount: cleanMoney(extractedData?.total_amount),
    });

    const existing = await prisma.invoice.findMany({
      where: {
        userId: dbUser.id,
        clientId: client.id,
        invoiceNumber: extractedData?.invoice_number || undefined,
      },
      take: 20,
    });

    let isDuplicate = false;
    let duplicateOfId: string | null = null;
    for (const inv of existing) {
      const key = detectDuplicateKey({
        invoiceNumber: inv.invoiceNumber,
        vendorGstin: inv.vendorGstin,
        vendor: inv.vendor,
        totalAmount: inv.totalAmount,
      });
      if (key === dupKey && dupKey.split("|")[0]) {
        isDuplicate = true;
        duplicateOfId = inv.id;
        break;
      }
    }

    // Soft-block: return 409 so UI can confirm before creating another copy
    if (isDuplicate && !allowDuplicate) {
      return NextResponse.json(
        {
          error: "Possible duplicate invoice",
          isDuplicate: true,
          duplicateOfId,
          validation,
          code: "DUPLICATE_INVOICE",
        },
        { status: 409 }
      );
    }

    if (checkDuplicateOnly) {
      return NextResponse.json({ isDuplicate, duplicateOfId, validation });
    }

    const invoice = await prisma.invoice.create({
      data: {
        userId: dbUser.id,
        clientId: client.id,
        fileUrl: fileName || "invoice",
        status: "PROCESSED",
        invoiceNumber: extractedData.invoice_number || null,
        date: cleanDate(extractedData.date),
        totalAmount: cleanMoney(extractedData.total_amount),
        taxAmount: cleanMoney(extractedData.tax),
        vendor: extractedData.vendor || null,
        vendorGstin: extractedData.vendor_gstin || null,
        vendorAddress: extractedData.vendor_address || null,
        vendorPhone: extractedData.vendor_phone || null,
        customerName: extractedData.customer_name || null,
        customerGstin: extractedData.customer_gstin || null,
        subtotal: cleanMoney(extractedData.subtotal) || null,
        cgst: cleanMoney(extractedData.cgst) || null,
        sgst: cleanMoney(extractedData.sgst) || null,
        igst: cleanMoney(extractedData.igst) || null,
        discount: cleanMoney(extractedData.discount) || null,
        gstValid: validation.isValid ?? gstValidation?.is_valid_invoice ?? null,
        gstState: validation.vendorState ?? gstValidation?.vendor_state ?? null,
        validationFlags: validation.issues as any,
        ocrEngine: ocrEngine || null,
        processingTime: processingTime || null,
        extractedData: extractedData,
        items: extractedData.items || null,
        documentType: documentType || extractedData.document_type || "PURCHASE",
        isDuplicate,
        duplicateOfId,
        irn: extractedData.irn || null,
        ewayBillNo: extractedData.eway_bill_no || extractedData.ewayBillNo || null,
      },
    });

    let voucherId: string | null = null;
    try {
      const voucher = await createDraftVoucherForInvoice(dbUser.id, invoice.id, {
        partyLedgerId: partyLedgerId || undefined,
        forceNewParty: !!forceNewParty,
        clientId: client.id,
        voucherTypeOverride: documentType === "SALE" ? "SALE" : documentType === "CREDIT_NOTE" ? "CREDIT_NOTE" : documentType === "DEBIT_NOTE" ? "DEBIT_NOTE" : undefined,
      });
      voucherId = voucher?.id ?? null;
    } catch (voucherErr) {
      console.error("[VOUCHER_DRAFT_ERROR]", voucherErr);
    }

    return NextResponse.json({
      success: true,
      invoice,
      voucherId,
      isDuplicate,
      duplicateOfId,
      validation,
    });
  } catch (error) {
    console.error("[INVOICE_SAVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
  }
}
