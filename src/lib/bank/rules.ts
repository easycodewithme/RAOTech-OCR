import type { PrismaClient, RuleType } from "@prisma/client";
import { normName } from "../accounting/normalize";
import { defaultBankVoucherType } from "../accounting/buildBankVoucher";

/**
 * The explicit, user-visible rule list — the *other* half of bank ledger
 * assignment.
 *
 * We already learn from what the accountant does: `suggestLedgerFromNarrationMemory`
 * in `classify.ts` reads `LedgerMapping` rows and guesses. That is a classifier,
 * and a classifier alone is not auditable. Vyapar TaxOne ships both mechanisms
 * side by side and the FAQ corpus keeps them strictly apart — "Suggested Ledgers
 * (AI narration -> ledger memory)" is one feature, and "Rule List … an explicit
 * rules engine, separate from the AI suggestions" with columns
 * `Rule Type / Company / Field / Condition / Result` is another
 * (`suggested-ledgers.md`, `rule-cloning-in-banking.md`). A CA firm signing off
 * on a client's books needs to be able to point at the line that produced a
 * posting; "the model suggested it" is not that line.
 *
 * The distinction this module keeps:
 *
 *   memory  — implicit, learned, per-workspace, weighted by hit count,
 *             invisible until it fires, `mappedVia: NARRATION_MEMORY`
 *   rules   — explicit, written by a human, ordered, listable, deletable,
 *             portable between workspaces, `mappedVia: RULE`
 *
 * A rule always wins over memory when both fire. The user wrote it down.
 */

export type BankRuleField = "narration" | "amount" | "type";
export type BankRuleCondition = "contains" | "equals" | "gt" | "lt";

export interface BankRule {
  id: string;
  field: BankRuleField;
  condition: BankRuleCondition;
  /** Free text for `narration`/`type`; a number written as text for `amount`. */
  value: string;
  /**
   * The target ledger's NAME, never its id.
   *
   * This one decision is what makes a ruleset portable. A `Ledger` row is
   * scoped `@@unique([userId, clientId, name])`, so an id is meaningless in
   * another workspace — cloning an id-based ruleset to a second client would
   * either fail its foreign key or, worse, silently point at nothing. Names
   * re-resolve. Vyapar TaxOne's rule list is cloneable across companies for
   * exactly this reason (`rule-cloning-in-banking.md`), and a bank-charges /
   * UPI / NEFT ruleset pushed across 200 clients is the single highest-leverage
   * thing in their banking module.
   *
   * The cost of names is the stale-master failure their corpus catalogues as
   * N5/N6 — rename the ledger and the mapping dangles. That is paid for by
   * `resolveRuleLedger` reporting an unresolved name loudly rather than
   * substituting anything.
   */
  ledgerName: string;
  /** Lower runs first. Ties break on list order, so the table is the audit. */
  priority?: number;
  enabled?: boolean;
}

/** Just enough of a `BankTxn` to match against. */
export interface BankRuleTxn {
  id: string;
  description: string;
  withdrawal: number;
  deposit: number;
  /** The accountant's Payment/Receipt/Contra call, when they have made one. */
  classification?: "PAYMENT" | "RECEIPT" | "CONTRA" | null;
}

export interface LedgerNameRef {
  id: string;
  name: string;
}

export interface BankRuleSuggestion {
  txnId: string;
  /** The name the rule asked for, verbatim, even when it does not resolve. */
  ledgerName: string;
  /** Null when no ledger in the target workspace answers to that name. */
  ledgerId: string | null;
  ruleId: string;
}

/** Under half a paisa is zero, matching `buildBankVoucher`. */
const EPSILON = 0.005;

/** Which conditions each field accepts. Anything else is a malformed rule. */
const ALLOWED: Record<BankRuleField, BankRuleCondition[]> = {
  narration: ["contains", "equals"],
  amount: ["gt", "lt", "equals"],
  type: ["equals"],
};

export interface BankRuleProblem {
  field: "field" | "condition" | "value" | "ledgerName";
  message: string;
}

function isVoucherClass(v: string): boolean {
  const up = v.trim().toUpperCase();
  return up === "PAYMENT" || up === "RECEIPT" || up === "CONTRA";
}

