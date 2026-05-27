import { NextResponse } from "next/server";
import { getMockExtraction } from "@/lib/mockData";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const data = getMockExtraction(file.name);

    return NextResponse.json({
      success: true,
      message: "Mock extraction complete",
      data,
      gst_validation: {
        is_valid_invoice: true,
        vendor_state: "KA",
        vendor_message: "Mock validation passed",
        customer_state: "KA",
        customer_message: "Mock validation passed",
      },
      processing_time: 0.7,
      ocr_engine: "mock-ocr",
      file_metadata: {
        name: file.name,
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    console.error("[PROCESS_INVOICE_ERROR]", error);
    return NextResponse.json({ error: "Mock extraction failed" }, { status: 500 });
  }
}
