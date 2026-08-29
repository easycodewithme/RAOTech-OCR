import { describe, it, expect } from "vitest";
import {
  deriveCompanyPeriod,
  indianFinancialYear,
  ledgerKey,
  mapTallyGroup,
  mapTallyLedgerType,
  parseTallyDate,
  planLedgerReconciliation,
  type ExistingLedgerRow,
  type TallyLedgerRecord,
} from "../masterSync";
import { SEED_LEDGERS } from "../../accounting/seedLedgers";

const tallyLedger = (o: Partial<TallyLedgerRecord> = {}): TallyLedgerRecord => ({
  name: "Acme Traders",
  parent: "Sundry Creditors",
  guid: "c3b1a511-a4ff-45bd-9b01-755e28443545-0000001a",
  reserved: false,
  ...o,
});

describe("mapTallyGroup", () => {
  it("maps Tally's primary groups onto the enum", () => {
    expect(mapTallyGroup("Sundry Creditors")).toBe("SUNDRY_CREDITORS");
    expect(mapTallyGroup("Sundry Debtors")).toBe("SUNDRY_DEBTORS");
    expect(mapTallyGroup("Duties & Taxes")).toBe("DUTIES_AND_TAXES");
    expect(mapTallyGroup("Purchase Accounts")).toBe("PURCHASE_ACCOUNTS");
    expect(mapTallyGroup("Sales Accounts")).toBe("SALES_ACCOUNTS");
    expect(mapTallyGroup("Direct Expenses")).toBe("DIRECT_EXPENSES");
    expect(mapTallyGroup("Indirect Expenses")).toBe("INDIRECT_EXPENSES");
    expect(mapTallyGroup("Indirect Incomes")).toBe("INDIRECT_INCOME");
    expect(mapTallyGroup("Bank Accounts")).toBe("BANK_ACCOUNTS");
    expect(mapTallyGroup("Cash-in-Hand")).toBe("CASH_IN_HAND");
    expect(mapTallyGroup("Current Assets")).toBe("CURRENT_ASSETS");
    expect(mapTallyGroup("Current Liabilities")).toBe("CURRENT_LIABILITIES");
    expect(mapTallyGroup("Fixed Assets")).toBe("FIXED_ASSETS");
  });

  it("is insensitive to case and padding, which Tally is not", () => {
    expect(mapTallyGroup("  sundry creditors ")).toBe("SUNDRY_CREDITORS");
    expect(mapTallyGroup("DUTIES AND TAXES")).toBe("DUTIES_AND_TAXES");
  });

  it("handles the spellings Tally uses interchangeably", () => {
    expect(mapTallyGroup("Cash in Hand")).toBe("CASH_IN_HAND");
    expect(mapTallyGroup("Bank OD A/c")).toBe("BANK_ACCOUNTS");
    expect(mapTallyGroup("Indirect Income")).toBe("INDIRECT_INCOME");
  });

  it("files Tally's other primary groups somewhere defensible", () => {
    expect(mapTallyGroup("Capital Account")).toBe("CURRENT_LIABILITIES");
    expect(mapTallyGroup("Secured Loans")).toBe("CURRENT_LIABILITIES");
    expect(mapTallyGroup("Provisions")).toBe("CURRENT_LIABILITIES");
    expect(mapTallyGroup("Investments")).toBe("CURRENT_ASSETS");
    expect(mapTallyGroup("Stock-in-Hand")).toBe("CURRENT_ASSETS");
    expect(mapTallyGroup("Loans & Advances (Asset)")).toBe("CURRENT_ASSETS");
  });

  it("guesses a user-created group from its name", () => {
    expect(mapTallyGroup("Site Bank Accounts")).toBe("BANK_ACCOUNTS");
    expect(mapTallyGroup("Directors Loan")).toBe("CURRENT_LIABILITIES");
    expect(mapTallyGroup("Factory Expenses")).toBe("INDIRECT_EXPENSES");
  });

  it("falls back rather than throwing on something unrecognisable", () => {
    expect(mapTallyGroup("Zzyzx")).toBe("CURRENT_ASSETS");
    expect(mapTallyGroup("")).toBe("CURRENT_ASSETS");
    expect(mapTallyGroup(null)).toBe("CURRENT_ASSETS");
    expect(mapTallyGroup(undefined)).toBe("CURRENT_ASSETS");
  });
});

describe("mapTallyLedgerType", () => {
  it("splits input and output GST, which share one Tally group", () => {
    expect(mapTallyLedgerType("DUTIES_AND_TAXES", "CGST Input")).toBe("TAX_INPUT");
    expect(mapTallyLedgerType("DUTIES_AND_TAXES", "IGST Output")).toBe("TAX_OUTPUT");
  });

  it("derives the rest from the group", () => {
    expect(mapTallyLedgerType("SUNDRY_CREDITORS", "Acme")).toBe("PARTY");
    expect(mapTallyLedgerType("PURCHASE_ACCOUNTS", "Purchase 18%")).toBe("PURCHASE");
    expect(mapTallyLedgerType("SALES_ACCOUNTS", "Sales 18%")).toBe("SALE");
    expect(mapTallyLedgerType("BANK_ACCOUNTS", "HDFC")).toBe("BANK");
    expect(mapTallyLedgerType("CASH_IN_HAND", "Cash")).toBe("CASH");
    expect(mapTallyLedgerType("FIXED_ASSETS", "Plant")).toBe("OTHER");
  });
});

