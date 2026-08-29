import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { applyRules, listRules } from "@/lib/bank/rules";
import { requireStatement } from "../../_shared";

/**
 * POST /api/bank/rules/apply
 * Body: { statementId, txnIds?, dryRun?: boolean, overwrite?: boolean }
 *
 * Run the workspace's rule list over a statement.
 *
 * `dryRun` is the default posture in the UI: a CA firm will not let an
 * automation loose over three hundred rows of a client's books without first
 * being told how many rows it is about to touch and which ledger each is going
 * to. That preview is the difference between a rules engine and a black box,
 * and it is the reason rules are worth having alongside the learned
 * suggestions at all.
 *
 * Rows that already carry a ledger are left alone unless `overwrite` is set —
 * a rule is not entitled to overrule a human who has already chosen.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      statementId?: unknown;
      txnIds?: unknown;
      dryRun?: unknown;
      overwrite?: unknown;
    };

    const statementId = String(body.statementId ?? "").trim();
    if (!statementId) {
      return NextResponse.json({ error: "statementId is required" }, { status: 400 });
    }

    const ctx = await requireStatement(statementId);
    if ("error" in ctx) return ctx.error;
    const { userId, clientId, statement } = ctx;

    const dryRun = body.dryRun !== false;
    const overwrite = body.overwrite === true;
    const txnIds = Array.isArray(body.txnIds)
      ? body.txnIds.map((v) => String(v ?? "")).filter(Boolean)
      : [];

    const rules = await listRules(prisma, userId, clientId);
    if (!rules.length) {
      return NextResponse.json({ applied: 0, suggestions: [], unresolved: [], dryRun });
    }

    const [txns, ledgers] = await Promise.all([
      prisma.bankTxn.findMany({
        where: {
          statementId: statement.id,
          // A row that is already a voucher is out of scope for any automation.
          voucherId: null,
          ...(txnIds.length ? { id: { in: txnIds } } : {}),
        },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          description: true,
          withdrawal: true,
          deposit: true,
          classification: true,
          ledgerId: true,
        },
      }),
      prisma.ledger.findMany({
        where: { userId, clientId },
        select: { id: true, name: true },
      }),
    ]);

    const suggestions = applyRules(rules, txns, { ledgers, onlyUnassigned: !overwrite });

    // A rule whose ledger name has no match here is reported, never guessed at
    // and never auto-created. See `resolveRuleLedger`.
    const unresolved = [
      ...new Set(suggestions.filter((s) => !s.ledgerId).map((s) => s.ledgerName)),
    ];
    const actionable = suggestions.filter((s) => s.ledgerId);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        applied: 0,
        wouldApply: actionable.length,
        suggestions,
        unresolved,
      });
    }

    // Grouped by target ledger: one `updateMany` per distinct ledger instead of
    // one per row. A ruleset over a month's statement is typically five ledgers
    // and three hundred rows.
    const byLedger = new Map<string, string[]>();
    for (const s of actionable) {
      const list = byLedger.get(s.ledgerId as string);
      if (list) list.push(s.txnId);
      else byLedger.set(s.ledgerId as string, [s.txnId]);
    }
    const nameById = new Map(ledgers.map((l) => [l.id, l.name]));

    let applied = 0;
    for (const [ledgerId, ids] of byLedger) {
      const res = await prisma.bankTxn.updateMany({
        where: { id: { in: ids }, statementId: statement.id, voucherId: null },
        data: {
          ledgerId,
          ledgerNameSnapshot: nameById.get(ledgerId) ?? null,
          // A rule replaces a split outright, the same way a single ledger does
          // on the assign route.
          allocations: Prisma.DbNull,
          // Rules never save. The user still has to look at what the rule did
          // and commit it — that is the point of the gate.
          saved: false,
          savedAt: null,
        },
      });
      applied += res.count;
    }

    return NextResponse.json({
      dryRun: false,
      applied,
      suggestions,
      unresolved,
      ...(unresolved.length
        ? {
            warning: `${unresolved.length} rule(s) name a ledger this workspace does not have: ${unresolved.join(", ")}. Those rows were left blank.`,
          }
        : {}),
    });
  } catch (error) {
    console.error("[BANK_RULES_APPLY]", error);
    return NextResponse.json({ error: "Failed to apply rules" }, { status: 500 });
  }
}