/** A rule the engine will refuse to run, and why, in the user's terms. */
export function validateRule(rule: Partial<BankRule>): BankRuleProblem[] {
  const problems: BankRuleProblem[] = [];

  const field = rule.field;
  const knownField = !!field && field in ALLOWED;
  if (!knownField) {
    problems.push({
      field: "field",
      message: "Choose what the rule looks at: narration, amount or type.",
    });
  }

  const condition = rule.condition;
  if (knownField && (!condition || !ALLOWED[field as BankRuleField].includes(condition))) {
    problems.push({
      field: "condition",
      message: `A ${field} rule can only use ${ALLOWED[field as BankRuleField].join(" or ")}.`,
    });
  }

  const value = (rule.value ?? "").trim();
  if (!value) {
    problems.push({ field: "value", message: "The rule has nothing to match on." });
  } else if (field === "amount" && !Number.isFinite(Number(value))) {
    problems.push({ field: "value", message: `"${value}" is not an amount.` });
  } else if (field === "type" && !isVoucherClass(value)) {
    problems.push({
      field: "value",
      message: `A type rule matches Payment, Receipt or Contra — not "${value}".`,
    });
  }

  if (!(rule.ledgerName ?? "").trim()) {
    problems.push({ field: "ledgerName", message: "The rule has no target ledger." });
  }

  return problems;
}

/** The amount a statement line is "worth": one of the two columns is always zero. */
export function txnAmount(txn: Pick<BankRuleTxn, "withdrawal" | "deposit">): number {
  const w = Math.max(0, txn.withdrawal || 0);
  const d = Math.max(0, txn.deposit || 0);
  return w > EPSILON ? w : d;
}

/** What a `type` rule compares against: the override if made, else the direction. */
export function txnClass(txn: BankRuleTxn): "PAYMENT" | "RECEIPT" | "CONTRA" | null {
  return txn.classification ?? defaultBankVoucherType(txn.withdrawal, txn.deposit);
}

/**
 * Narration matching folds case and whitespace and nothing else.
 *
 * Deliberately NOT `narrationKey()`. That function strips the literal tokens
 * `upi|neft|imps|rtgs|ref|txn` and any run of six or more digits, which is
 * right for grouping recurring narrations into a memory key and catastrophic
 * for a rule: the first rule a user writes is "narration contains UPI", and
 * folding it through `narrationKey` deletes both sides of that comparison so
 * the rule matches every row in the statement.
 */
function fold(s: string): string {
  return (s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function matches(rule: BankRule, txn: BankRuleTxn): boolean {
  const value = (rule.value ?? "").trim();
  if (!value) return false;

  switch (rule.field) {
    case "narration": {
      const hay = fold(txn.description);
      const needle = fold(value);
      if (!needle) return false;
      return rule.condition === "equals" ? hay === needle : hay.includes(needle);
    }
    case "amount": {
      const target = Number(value);
      if (!Number.isFinite(target)) return false;
      const amount = txnAmount(txn);
      if (rule.condition === "gt") return amount > target + EPSILON;
      if (rule.condition === "lt") return amount < target - EPSILON;
      return Math.abs(amount - target) <= EPSILON;
    }
    case "type": {
      if (rule.condition !== "equals") return false;
      return txnClass(txn) === value.trim().toUpperCase();
    }
    default:
      return false;
  }
}

/**
 * Resolve a rule's ledger NAME against a workspace's chart of accounts.
 *
 * Three passes, narrowest first. Exact is what Tally itself does — its ledger
 * names are case-sensitive and tolerate trailing whitespace, which is why the
 * push path matches on `tallyGuid` rather than name. Here we are matching
 * inside our own database, where the user typed the rule by hand into one
 * workspace and is cloning it into another, so "Bank Charges" and
 * "Bank charges" must land on the same ledger. `normName` is the same fold the
 * invoice ledger resolver uses, so a rule and a bill agree about what counts as
 * the same party.
 *
 * Nothing is ever created here. A rule that names a ledger the workspace does
 * not have is reported as unresolved and left for a human — auto-creating
 * ledgers from a cloned ruleset is how 200 clients end up with 200 slightly
 * different charts of accounts.
 */
export function resolveRuleLedger(
  ledgerName: string,
  ledgers: LedgerNameRef[]
): LedgerNameRef | null {
  const wanted = (ledgerName ?? "").trim();
  if (!wanted) return null;

  const exact = ledgers.find((l) => l.name === wanted);
  if (exact) return exact;

  const lower = wanted.toLowerCase();
  const ci = ledgers.find((l) => l.name.trim().toLowerCase() === lower);
  if (ci) return ci;

  const key = normName(wanted);
  if (!key) return null;
  return ledgers.find((l) => normName(l.name) === key) ?? null;
}

export interface ApplyRulesOptions {
  /** The target workspace's ledgers, so names can be turned back into ids. */
  ledgers?: LedgerNameRef[];
  /** Skip rows that already carry a ledger. Default true. */
  onlyUnassigned?: boolean;
}

/**
 * First matching rule wins, ordered by priority then by position in the list.
 *
 * Deterministic and shallow on purpose: the whole point of a rule list over a
 * classifier is that a user can read it top to bottom and predict the outcome.
 * No scoring, no combining, no "best" match.
 */
export function applyRules(
  rules: BankRule[],
  txns: (BankRuleTxn & { ledgerId?: string | null })[],
  opts: ApplyRulesOptions = {}
): BankRuleSuggestion[] {
  const ledgers = opts.ledgers ?? [];
  const onlyUnassigned = opts.onlyUnassigned ?? true;

  const ordered = rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false && validateRule(rule).length === 0)
    .sort((a, b) => (a.rule.priority ?? 100) - (b.rule.priority ?? 100) || a.index - b.index)
    .map(({ rule }) => rule);

  const out: BankRuleSuggestion[] = [];
  for (const txn of txns) {
    if (onlyUnassigned && txn.ledgerId) continue;
    const hit = ordered.find((rule) => matches(rule, txn));
    if (!hit) continue;
    const resolved = resolveRuleLedger(hit.ledgerName, ledgers);
    out.push({
      txnId: txn.id,
      ledgerName: hit.ledgerName,
      ledgerId: resolved?.id ?? null,
      ruleId: hit.id,
    });
  }
  return out;
}

export interface CloneReport {
  /** Distinct ledger names the target workspace already has. */
  resolved: { ledgerName: string; ledgerId: string }[];
  /** Distinct ledger names it does not. The rules still clone; they just miss. */
  unresolved: string[];
}

/**
 * What would happen if this ruleset were pointed at another workspace.
 *
 * Cloning is the reason rules hold names, so the clone path has to be able to
 * say, before anything is written, which of the target client's ledgers the
 * ruleset will actually find. The competitor's Clone Rule dialogue asks for a
 * target company and a synchronised bank ledger and then reports nothing
 * (`rule-cloning-in-banking.md`); the first a user learns of a missing ledger
 * is a row that stayed blank.
 */
export function previewClone(rules: BankRule[], targetLedgers: LedgerNameRef[]): CloneReport {
  const resolved: CloneReport["resolved"] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    const nm = (rule.ledgerName ?? "").trim();
    if (!nm || seen.has(nm)) continue;
    seen.add(nm);
    const hit = resolveRuleLedger(nm, targetLedgers);
    if (hit) resolved.push({ ledgerName: nm, ledgerId: hit.id });
    else unresolved.push(nm);
  }

  return { resolved, unresolved };
}

