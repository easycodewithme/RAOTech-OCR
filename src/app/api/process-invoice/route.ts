import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";
import { withRouteLogging } from "@/lib/trace";

async function processInvoice(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Forward the file to FastAPI backend /extract endpoint
    const backendForm = new FormData();
    backendForm.append("file", file);

    const response = await backendFetch("/extract", {
      method: "POST",
      body: backendForm,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Backend extraction failed" }));
      return NextResponse.json(
        { error: errorData.detail || "Extraction failed" },
        { status: response.status }
      );
    }

    const result = await response.json();

    // Backend returns: { success, message, data, gst_validation, job_id, processing_time, ocr_engine, file_metadata }
    return NextResponse.json(result);

  } catch (error) {
    console.error("[PROCESS_INVOICE_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to connect to OCR backend. Is the Python server running on port 8001?" },
      { status: 502 }
    );
  }
}

export const POST = withRouteLogging("api:/process-invoice", "POST", processInvoice);
