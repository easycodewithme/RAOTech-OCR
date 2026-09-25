import { NextResponse } from "next/server";
import { backendFetch, BackendTimeoutError } from "@/lib/backend";
import { withRouteLogging } from "@/lib/trace";

/**
 * The OCR backend runs on a free Render instance, which spins down when idle
 * and takes ~24s to wake. Vercel's Hobby default is 10s, so the first upload
 * after a quiet spell was killed mid-flight while the backend was still
 * booting — the screen came back blank, and a retry a minute later worked.
 * That read as "extraction is broken" when it was only the cold start.
 *
 * 60s is the Hobby ceiling and clears a measured 24s wake with room to spare.
 */
export const maxDuration = 60;


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
    // A cold backend is the commonest failure here and it is not an outage.
    // Saying so beats "is the Python server running on port 8001?", which is a
    // local-development message that reaches users in production.
    if (error instanceof BackendTimeoutError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    console.error("[PROCESS_INVOICE_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to connect to OCR backend. Is the Python server running on port 8001?" },
      { status: 502 }
    );
  }
}

export const POST = withRouteLogging("api:/process-invoice", "POST", processInvoice);
