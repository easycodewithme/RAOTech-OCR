import { NextResponse } from "next/server";
import { detectDocumentType } from "@/lib/docs/detectType";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8001";

/** Map OCR backend doc_type → client DetectedDocType */
function mapBackendType(docType: string): string {
  const t = (docType || "").toLowerCase();
  if (t === "bank_statement" || t === "bank") return "bank";
  if (t === "credit_note") return "credit_note";
  if (t === "debit_note") return "debit_note";
  if (t === "receipt") return "receipt";
  return "invoice";
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Filename heuristic always available (works offline)
    const filenameGuess = detectDocumentType({ fileName: file.name });

    try {
      const backendForm = new FormData();
      backendForm.append("file", file);
      const response = await fetch(`${BACKEND_URL}/classify`, {
        method: "POST",
        body: backendForm,
      });

      if (response.ok) {
        const result = await response.json();
        const docType = mapBackendType(result.doc_type || filenameGuess);
        return NextResponse.json({
          success: true,
          doc_type: docType,
          confidence: result.confidence ?? 0.7,
          reason: result.reason || "vision classify",
          source: "ocr",
          ocr_engine: result.ocr_engine ?? null,
        });
      }
    } catch {
      /* fall through to filename */
    }

    return NextResponse.json({
      success: true,
      doc_type: filenameGuess,
      confidence: 0.55,
      reason: "filename heuristic (OCR classify unavailable)",
      source: "filename",
      ocr_engine: null,
    });
  } catch (error) {
    console.error("[CLASSIFY_DOC_ERROR]", error);
    return NextResponse.json({ error: "Classification failed" }, { status: 500 });
  }
}
