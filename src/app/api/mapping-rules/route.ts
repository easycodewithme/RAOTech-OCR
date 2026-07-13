import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import { normGstin, normKeyword, normName } from "@/lib/accounting/normalize";
import type { RuleType } from "@/lib/accounting/types";

export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const rules = await prisma.mappingRule.findMany({
      where: { userId: user.id, clientId: client.id },
      orderBy: { priority: "asc" },
      include: { ledger: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("[RULES_GET_ERROR]", error);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}

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

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

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

    const ledger = await prisma.ledger.findFirst({
      where: { id: ledgerId, userId: user.id, clientId: client.id },
    });
    if (!ledger) return NextResponse.json({ error: "Ledger not found" }, { status: 404 });

    // Preview: how many past invoices would this rule match?
    let previewCount = 0;
    if (body.preview) {
      const invoices = await prisma.invoice.findMany({
        where: { userId: user.id, clientId: client.id },
        select: { vendor: true, vendorGstin: true, items: true },
        take: 500,
      });
      for (const inv of invoices) {
        if (ruleType === "GSTIN_EQUALS" && normGstin(inv.vendorGstin) === pattern) previewCount++;
        else if (ruleType === "VENDOR_NAME_EQUALS" && normName(inv.vendor) === pattern) previewCount++;
        else if (
          ruleType === "VENDOR_NAME_CONTAINS" &&
          normName(inv.vendor)?.includes(pattern)
        )
          previewCount++;
        else if (ruleType === "HSN_EQUALS" && Array.isArray(inv.items)) {
          const hit = (inv.items as any[]).some(
            (it) => String(it.hsn_code || it.hsnCode || "").replace(/\s+/g, "") === pattern
          );
          if (hit) previewCount++;
        }
      }
      if (body.previewOnly) {
        return NextResponse.json({ previewCount });
      }
    }

    const rule = await prisma.mappingRule.create({
      data: {
        userId: user.id,
        clientId: client.id,
        ruleType,
        pattern,
        ledgerId,
        priority,
      },
      include: { ledger: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ rule, previewCount });
  } catch (error) {
    console.error("[RULES_POST_ERROR]", error);
    return NextResponse.json({ error: "Failed to create rule" }, { status: 500 });
  }
}
