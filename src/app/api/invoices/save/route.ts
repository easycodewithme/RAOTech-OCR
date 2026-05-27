import { NextResponse } from "next/server";
import { saveMockInvoice } from "@/lib/mockData";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { extractedData, gstValidation, fileName, processingTime, ocrEngine } = body || {};

    if (!extractedData) {
      return NextResponse.json({ error: "No extracted data provided" }, { status: 400 });
    }

    const invoice = saveMockInvoice({
      extractedData,
      gstValidation,
      fileName,
      processingTime,
      ocrEngine,
    });

    return NextResponse.json({ success: true, invoice });
  } catch (error) {
    console.error("[INVOICE_SAVE_ERROR]", error);
    return NextResponse.json({ error: "Failed to save mock invoice" }, { status: 500 });
  }
}