describe("parseTallyDate", () => {
  it("reads Tally's YYYYMMDD at UTC midnight", () => {
    const d = parseTallyDate("20250401")!;
    expect(d.toISOString()).toBe("2025-04-01T00:00:00.000Z");
  });

  it("rejects anything that is not eight digits", () => {
    expect(parseTallyDate("2025-04-01")).toBeNull();
    expect(parseTallyDate("")).toBeNull();
    expect(parseTallyDate(null)).toBeNull();
    expect(parseTallyDate(undefined)).toBeNull();
    expect(parseTallyDate("2025040")).toBeNull();
  });

  it("rejects a date that does not exist", () => {
    expect(parseTallyDate("20250230")).toBeNull();
    expect(parseTallyDate("20251301")).toBeNull();
  });
});

describe("indianFinancialYear", () => {
  it("runs 1 April to 31 March", () => {
    const fy = indianFinancialYear(new Date(Date.UTC(2026, 7, 25)));
    expect(fy.start.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(fy.end.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("puts January back into the previous financial year", () => {
    const fy = indianFinancialYear(new Date(Date.UTC(2027, 0, 15)));
    expect(fy.start.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(fy.end.toISOString().slice(0, 10)).toBe("2027-03-31");
  });
});

describe("deriveCompanyPeriod", () => {
  it("does not trust an EndingAt equal to StartingFrom", () => {
    // Measured on a live company: Tally reported StartingFrom = EndingAt =
    // BooksFrom = 20260401. Taking that at face value as the end of the
    // postable range would reject every voucher dated after 1 April 2026.
    const p = deriveCompanyPeriod({
      name: "RAOTECH",
      startingFrom: "20260401",
      endingAt: "20260401",
      booksFrom: "20260401",
    });
    expect(p.booksFrom!.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(p.fyStart!.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(p.fyEnd!.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(p.fyEndDerived).toBe(true);
  });

  /**
   * The reason `EndingAt` is ignored outright rather than sanity-checked.
   *
   * Measured on one live company within a single session: it reported
   * `EndingAt = 20260401` while the books were empty, and `20260801` a few
   * minutes later once vouchers dated up to 1 August had been posted. The field
   * tracks the most recent voucher, not the end of the financial year.
   *
   * An earlier version accepted any `EndingAt` later than books-beginning,
   * which is precisely the shape a normal voucher date has — so the displayed
   * financial year crept forward every time somebody posted.
   */
  it("ignores EndingAt even when it looks plausible", () => {
    const empty = deriveCompanyPeriod({
      name: "RAOTECH",
      startingFrom: "20260401",
      endingAt: "20260401",
      booksFrom: "20260401",
    });
    const afterPosting = deriveCompanyPeriod({
      name: "RAOTECH",
      startingFrom: "20260401",
      endingAt: "20260801", // the same company, after a voucher was posted
      booksFrom: "20260401",
    });

    // Posting a voucher must not move the company's financial year.
    expect(afterPosting.fyEnd!.toISOString()).toBe(empty.fyEnd!.toISOString());
    expect(afterPosting.fyEnd!.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(afterPosting.fyEndDerived).toBe(true);
  });

  it("derives the financial year from books-beginning, not from EndingAt", () => {
    const p = deriveCompanyPeriod({
      name: "RAOTECH",
      startingFrom: "20250401",
      endingAt: "20260331",
    });
    expect(p.fyEnd!.toISOString().slice(0, 10)).toBe("2026-03-31");
    expect(p.fyEndDerived).toBe(true);
  });

  it("falls back to StartingFrom when booksFrom is absent", () => {
    const p = deriveCompanyPeriod({ name: "X", startingFrom: "20250401" });
    expect(p.booksFrom!.toISOString().slice(0, 10)).toBe("2025-04-01");
    expect(p.fyEnd!.toISOString().slice(0, 10)).toBe("2026-03-31");
  });

  it("returns nulls rather than guessing when Tally reported nothing", () => {
    const p = deriveCompanyPeriod(null);
    expect(p.booksFrom).toBeNull();
    expect(p.fyStart).toBeNull();
    expect(p.fyEnd).toBeNull();
  });
});

describe("ledgerKey", () => {
  it("folds exactly what Tally is careless about", () => {
    expect(ledgerKey("  Acme Traders ")).toBe("acme traders");
    expect(ledgerKey("ACME TRADERS")).toBe(ledgerKey("acme traders"));
  });
});

describe("planLedgerReconciliation", () => {
  const seeded = (name: string, id = name): ExistingLedgerRow => ({
    id,
    name,
    tallyGuid: null,
  });

  it("adopts a seeded ledger instead of creating a duplicate", () => {
    const plan = planLedgerReconciliation(
      [seeded("Cash", "seed-cash"), seeded("Sundry Creditors", "seed-cred")],
      [
        tallyLedger({ name: "Sundry Creditors", parent: "Sundry Creditors", guid: "g-cred" }),
      ]
    );

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].existingId).toBe("seed-cred");
    expect(plan.entries[0].matchedBy).toBe("name");
    expect(plan.skipped).toHaveLength(0);
  });

  it("adopts case-insensitively and through Tally's stray whitespace", () => {
    const plan = planLedgerReconciliation(
      [seeded("Bank Charges", "seed-bank")],
      [tallyLedger({ name: "  bank charges ", parent: "Indirect Expenses", guid: "g-bc" })]
    );
    expect(plan.entries[0].existingId).toBe("seed-bank");
    // The name is trimmed on the way in, or the unique index would see two rows.
    expect(plan.entries[0].name).toBe("bank charges");
  });

  it("prefers the GUID over the name, so a rename does not split a ledger", () => {
    const plan = planLedgerReconciliation(
      [
        { id: "row-1", name: "Acme Traders", tallyGuid: "g-1" },
        { id: "row-2", name: "Acme Traders Pvt Ltd", tallyGuid: null },
      ],
      [tallyLedger({ name: "Acme Traders Pvt Ltd", guid: "g-1" })]
    );

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].existingId).toBe("row-1");
    expect(plan.entries[0].matchedBy).toBe("guid");
  });

  it("creates a row for a ledger the workspace has never seen", () => {
    const plan = planLedgerReconciliation([], [tallyLedger()]);
    expect(plan.entries[0].existingId).toBeNull();
    expect(plan.entries[0].matchedBy).toBeNull();
    expect(plan.entries[0].group).toBe("SUNDRY_CREDITORS");
    expect(plan.entries[0].ledgerType).toBe("PARTY");
  });

  it("records a reserved master and marks it, rather than dropping it", () => {
    // "Cash" exists in every Tally company and in our own seed. It cannot be
    // created or altered, so it must be recorded and flagged — an unflagged row
    // would be handed to MASTER_CREATE and rejected on every future push.
    const plan = planLedgerReconciliation(
      [seeded("Cash", "seed-cash")],
      [tallyLedger({ name: "Cash", parent: "Cash-in-Hand", guid: "g-cash", reserved: true })]
    );

    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].existingId).toBe("seed-cash");
    expect(plan.entries[0].matchedBy).toBe("reserved-name");
    expect(plan.entries[0].reserved).toBe(true);
  });

  it("lets a normal ledger take a seeded row ahead of a reserved one", () => {
    const plan = planLedgerReconciliation(
      [seeded("Cash", "seed-cash")],
      [
        tallyLedger({ name: "Cash", parent: "Cash-in-Hand", guid: "g-reserved", reserved: true }),
        tallyLedger({ name: "Cash", parent: "Cash-in-Hand", guid: "g-normal", reserved: false }),
      ]
    );

    const adopted = plan.entries.find((e) => e.existingId === "seed-cash");
    expect(adopted?.guid).toBe("g-normal");
    // The loser is skipped rather than inserted: (userId, clientId, name) is
    // unique, so a second "Cash" row cannot exist.
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].guid).toBe("g-reserved");
  });

  it("skips a ledger Tally reported without a GUID", () => {
    const plan = planLedgerReconciliation([], [tallyLedger({ guid: null })]);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped[0].reason).toMatch(/GUID/i);
  });

  it("skips a duplicate GUID inside one pull", () => {
    const plan = planLedgerReconciliation(
      [],
      [tallyLedger({ name: "A", guid: "g" }), tallyLedger({ name: "B", guid: "g" })]
    );
    expect(plan.entries).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it("skips an unnamed master rather than failing the whole pull", () => {
    const plan = planLedgerReconciliation(
      [],
      [tallyLedger({ name: "   ", guid: "g-blank" }), tallyLedger()]
    );
    expect(plan.entries).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it("never creates a second row for anything the seed already made", () => {
    // The real shape of a first pull: Tally ships several of the seeded names.
    const existing = SEED_LEDGERS.map((l, i) => seeded(l.name, `seed-${i}`));
    const incoming = SEED_LEDGERS.map((l, i) =>
      tallyLedger({ name: l.name.toUpperCase(), parent: "Current Assets", guid: `g-${i}` })
    );

    const plan = planLedgerReconciliation(existing, incoming);

    expect(plan.entries).toHaveLength(SEED_LEDGERS.length);
    expect(plan.entries.every((e) => e.existingId !== null)).toBe(true);
    expect(plan.skipped).toHaveLength(0);
  });
});
