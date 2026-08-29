import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { removeRule } from "@/lib/bank/rules";

/** DELETE /api/bank/rules/{ruleId} — drop one rule from the workspace's list. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ ruleId: string }> }
) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;
    const { ruleId } = await params;

    // Scoped by workspace, so a rule id guessed from another client's list
    // finds nothing rather than deleting theirs.
    const removed = await removeRule(prisma, user.id, client.id, ruleId);
    if (!removed) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[BANK_RULE_DELETE]", error);
    return NextResponse.json({ error: "Failed to delete the rule" }, { status: 500 });
  }
}
