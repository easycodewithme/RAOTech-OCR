import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/backend";
import { getActiveClient } from "@/lib/clientContext";

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


/**
 * The shape a job id from the OCR backend is allowed to take.
 *
 * A character allowlist rather than a uuid parse, because the id is the
 * backend's to choose and only one property of it matters here: that nothing
 * able to leave the `/jobs/` path segment gets through. `fetch` resolves `.`
 * and `..` segments before the request leaves this process, so an unchecked
 * `jobId=../invoices` was not a 404 — it was a call to a different backend
 * endpoint entirely, several of which fall back to the most recent job across
 * the whole service and would answer with some other firm's invoices.
 */
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export async function POST(req: Request) {
  try {
    // Bulk extraction spends paid OCR credits against the server's privileged
    // backend key. Nothing about the upload itself identifies a caller, so the
    // signed-in workspace is what stands between this route and an anonymous
    // request that bills the firm.
    const ctx = await getActiveClient();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    const response = await backendFetch("/extract/bulk", {
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
    const ctx = await getActiveClient();
    if (!ctx) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    // Reject rather than sanitise. A value that is not the backend's id shape is
    // not a job id, and quietly stripping the offending characters would turn a
    // traversal attempt into a lookup of some unrelated job.
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "Invalid jobId" }, { status: 400 });
    }

    // RESIDUAL RISK, deliberately left open: the OCR backend keys jobs on id
    // alone and has no tenant concept, and nothing on this side records which
    // (userId, clientId) a job was started for. A signed-in user who *obtains*
    // another firm's job id can therefore still read that firm's extracted
    // invoices here. Closing it needs a table mapping job id to owner, written
    // by POST above and joined on in this handler — until that exists the
    // signed-in check and the shape check are the whole boundary.
    //
    // `encodeURIComponent` on top of the pattern check is defence in depth: it
    // keeps the traversal closed if the pattern is ever widened to accommodate
    // a new backend id format.
    const response = await backendFetch(`/jobs/${encodeURIComponent(jobId)}`);

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