/** Copy a ruleset for another workspace: new ids, same names, same order. */
export function cloneRules(rules: BankRule[], makeId: () => string): BankRule[] {
  return rules.map((rule, i) => ({
    ...rule,
    id: makeId(),
    priority: rule.priority ?? 100 + i,
  }));
}


/* ---------------------------------------------------------------- storage */

/**
 * Rules are rows in `MappingRule`, scoped BANK.
 *
 * They used to live in a process-memory `Map`, which meant a firm's ruleset —
 * the thing that is supposed to be cloned across two hundred clients — vanished
 * on the next server restart or cold serverless instance. Three things were in
 * the way, and the `20260827010000_bank_rules_durable` migration removed all
 * three: `RuleType` had no member for narration, amount or voucher type;
 * `ledgerId` was a required FK when a bank rule deliberately holds a *name*;
 * and `resolveLedgersForInvoice` read every rule in the workspace with no
 * discriminator, so bank rules stored there would have started deciding ledgers
 * for scanned bills. `scope` is that discriminator and every reader now filters
 * on it.
 *
 * The `(field, condition)` pair the UI speaks is stored as one `ruleType`
 * member. Keeping the pair in the API and collapsing it in the database is
 * deliberate: the pair is what a rule *editor* needs (pick a field, then the
 * conditions that field allows), and a single enum is what an index and a
 * `where` clause need.
 */


/** The `(field, condition)` pairs that have a `RuleType`, in both directions. */
const RULE_TYPE_BY_PAIR: Record<string, RuleType> = {
  "narration:contains": "NARRATION_CONTAINS",
  "narration:equals": "NARRATION_EQUALS",
  "amount:gt": "AMOUNT_GT",
  "amount:lt": "AMOUNT_LT",
  "amount:equals": "AMOUNT_EQUALS",
  "type:equals": "TXN_TYPE_EQUALS",
};

const PAIR_BY_RULE_TYPE: Partial<
  Record<RuleType, { field: BankRuleField; condition: BankRuleCondition }>
> = {
  NARRATION_CONTAINS: { field: "narration", condition: "contains" },
  NARRATION_EQUALS: { field: "narration", condition: "equals" },
  AMOUNT_GT: { field: "amount", condition: "gt" },
  AMOUNT_LT: { field: "amount", condition: "lt" },
  AMOUNT_EQUALS: { field: "amount", condition: "equals" },
  TXN_TYPE_EQUALS: { field: "type", condition: "equals" },
};

