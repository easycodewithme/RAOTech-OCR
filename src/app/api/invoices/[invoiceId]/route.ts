import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { cleanDate } from "@/lib/accounting/normalize";
import { recordAuditEvent } from "@/lib/audit";
import { formatDate, formatMoney } from "@/lib/format";

const cleanMoney = (val: any): number => {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    return parseFloat(val.replace(/[^0-9.-]+/g, "")) || 0;
  }
  return 0;
};

/**
 * Scope every lookup to the caller's workspace. findUnique by id alone would let
 * any signed-in user read, edit or delete another tenant's invoice by guessing a
 * UUID; the composite filter is what makes the 404 below an ownership check.
 */
async function loadOwnedInvoice(userId: string, clientId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, userId, clientId },
  });
}

interface TallyFootprint {
  voucherId: string;
  /** The REMOTEIDs Tally knows this voucher by, when we still hold them. */
  remoteIds: string[];
  /** True when every trace is an in-flight push whose outcome we never heard. */
  inFlightOnly: boolean;
}

/**
 * Has this invoice's voucher reached — or possibly reached — the client's live
 * TallyPrime books?
 *
 * This is the guard in front of both the destructive paths below. The schema
 * cascades Invoice -> Voucher -> VoucherSync, so deleting an invoice row takes
 * the `remoteId` with it, and `remoteId` is the only handle Tally will accept:
 * Tally never gives it back (it exports a different one), so it lives in
 * exactly one place, our own database. Destroy it and the voucher stays in the
 * client's books forever, reachable only by hand in the Day Book. TESTING.md
 * calls this the one thing that can actually hurt a client, and it is why the
 * teardown scripts refuse to run while anything is still POSTED.
 *
 * SENDING counts as present. It means a device claimed the push job and we
 * never heard the outcome, and "not sure" has to be read as "it is in there" —
 * being wrong the other way is unrecoverable.
 *
 * A voucher marked POSTED with no sync row at all counts too. That is the
 * fingerprint of the manual XML export path before it began recording one
 * (SYNC-05): the XML it generated carried a real `RAO-` REMOTEID, so the entry
 * is in Tally even though nothing here can name it any more.
 */
async function findTallyFootprint(invoiceId: string): Promise<TallyFootprint | null> {
  // `invoiceId` is unique on Voucher, so this is the invoice's one voucher.
  const voucher = await prisma.voucher.findUnique({
    where: { invoiceId },
    select: {
      id: true,
      status: true,
      syncs: { select: { state: true, remoteId: true } },
    },
  });
  if (!voucher) return null;

  const live = voucher.syncs.filter(
    (s) => s.state === "POSTED" || s.state === "SENDING"
  );
  if (live.length === 0 && voucher.status !== "POSTED") return null;

  return {
    voucherId: voucher.id,
    remoteIds: live.map((s) => s.remoteId),
    inFlightOnly:
      voucher.status !== "POSTED" && live.every((s) => s.state === "SENDING"),
  };
}

/**
 * The refusal. Deliberately says what to do next rather than just "no": there
 * is a "Delete From Tally" flow (POST /api/tally/delete) that removes the
 * voucher from the client's books by REMOTEID and moves the sync row to
 * DELETED, after which this invoice is safe to remove.
 */
