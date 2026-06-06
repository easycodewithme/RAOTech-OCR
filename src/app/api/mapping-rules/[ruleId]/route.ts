import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";

// PATCH /api/mapping-rules/[ruleId] — toggle enabled / change priority
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ruleId } = await params;

    const existing = await prisma.mappingRule.findFirst({
      where: { id: ruleId, userId: user.id },
    });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const body = await req.json();
    const rule = await prisma.mappingRule.update({
      where: { id: ruleId },
      data: {
        enabled: body.enabled ?? existing.enabled,
        priority: body.priority != null ? Number(body.priority) : existing.priority,
      },
      include: { ledger: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ rule });
  } catch (error) {
    console.error("[RULE_PATCH_ERROR]", error);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}

// DELETE /api/mapping-rules/[ruleId]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { ruleId } = await params;

    const existing = await prisma.mappingRule.findFirst({
      where: { id: ruleId, userId: user.id },
    });
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await prisma.mappingRule.delete({ where: { id: ruleId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[RULE_DELETE_ERROR]", error);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
