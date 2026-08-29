import { describe, it, expect } from "vitest";
import {
  applyRules,
  cloneRules,
  pairFor,
  previewClone,
  resolveRuleLedger,
  ruleTypeFor,
  toBankRule,
  txnAmount,
  txnClass,
  validateRule,
  type BankRule,
  type BankRuleTxn,
} from "../rules";
import { narrationKey } from "../classify";

const rule = (o: Partial<BankRule> = {}): BankRule => ({
  id: o.id ?? "r1",
  field: o.field ?? "narration",
  condition: o.condition ?? "contains",
  value: o.value ?? "bank charges",
  ledgerName: o.ledgerName ?? "Bank Charges",
  priority: o.priority,
  enabled: o.enabled,
});

const txn = (o: Partial<BankRuleTxn> & { id: string }): BankRuleTxn => ({
  description: "",
  withdrawal: 0,
  deposit: 0,
  ...o,
});

describe("validateRule", () => {
  it("accepts the three legal field/condition pairings", () => {
    expect(validateRule(rule({ field: "narration", condition: "contains" }))).toEqual([]);
    expect(validateRule(rule({ field: "amount", condition: "gt", value: "500" }))).toEqual([]);
    expect(validateRule(rule({ field: "type", condition: "equals", value: "CONTRA" }))).toEqual([]);
  });

  it("refuses a condition the field cannot use", () => {
    const problems = validateRule(rule({ field: "narration", condition: "gt" }));
    expect(problems.map((p) => p.field)).toContain("condition");
  });

  it("refuses an amount rule whose value is not a number", () => {
    const problems = validateRule(rule({ field: "amount", condition: "gt", value: "lots" }));
    expect(problems[0].message).toMatch(/not an amount/i);
  });

  it("refuses a type rule naming something that is not a voucher type", () => {
    const problems = validateRule(rule({ field: "type", condition: "equals", value: "SALE" }));
    expect(problems[0].message).toMatch(/Payment, Receipt or Contra/);
  });

  it("refuses a rule with no target ledger", () => {
    const problems = validateRule(rule({ ledgerName: "   " }));
    expect(problems.map((p) => p.field)).toContain("ledgerName");
  });
});

describe("narration matching", () => {
  const ledgers = [{ id: "L_CHG", name: "Bank Charges" }];

  it("matches case- and whitespace-insensitively", () => {
    const hits = applyRules(
      [rule({ value: "BANK   CHARGES" })],
      [txn({ id: "t1", description: "Sundry bank charges  Jul", withdrawal: 118 })],
      { ledgers }
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].ledgerId).toBe("L_CHG");
  });

  /**
   * The bug this guards against: folding a rule through `narrationKey` deletes
   * the very token the user typed. `narrationKey` strips UPI/NEFT/IMPS/RTGS
   * because it is building a memory key, not evaluating a rule.
   */
  it('a rule for "UPI" matches only UPI rows, even though narrationKey strips the word', () => {
    expect(narrationKey("UPI/DR/402913844/RELIANCE")).not.toContain("upi");

    const hits = applyRules(
      [rule({ value: "UPI", ledgerName: "Suspense" })],
      [
        txn({ id: "t1", description: "UPI/DR/402913844/RELIANCE", withdrawal: 500 }),
        txn({ id: "t2", description: "NEFT CR SALARY", deposit: 50000 }),
      ],
      { ledgers: [{ id: "L_SUS", name: "Suspense" }] }
    );
    expect(hits.map((h) => h.txnId)).toEqual(["t1"]);
  });

  it("equals is exact, contains is not", () => {
    const rows = [txn({ id: "t1", description: "ATM WDL", withdrawal: 2000 })];
    expect(applyRules([rule({ condition: "equals", value: "ATM" })], rows)).toHaveLength(0);
    expect(applyRules([rule({ condition: "equals", value: "atm wdl" })], rows)).toHaveLength(1);
    expect(applyRules([rule({ condition: "contains", value: "atm" })], rows)).toHaveLength(1);
  });
});

