import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
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
        client: {
          select: {
            id: true,
            name: true,
            gstin: true,
          },
        },
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });

    if (!link) {
      return NextResponse.json({ error: "Intake link not found" }, { status: 404 });
    }

    if (!link.enabled) {
      return NextResponse.json(
        { error: "This intake link has been deactivated by your accountant." },
        { status: 403 }
      );
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This intake link has expired. Please request a new link." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      valid: true,
      label: link.label || `${link.client.name} Document Intake`,
      client: {
        id: link.client.id,
        name: link.client.name,
        gstin: link.client.gstin,
      },
      accountant: {
        name: link.user.name || "RAOTech Accounting Team",
      },
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    console.error("[INTAKE_INFO_GET]", error);
    return NextResponse.json({ error: "Failed to load link information" }, { status: 500 });
  }
}
