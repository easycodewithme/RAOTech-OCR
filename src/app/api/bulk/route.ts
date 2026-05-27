import { NextResponse } from "next/server";
import { getMockExtraction } from "@/lib/mockData";

const createJobId = () => `job_${Math.random().toString(36).slice(2, 10)}`;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }

    const results = files.map((file) => ({
      file_name: file.name,
      success: true,
      data: getMockExtraction(file.name),
    }));

    return NextResponse.json({
      job_id: createJobId(),
      status: "completed",
      results,
    });
  } catch (error) {
    console.error("[BULK_ERROR]", error);
    return NextResponse.json({ error: "Mock bulk extraction failed" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 });
    }

    return NextResponse.json({
      job_id: jobId,
      status: "completed",
      results: [],
    });
  } catch (error) {
    console.error("[BULK_STATUS_ERROR]", error);
    return NextResponse.json({ error: "Mock job status failed" }, { status: 500 });
  }
}
