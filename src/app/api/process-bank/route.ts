import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";
import { withRouteLogging } from "@/lib/trace";

// Proxy a bank statement file to the FastAPI /extract-bank endpoint
async function processBank(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const backendForm = new FormData();
    backendForm.append("file", file);

    const response = await backendFetch("/extract-bank", {
      method: "POST",
      body: backendForm,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Bank extraction failed" }));
      return NextResponse.json({ error: errorData.detail || "Bank extraction failed" }, { status: response.status });
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("[PROCESS_BANK_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to connect to OCR backend. Is the Python server running on port 8001?" },
      { status: 502 }
    );
  }
}

export const POST = withRouteLogging("api:/process-bank", "POST", processBank);
