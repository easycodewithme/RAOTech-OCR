import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB per file
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/tiff",
];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const link = await prisma.intakeLink.findUnique({
      where: { token },
      include: {
        client: true,
      },
    });

    if (!link) {
      return NextResponse.json({ error: "Intake link not found" }, { status: 404 });
    }

    if (!link.enabled) {
      return NextResponse.json(
        { error: "This intake link has been disabled." },
        { status: 403 }
      );
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This intake link has expired." },
        { status: 410 }
      );
    }

    const formData = await req.formData();
    const rawFiles = formData.getAll("files");
    const notes = (formData.get("notes") as string) || "";

    // Handle both "files" array or single "file"
    const files: File[] = [];
    for (const item of rawFiles) {
      if (item instanceof File) files.push(item);
    }
    const singleFile = formData.get("file");
    if (singleFile instanceof File && !files.includes(singleFile)) {
      files.push(singleFile);
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const createdDocs = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 20MB size limit.` },
          { status: 400 }
        );
      }

      const mimeType = file.type || "application/octet-stream";
      const isAllowedMime =
        ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase()) ||
        file.name.toLowerCase().endsWith(".pdf") ||
        file.name.toLowerCase().endsWith(".jpg") ||
        file.name.toLowerCase().endsWith(".jpeg") ||
        file.name.toLowerCase().endsWith(".png") ||
        file.name.toLowerCase().endsWith(".webp");

      if (!isAllowedMime) {
        return NextResponse.json(
          { error: `File type "${mimeType}" is not supported. Please upload PDF or image files.` },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const base64Data = Buffer.from(arrayBuffer).toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64Data}`;

      const doc = await prisma.intakeDocument.create({
        data: {
          intakeLinkId: link.id,
          clientId: link.clientId,
          userId: link.userId,
          fileName: file.name,
          fileSize: file.size,
          mimeType,
          fileData: dataUrl,
          status: "PENDING",
          notes: notes.trim() || null,
        },
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          createdAt: true,
        },
      });

      createdDocs.push(doc);
    }

    return NextResponse.json({
      success: true,
      count: createdDocs.length,
      clientName: link.client.name,
      documents: createdDocs,
    });
  } catch (error) {
    console.error("[INTAKE_UPLOAD_POST]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload documents" },
      { status: 500 }
    );
  }
}