function tallyFootprintBlocked(action: string, consequence: string, fp: TallyFootprint) {
  const known = fp.remoteIds.length ? ` (${fp.remoteIds.join(", ")})` : "";
  const message = fp.inFlightOnly
    ? `A push of this invoice's voucher${known} is still in flight and Tally has not reported back, so we cannot ${action} yet. Wait for it to settle, then use "Delete From Tally" if the entry landed. ${consequence}`
    : `This invoice's voucher${known} is in the client's TallyPrime books, so we cannot ${action}. Use "Delete From Tally" to remove it there first, then try again. ${consequence}`;

  return NextResponse.json(
    {
      error: message,
      code: "VOUCHER_IN_TALLY",
      voucherId: fp.voucherId,
      remoteIds: fp.remoteIds,
    },
    { status: 409 }
  );
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const { invoiceId } = await params;

    const invoice = await loadOwnedInvoice(user.id, client.id, invoiceId);

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
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const { invoiceId } = await params;

    const body = await req.json();
    const { extractedData } = body;

    const existingInvoice = await loadOwnedInvoice(user.id, client.id, invoiceId);

    if (!existingInvoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    const data = {
      invoiceNumber: extractedData.invoice_number || existingInvoice.invoiceNumber,
      date: extractedData.date ? cleanDate(extractedData.date) : existingInvoice.date,
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
    };

    /**
     * The fields that do not stay in this app.
     *
     * `invoiceNumber` becomes <VOUCHERNUMBER> and the bill reference, `vendor`
     * becomes <PARTYLEDGERNAME>, and the amounts are what the voucher lines
     * were built from — the push path reads the invoice for them at the moment
     * it builds the envelope (see `buildVoucherPushPayload`). Changing any of
     * them after the voucher is in Tally leaves this app describing one entry
     * and the client's books holding another, with no screen that shows the
     * disagreement. Everything else here (addresses, phone, customer contact,
     * the raw extraction) never leaves, so an accountant may still correct it.
     */
    const pushedFields: Array<[keyof typeof data, string]> = [
      ["invoiceNumber", "invoice number"],
      ["date", "date"],
      ["vendor", "vendor"],
      ["totalAmount", "total amount"],
      ["taxAmount", "tax amount"],
      ["subtotal", "subtotal"],
      ["cgst", "CGST"],
      ["sgst", "SGST"],
      ["igst", "IGST"],
      ["discount", "discount"],
    ];
    const changed = pushedFields
      .filter(([field]) => {
        const next = data[field];
        const current = (existingInvoice as Record<string, unknown>)[field];
        if (next instanceof Date || current instanceof Date) {
          return Number(next ?? NaN) !== Number(current ?? NaN);
        }
        return next !== current;
      })
      .map(([, label]) => label);

    // The lookup is paid for only when the edit would actually move one of
    // those values, so re-saving an address on a posted invoice still works.
    if (changed.length > 0) {
      const footprint = await findTallyFootprint(invoiceId);
      if (footprint) {
        return tallyFootprintBlocked(
          `change the ${changed.join(", ")}`,
          "Editing them here would leave this record and the client's books describing different entries, with no screen that shows the disagreement.",
          footprint
        );
      }
    }

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data,
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
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const { invoiceId } = await params;

    const invoice = await loadOwnedInvoice(user.id, client.id, invoiceId);

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Unpost before you delete. `prisma.invoice.delete` cascades through the
    // voucher to its sync rows, and the sync row is where the REMOTEID lives.
    const footprint = await findTallyFootprint(invoiceId);
    if (footprint) {
      return tallyFootprintBlocked(
        "delete this invoice",
        "Deleting it here would destroy the only id Tally accepts for that voucher, leaving the entry in the client's books with no way to remove it.",
        footprint
      );
    }

    await prisma.invoice.delete({ where: { id: invoiceId } });

    // The row is gone and the delete cascaded through its voucher and sync
    // rows, so this event is the only remaining record that the document ever
    // existed. That is exactly why `AuditEvent.entityId` is not a foreign key:
    // it still names the invoice nobody can look up any more.
    //
    // Everything a person would need to recognise the document — number,
    // vendor, date, amount — is copied into the summary and metadata, because
    // after this line there is nothing left to join to.
    await recordAuditEvent({
      userId: user.id,
      clientId: client.id,
      action: "INVOICE_DELETED",
      entityType: "INVOICE",
      entityId: invoice.id,
      summary: `Deleted invoice ${invoice.invoiceNumber ?? "(no number)"}${
        invoice.vendor ? ` from ${invoice.vendor}` : ""
      }${invoice.totalAmount ? ` for ${formatMoney(invoice.totalAmount)}` : ""} in ${client.name}`,
      metadata: {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.date ? formatDate(invoice.date) : null,
        vendor: invoice.vendor,
        vendorGstin: invoice.vendorGstin,
        totalAmount: invoice.totalAmount,
        taxAmount: invoice.taxAmount,
        status: invoice.status,
        fileUrl: invoice.fileUrl,
      },
    });

    return NextResponse.json({ success: true, message: "Invoice deleted" });

  } catch (error) {
    console.error("[INVOICE_DELETE_ERROR]", error);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