/** The stored enum member for a rule, or null if the pair is not a bank rule. */
export function ruleTypeFor(
  field: BankRuleField,
  condition: BankRuleCondition
): RuleType | null {
  return RULE_TYPE_BY_PAIR[`${field}:${condition}`] ?? null;
}

/** The inverse. Null for the four invoice rule types, which are not ours. */
export function pairFor(
  ruleType: RuleType
): { field: BankRuleField; condition: BankRuleCondition } | null {
  return PAIR_BY_RULE_TYPE[ruleType] ?? null;
}

/** The columns of a `MappingRule` row a bank rule is made of. */
export interface StoredRuleRow {
  id: string;
  ruleType: RuleType;
  pattern: string;
  ledgerName: string | null;
  priority: number;
  enabled: boolean;
}

/**
 * A stored row back into a `BankRule`.
 *
 * Returns null rather than throwing for a row it cannot read — an invoice rule
 * that somehow carries `scope: BANK`, or a `ruleType` added to the enum after
 * this code was written. A ruleset that silently drops one unreadable row is
 * recoverable; one that 500s the whole banking screen is not.
 */
export function toBankRule(row: StoredRuleRow): BankRule | null {
  const pair = pairFor(row.ruleType);
  if (!pair) return null;
  return {
    id: row.id,
    field: pair.field,
    condition: pair.condition,
    value: row.pattern,
    ledgerName: row.ledgerName ?? "",
    priority: row.priority,
    enabled: row.enabled,
  };
}

const RULE_SELECT = {
  id: true,
  ruleType: true,
  pattern: true,
  ledgerName: true,
  priority: true,
  enabled: true,
} as const;

export async function listRules(
  db: PrismaClient,
  userId: string,
  clientId: string
): Promise<BankRule[]> {
  const rows = await db.mappingRule.findMany({
    where: { userId, clientId, scope: "BANK" },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: RULE_SELECT,
  });
  return rows.map(toBankRule).filter((r): r is BankRule => r !== null);
}

export async function addRule(
  db: PrismaClient,
  userId: string,
  clientId: string,
  rule: Omit<BankRule, "id"> & { id?: string }
): Promise<BankRule> {
  const ruleType = ruleTypeFor(rule.field, rule.condition);
  if (!ruleType) {
    throw new Error(`A ${rule.field} rule cannot use ${rule.condition}.`);
  }

  // New rules go to the end of the list unless told otherwise. Counting is
  // cheap here and keeps the default order the one the user typed them in.
  const priority =
    rule.priority ??
    100 + (await db.mappingRule.count({ where: { userId, clientId, scope: "BANK" } }));

  const row = await db.mappingRule.create({
    data: {
      userId,
      clientId,
      scope: "BANK",
      ruleType,
      pattern: rule.value,
      // Null, not the id: a bank rule names its ledger so the ruleset can be
      // cloned onto another client. Resolution happens at read time.
      ledgerId: null,
      ledgerName: rule.ledgerName,
      priority,
      enabled: rule.enabled ?? true,
    },
    select: RULE_SELECT,
  });

  const created = toBankRule(row);
  if (!created) throw new Error("The rule was stored but could not be read back.");
  return created;
}

/** Replace a workspace's whole bank ruleset. Used by the clone path. */
export async function putRules(
  db: PrismaClient,
  userId: string,
  clientId: string,
  rules: BankRule[]
): Promise<BankRule[]> {
  const rows = rules
    .map((rule, i) => {
      const ruleType = ruleTypeFor(rule.field, rule.condition);
      if (!ruleType) return null;
      return {
        userId,
        clientId,
        scope: "BANK" as const,
        ruleType,
        pattern: rule.value,
        ledgerId: null,
        ledgerName: rule.ledgerName,
        priority: rule.priority ?? 100 + i,
        enabled: rule.enabled ?? true,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  // One transaction: a clone that deleted the target's rules and then failed to
  // write the replacements would leave the client with no rules at all.
  await db.$transaction([
    db.mappingRule.deleteMany({ where: { userId, clientId, scope: "BANK" } }),
    ...(rows.length ? [db.mappingRule.createMany({ data: rows })] : []),
  ]);

  return listRules(db, userId, clientId);
}

export async function removeRule(
  db: PrismaClient,
  userId: string,
  clientId: string,
  ruleId: string
): Promise<boolean> {
  // Scoped to the workspace AND to BANK, so this endpoint cannot be used to
  // delete an invoice ledger rule by guessing its id.
  const { count } = await db.mappingRule.deleteMany({
    where: { id: ruleId, userId, clientId, scope: "BANK" },
  });
  return count > 0;
}

export function newRuleId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `rule-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`
  );
}
