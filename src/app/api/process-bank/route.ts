import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

// Proxy a bank statement file to the FastAPI /extract-bank endpoint
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const backendForm = new FormData();
    backendForm.append("file", file);

    const response = await fetch(`${BACKEND_URL}/extract-bank`, {
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
