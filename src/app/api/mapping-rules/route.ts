import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDbUser } from "@/lib/getDbUser";
import { normGstin, normKeyword, normName } from "@/lib/accounting/normalize";
import type { RuleType } from "@/lib/accounting/types";

// GET /api/mapping-rules — list user-defined mapping rules
export async function GET() {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rules = await prisma.mappingRule.findMany({
      where: { userId: user.id, clientId: "" },
      orderBy: { priority: "asc" },
      include: { ledger: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("[RULES_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}

/** Normalize the rule pattern according to its type so matching is consistent. */
function normalizePattern(ruleType: RuleType, raw: string): string {
  switch (ruleType) {
    case "GSTIN_EQUALS":
      return normGstin(raw) ?? "";
    case "VENDOR_NAME_EQUALS":
      return normName(raw) ?? "";
    case "VENDOR_NAME_CONTAINS":
      return normKeyword(raw);
    case "HSN_EQUALS":
      return raw.replace(/\s+/g, "");
    default:
      return raw.trim();
  }
}

// POST /api/mapping-rules — create a rule
export async function POST(req: Request) {
  try {
    const user = await getDbUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const ruleType = body.ruleType as RuleType;
    const ledgerId = String(body.ledgerId ?? "");
    const rawPattern = String(body.pattern ?? "");
    const priority = body.priority != null ? Number(body.priority) : 100;

    if (!ruleType || !ledgerId || !rawPattern.trim()) {
      return NextResponse.json(
        { error: "ruleType, pattern and ledgerId are required" },
        { status: 400 }
      );
    }
    const pattern = normalizePattern(ruleType, rawPattern);
    if (!pattern) return NextResponse.json({ error: "Invalid pattern" }, { status: 400 });

    // Verify the ledger belongs to this user
    const ledger = await prisma.ledger.findFirst({
      where: { id: ledgerId, userId: user.id },
    });
    if (!ledger) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    const rule = await prisma.mappingRule.create({
      data: { userId: user.id, clientId: "", ruleType, pattern, ledgerId, priority },
      include: { ledger: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ rule });
  } catch (error) {
    console.error("[RULES_POST_ERROR]", error);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}
