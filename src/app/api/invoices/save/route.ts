import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { createDraftVoucherForInvoice } from "@/lib/accounting/createVoucher";
import { cleanMoney, cleanDate } from "@/lib/accounting/normalize";
import { detectDuplicateKey, validateInvoiceGstExtended } from "@/lib/gst/validate";

export async function POST(req: Request) {
  try {
    // auth() decodes the session cookie locally; the currentUser() call this
    // replaced cost a Clerk API round trip on every save.
    const { userId: clerkId } = await auth();
    if (!clerkId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // One user resolver, not two. This route used to run its own
    // `prisma.user.upsert({ where: { email } })` — a second copy of what
    // getDbUser() does, disagreeing with it in two ways: it forced
    // `User.id = clerkId` instead of letting the schema's @default(uuid())
    // run, and its empty `update` never backfilled clerkId. So a firm's user
    // row had a Clerk id or a uuid for a primary key depending on which route
    // happened to create it first, and the two resolvers could land on
    // different rows — after which an invoice was written with a userId that
    // no scoped query would ever match again. Not deleted, not errored:
    // invisible. getActiveClient() already resolves the user through
    // getDbUser(), so taking it from there costs nothing extra.
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "No active client" }, { status: 400 });
    const { user: dbUser, client } = ctx;

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

    // Compensation cess. The column has existed on Invoice all along and the
    // voucher builder has emitted a CESS line for just as long, but no
    // ingestion path ever wrote it onto the invoice row — so the books were
    // right while every dashboard total, report and GST reconciliation that
    // reads the Invoice table understated tax by exactly the cess.
    const cess = cleanMoney(extractedData.cess);
    const statedTax = cleanMoney(extractedData.tax);
    const componentTax =
      cleanMoney(extractedData.cgst) +
      cleanMoney(extractedData.sgst) +
      cleanMoney(extractedData.igst);
    // `tax` is whatever the document printed as its tax total, and on most
    // bills that figure already includes the cess. Adding it unconditionally
    // would trade an understatement for an overstatement, which is no better.
    // So add it only when the printed total demonstrably excludes it — when it
    // reconciles to CGST+SGST+IGST on its own, to the rupee.
    const taxAmount =
      cess > 0 && Math.abs(statedTax - componentTax) <= 1 ? statedTax + cess : statedTax;

    const invoice = await prisma.invoice.create({
      data: {
        userId: dbUser.id,
        clientId: client.id,
        fileUrl: fileName || "invoice",
        status: "PROCESSED",
        invoiceNumber: extractedData.invoice_number || null,
        date: cleanDate(extractedData.date),
        totalAmount: cleanMoney(extractedData.total_amount),
        taxAmount,
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
        cess: cess || null,
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
        // Written for the same reason as cess: the column exists, the OCR
        // payload carries it, and nothing was persisting it. The acknowledgement
        // number is what a CA quotes back to the IRP when an e-invoice has to
        // be cancelled, so losing it means going back to the paper bill.
        ackNo: extractedData.ack_no || extractedData.ackNo || null,
        ewayBillNo: extractedData.eway_bill_no || extractedData.ewayBillNo || null,
      },
    });

    let voucherId: string | null = null;
    let voucherError: string | null = null;
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
      voucherError = voucherErr instanceof Error ? voucherErr.message : "Unknown error";
    }

    // Two things happened here and only one of them can fail, so say which.
    //
    // This used to console.error the voucher failure and return a flat 200
    // with `voucherId: null`. The user was told it worked, went to check the
    // transactions list, and found nothing — because that screen lists
    // vouchers, and there wasn't one. A bare 500 would be dishonest the other
    // way: the invoice really is in the database, and re-posting it would only
    // create a second copy. So the invoice is kept, the status names the
    // partial outcome, and the half that failed is in the body with its
    // reason. Mapping ledgers from the invoice page creates the voucher later,
    // so nothing is lost here — it was only unannounced.
    const partial = voucherError !== null;
    return NextResponse.json(
      {
        success: true,
        partial,
        invoice,
        voucherId,
        voucherCreated: voucherId !== null,
        voucherError,
        ...(partial
          ? {
              warning:
                "Invoice saved, but its draft voucher could not be created — it will not appear in Transactions yet. Open the invoice and map its ledgers to retry.",
            }
          : {}),
        isDuplicate,
        duplicateOfId,
        validation,
      },
      // 207 Multi-Status: still a success (res.ok stays true, so the caller
      // does not roll back or retry the save), but distinguishable from a
      // clean 200 by any caller that wants to surface the warning.
      { status: partial ? 207 : 200 }
    );
  } catch (error) {
    console.error("[INVOICE_SAVE_ERROR]", error);
    const message = error instanceof Error ? error.message : "Failed to save invoice";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
