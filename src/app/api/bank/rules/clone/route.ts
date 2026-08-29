import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import {
  cloneRules,
  listRules,
  newRuleId,
  previewClone,
  putRules,
} from "@/lib/bank/rules";

/**
 * POST /api/bank/rules/clone
 * Body: { targetClientId, dryRun?: boolean, replace?: boolean }
 *
 * Copy this workspace's rule list onto another client.
 *
 * This is the feature the whole name-based design exists to serve. A firm keeps
 * one bank-charges / UPI / NEFT / interest ruleset and wants it on every client
 * whose statements they process; doing that by hand for two hundred clients is
 * the reason nobody does it. Because a rule names its ledger rather than
 * pointing at a row, the same list means the same thing in every workspace that
 * has ledgers by those names.
 *
 * `dryRun` reports, before anything is written, which ledger names the target
 * already has and which it does not — the one thing the competitor's Clone Rule
 * dialogue does not tell you (`rule-cloning-in-banking.md`), and the reason
 * their users find out about a missing ledger as a row that stayed blank.
 */
export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
      targetClientId?: unknown;
      dryRun?: unknown;
      replace?: unknown;
    };

    const targetClientId = String(body.targetClientId ?? "").trim();
    if (!targetClientId) {
      return NextResponse.json({ error: "targetClientId is required" }, { status: 400 });
    }
    if (targetClientId === client.id) {
      return NextResponse.json(
        { error: "That is the workspace the rules are already in." },
        { status: 400 }
      );
    }

    // Ownership, not just existence. Cloning is a write into another workspace,
    // so the target has to belong to the same user.
    const target = await prisma.client.findFirst({
      where: { id: targetClientId, userId: user.id },
      select: { id: true, name: true },
    });
    if (!target) {
      return NextResponse.json({ error: "Target workspace not found" }, { status: 404 });
    }

    const rules = await listRules(prisma, user.id, client.id);
    if (!rules.length) {
      return NextResponse.json({ error: "There are no rules to clone." }, { status: 404 });
    }

    const targetLedgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: target.id },
      select: { id: true, name: true },
    });
    const report = previewClone(rules, targetLedgers);

    if (body.dryRun !== false) {
      return NextResponse.json({
        dryRun: true,
        target: target.name,
        ruleCount: rules.length,
        ...report,
      });
    }

    // Cloned rules get fresh ids and keep their order. Nothing else changes —
    // in particular the ledger names are copied verbatim, because rewriting
    // them to whatever the target happens to have would turn a portable rule
    // into a per-client one and hide the missing ledgers this report names.
    const copies = cloneRules(rules, newRuleId);
    const existing = body.replace === true ? [] : await listRules(prisma, user.id, target.id);
    await putRules(prisma, user.id, target.id, [...existing, ...copies]);

    return NextResponse.json({
      dryRun: false,
      target: target.name,
      cloned: copies.length,
      ...report,
      ...(report.unresolved.length
        ? {
            warning: `${target.name} has no ledger named ${report.unresolved.join(", ")}. Those rules are in place but will not fire until the ledger exists.`,
          }
        : {}),
    });
  } catch (error) {
    console.error("[BANK_RULES_CLONE]", error);
    return NextResponse.json({ error: "Failed to clone the rules" }, { status: 500 });
  }
}