describe("amount and type matching", () => {
  it("reads the amount from whichever column is non-zero", () => {
    expect(txnAmount({ withdrawal: 0, deposit: 900 })).toBe(900);
    expect(txnAmount({ withdrawal: 250, deposit: 0 })).toBe(250);
  });

  it("gt / lt / equals behave at the boundary", () => {
    const rows = [txn({ id: "t1", withdrawal: 500, description: "x" })];
    expect(applyRules([rule({ field: "amount", condition: "gt", value: "500" })], rows)).toHaveLength(0);
    expect(applyRules([rule({ field: "amount", condition: "lt", value: "500" })], rows)).toHaveLength(0);
    expect(applyRules([rule({ field: "amount", condition: "equals", value: "500" })], rows)).toHaveLength(1);
    expect(applyRules([rule({ field: "amount", condition: "gt", value: "499.99" })], rows)).toHaveLength(1);
  });

  it("a type rule sees the accountant's override, not just the direction", () => {
    const transfer = txn({ id: "t1", withdrawal: 10000, description: "SELF TRANSFER" });
    expect(txnClass(transfer)).toBe("PAYMENT");
    expect(txnClass({ ...transfer, classification: "CONTRA" })).toBe("CONTRA");

    const contraRule = rule({ field: "type", condition: "equals", value: "CONTRA", ledgerName: "HDFC" });
    expect(applyRules([contraRule], [transfer])).toHaveLength(0);
    expect(applyRules([contraRule], [{ ...transfer, classification: "CONTRA" }])).toHaveLength(1);
  });
});

describe("ordering and scope", () => {
  it("first match wins, by priority then by list order", () => {
    const rules = [
      rule({ id: "late", value: "charge", ledgerName: "Late", priority: 200 }),
      rule({ id: "early", value: "charge", ledgerName: "Early", priority: 10 }),
    ];
    const hits = applyRules(rules, [txn({ id: "t1", description: "bank charge", withdrawal: 50 })]);
    expect(hits[0].ruleId).toBe("early");
  });

  it("skips disabled and malformed rules rather than throwing", () => {
    const rules = [
      rule({ id: "off", enabled: false, ledgerName: "Off" }),
      rule({ id: "broken", field: "amount", condition: "contains", value: "x", ledgerName: "Broken" }),
      rule({ id: "good", ledgerName: "Good" }),
    ];
    const hits = applyRules(rules, [txn({ id: "t1", description: "BANK CHARGES", withdrawal: 50 })]);
    expect(hits[0].ruleId).toBe("good");
  });

  it("leaves a row that already has a ledger alone unless told otherwise", () => {
    const rows = [
      { ...txn({ id: "t1", description: "BANK CHARGES", withdrawal: 50 }), ledgerId: "L_OTHER" },
    ];
    expect(applyRules([rule()], rows)).toHaveLength(0);
    expect(applyRules([rule()], rows, { onlyUnassigned: false })).toHaveLength(1);
  });
});

describe("name resolution", () => {
  const ledgers = [
    { id: "L1", name: "Bank Charges" },
    { id: "L2", name: "Reliance Industries Ltd" },
  ];

  it("prefers an exact name", () => {
    expect(resolveRuleLedger("Bank Charges", ledgers)?.id).toBe("L1");
  });

  it("falls back to case and whitespace", () => {
    expect(resolveRuleLedger("  bank charges ", ledgers)?.id).toBe("L1");
  });

  it("falls back to the same fold the invoice resolver uses", () => {
    // normName drops legal suffixes, so "Reliance Industries" finds the Ltd.
    expect(resolveRuleLedger("Reliance Industries", ledgers)?.id).toBe("L2");
  });

  it("returns null rather than guessing", () => {
    expect(resolveRuleLedger("Electricity", ledgers)).toBeNull();
  });
});

describe("portability across workspaces", () => {
  /**
   * The whole reason a rule stores a name. Client A's "Bank Charges" is
   * `L_A_CHG`; client B's is `L_B_CHG`. The same ruleset has to land on the
   * right ledger in both without being rewritten.
   */
  const rules = [
    rule({ id: "r1", value: "bank charges", ledgerName: "Bank Charges" }),
    rule({ id: "r2", value: "neft", ledgerName: "Suspense" }),
  ];
  const clientA = [
    { id: "L_A_CHG", name: "Bank Charges" },
    { id: "L_A_SUS", name: "Suspense" },
  ];
  const clientB = [
    { id: "L_B_CHG", name: "bank charges" },
    { id: "L_B_SUS", name: "Suspense" },
  ];

  const rows = [
    txn({ id: "t1", description: "SUNDRY BANK CHARGES", withdrawal: 118 }),
    txn({ id: "t2", description: "NEFT CR ACME", deposit: 25000 }),
  ];

  it("resolves to each workspace's own ledger ids", () => {
    expect(applyRules(rules, rows, { ledgers: clientA }).map((h) => h.ledgerId)).toEqual([
      "L_A_CHG",
      "L_A_SUS",
    ]);
    expect(applyRules(rules, rows, { ledgers: clientB }).map((h) => h.ledgerId)).toEqual([
      "L_B_CHG",
      "L_B_SUS",
    ]);
  });

  it("reports the ledgers a target workspace is missing before anything is written", () => {
    const report = previewClone(rules, [{ id: "L_C_CHG", name: "Bank Charges" }]);
    expect(report.resolved).toEqual([{ ledgerName: "Bank Charges", ledgerId: "L_C_CHG" }]);
    expect(report.unresolved).toEqual(["Suspense"]);
  });

  it("a clone keeps the names verbatim and takes fresh ids", () => {
    let n = 0;
    const copies = cloneRules(rules, () => `new-${++n}`);
    expect(copies.map((r) => r.id)).toEqual(["new-1", "new-2"]);
    expect(copies.map((r) => r.ledgerName)).toEqual(rules.map((r) => r.ledgerName));
    // And they still resolve, in a workspace whose ids share nothing with A's.
    expect(applyRules(copies, rows, { ledgers: clientB }).map((h) => h.ledgerId)).toEqual([
      "L_B_CHG",
      "L_B_SUS",
    ]);
  });

  it("a rule naming a ledger the target does not have reports rather than inventing one", () => {
    const hits = applyRules(rules, rows, { ledgers: [{ id: "L_X", name: "Bank Charges" }] });
    const suspense = hits.find((h) => h.ledgerName === "Suspense");
    expect(suspense?.ledgerId).toBeNull();
    expect(suspense?.ledgerName).toBe("Suspense");
  });
});

