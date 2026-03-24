import { NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    // Forward all files to FastAPI /extract/bulk endpoint
    const backendForm = new FormData();
    for (const file of files) {
      backendForm.append("files", file);
    }

    const response = await fetch(`${BACKEND_URL}/extract/bulk`, {
      method: "POST",
      body: backendForm,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Bulk extraction failed" }));
      return NextResponse.json(
        { error: errorData.detail || "Bulk extraction failed" },
        { status: response.status }
      );
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error("[BULK_ERROR]", error);
    return NextResponse.json(
      { error: "Failed to connect to OCR backend for bulk processing." },
      { status: 502 }
    );
  }
}

// Poll job status
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_URL}/jobs/${jobId}`);

    if (!response.ok) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const result = await response.json();
    return NextResponse.json(result);

  } catch (error) {
    console.error("[BULK_STATUS_ERROR]", error);
    return NextResponse.json({ error: "Failed to check job status" }, { status: 502 });
  }
}
