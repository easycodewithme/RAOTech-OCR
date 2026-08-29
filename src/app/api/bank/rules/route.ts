import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getActiveClient } from "@/lib/clientContext";
import {
  addRule,
  listRules,
  previewClone,
  resolveRuleLedger,
  validateRule,
  type BankRule,
  type BankRuleCondition,
  type BankRuleField,
} from "@/lib/bank/rules";

/**
 * GET  /api/bank/rules   — the workspace's rule list, in the order it runs
 * POST /api/bank/rules   — add one
 *
 * The rule list is the auditable half of ledger assignment. It sits beside the
 * learned narration memory rather than replacing it: memory is what the app
 * noticed, rules are what the firm decided. Every row here was typed by a
 * person, runs in a stated order, and names its target ledger by name so the
 * whole list can be cloned onto the next client.
 *
 * Rules are stored in `MappingRule` under `scope: BANK`, which is what keeps
 * them out of the invoice ledger resolver. See the storage note in
 * `lib/bank/rules.ts`.
 */
export async function GET() {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const rules = await listRules(prisma, user.id, client.id);
    const ledgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: client.id },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    // Resolve every rule's ledger name against this workspace as we hand it
    // back, so the list can show which rules would currently do nothing.
    const resolved = rules.map((r) => ({
      ...r,
      ledgerId: resolveRuleLedger(r.ledgerName, ledgers)?.id ?? null,
    }));

    return NextResponse.json({
      rules: resolved,
      unresolved: previewClone(rules, ledgers).unresolved,
      durable: true,
    });
  } catch (error) {
    console.error("[BANK_RULES_GET]", error);
    return NextResponse.json({ error: "Failed to load rules" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getActiveClient();
    if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { user, client } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    /**
     * A rule may name a ledger this workspace does not have yet, and that is
     * allowed. A ruleset is often written against the chart a firm intends to
     * use, or pasted in from another client before the ledgers are created.
     * The rule is stored, reported as unresolved, and starts working the moment
     * a matching ledger exists — which is the whole reason it holds a name.
     */
    const draft: Partial<BankRule> = {
      field: body.field as BankRuleField,
      condition: body.condition as BankRuleCondition,
      value: typeof body.value === "string" ? body.value : String(body.value ?? ""),
      ledgerName: String(body.ledgerName ?? "").trim(),
      priority: body.priority == null ? undefined : Number(body.priority),
      enabled: body.enabled == null ? true : body.enabled !== false,
    };

    const problems = validateRule(draft);
    if (problems.length) {
      return NextResponse.json({ error: problems[0].message, problems }, { status: 400 });
    }

    const rule = await addRule(prisma, user.id, client.id, draft as Omit<BankRule, "id">);

    const ledgers = await prisma.ledger.findMany({
      where: { userId: user.id, clientId: client.id },
      select: { id: true, name: true },
    });
    const target = resolveRuleLedger(rule.ledgerName, ledgers);

    return NextResponse.json({
      rule: { ...rule, ledgerId: target?.id ?? null },
      ...(target
        ? {}
        : {
            warning: `No ledger named "${rule.ledgerName}" exists in this workspace yet, so this rule will not fire until one does.`,
          }),
    });
  } catch (error) {
    console.error("[BANK_RULES_POST]", error);
    return NextResponse.json({ error: "Failed to create the rule" }, { status: 500 });
  }
}