/**
 * Rules are `MappingRule` rows now, not a `Map` that died with the process.
 * The part that can silently go wrong is the codec: `(field, condition)` is
 * collapsed into one `ruleType` on the way in and expanded on the way out, and
 * a pair with no enum member — or an enum member with no pair — loses a rule.
 * The queries themselves are exercised end to end against Postgres.
 */
describe("rule storage codec", () => {
  const PAIRS: { field: "narration" | "amount" | "type"; condition: "contains" | "equals" | "gt" | "lt" }[] = [
    { field: "narration", condition: "contains" },
    { field: "narration", condition: "equals" },
    { field: "amount", condition: "gt" },
    { field: "amount", condition: "lt" },
    { field: "amount", condition: "equals" },
    { field: "type", condition: "equals" },
  ];

  it("round-trips every pair the validator accepts", () => {
    for (const p of PAIRS) {
      const rt = ruleTypeFor(p.field, p.condition);
      expect(rt, `${p.field}/${p.condition} has no RuleType`).not.toBeNull();
      expect(pairFor(rt!)).toEqual(p);
    }
  });

  /**
   * The pairs the codec knows must be exactly the pairs `validateRule` lets
   * through. A pair that validates but has no enum member is a rule the user
   * can write and the database cannot hold.
   */
  it("covers exactly the pairs the validator accepts, no more and no less", () => {
    const fields = ["narration", "amount", "type"] as const;
    const conditions = ["contains", "equals", "gt", "lt"] as const;
    for (const field of fields) {
      for (const condition of conditions) {
        const valid =
          validateRule({ field, condition, value: field === "amount" ? "10" : "PAYMENT", ledgerName: "L" })
            .length === 0;
        expect(
          ruleTypeFor(field, condition) !== null,
          `${field}/${condition}: validator says ${valid}`
        ).toBe(valid);
      }
    }
  });

  it("reads a stored row back as the rule that was written", () => {
    const rule = toBankRule({
      id: "r1",
      ruleType: "NARRATION_CONTAINS",
      pattern: "BANK CHARGES",
      ledgerName: "Bank Charges",
      priority: 50,
      enabled: true,
    });
    expect(rule).toEqual({
      id: "r1",
      field: "narration",
      condition: "contains",
      value: "BANK CHARGES",
      ledgerName: "Bank Charges",
      priority: 50,
      enabled: true,
    });
  });

  /**
   * An invoice rule that somehow carries `scope: BANK` must be dropped, not
   * mangled into a bank rule. Dropping one unreadable row keeps the banking
   * screen working; guessing at it would put a vendor-name pattern in front of
   * every statement line.
   */
  it("drops a row whose ruleType is not a bank rule", () => {
    expect(
      toBankRule({
        id: "r2",
        ruleType: "VENDOR_NAME_CONTAINS",
        pattern: "Reliance",
        ledgerName: null,
        priority: 100,
        enabled: true,
      })
    ).toBeNull();
  });

  it("a clone keeps the source ruleset intact and re-ids the copies", () => {
    const source: BankRule[] = [
      { id: "src-1", field: "narration", condition: "contains", value: "a", ledgerName: "A" },
    ];
    let n = 0;
    const copies = cloneRules(source, () => `cloned-${++n}`);
    expect(source[0].id).toBe("src-1");
    expect(copies).toHaveLength(1);
    expect(copies[0].id).toBe("cloned-1");
    expect(copies[0].ledgerName).toBe("A");
  });
});
