import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  applyMasterPull,
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

/**
 * `applyMasterPull` against a fake that behaves like the table does.
 *
 * The pure planner above decides *what* happens to each ledger; these prove the
 * writing of it, which is where SYNC-07 lived: a real chart is 1,000-2,000
 * ledgers and the first version wrote them one row at a time inside the
 * connector's result request. At the round-trip cost this codebase documents
 * (~160-290ms to the pooler) that request could not finish, and what it left
 * behind — half a chart, a job already marked terminal, a company stuck at
 * SYNCING — could never be retried.
 */
interface FakeLedger {
  id: string;
  userId: string;
  clientId: string;
  name: string;
  group: string;
  ledgerType: string;
  isSeeded: boolean;
  tallyCompanyId: string | null;
  tallyGuid: string | null;
  tallyName: string | null;
  tallyParent: string | null;
  tallyReserved: boolean;
  tallySyncedAt: Date | null;
}

function makeLedgerDb(initial: Partial<FakeLedger>[] = []) {
  const table = new Map<string, FakeLedger>();
  for (const [i, row] of initial.entries()) {
    const id = row.id ?? `seed-${i}`;
    table.set(id, {
      userId: "u1",
      clientId: "c1",
      name: `Ledger ${i}`,
      group: "CURRENT_ASSETS",
      ledgerType: "OTHER",
      isSeeded: true,
      tallyCompanyId: null,
      tallyGuid: null,
      tallyName: null,
      tallyParent: null,
      tallyReserved: false,
      tallySyncedAt: null,
      ...row,
      id,
    } as FakeLedger);
  }

  const calls = { findMany: 0, createMany: 0, updateMany: 0, update: 0, transaction: 0 };
  const companyWrites: Record<string, unknown>[] = [];
  /** Set to fail the Nth `createMany`, standing in for a killed request. */
  const opts = { failCreateManyOnCall: 0 };
  let nextId = 0;

  const db = {
    ledger: {
      findMany: async () => {
        calls.findMany += 1;
        return [...table.values()].map((r) => ({ ...r }));
      },
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Omit<FakeLedger, "id">[];
        skipDuplicates?: boolean;
      }) => {
        calls.createMany += 1;
        if (opts.failCreateManyOnCall === calls.createMany) {
          throw new Error("the request was killed part-way through");
        }
        let count = 0;
        for (const row of data) {
          // Stands in for @@unique([userId, clientId, name]).
          const clash = [...table.values()].some((r) => r.name === row.name);
          if (clash && skipDuplicates) continue;
          if (clash) throw new Error(`duplicate ledger name ${row.name}`);
          nextId += 1;
          const id = `new-${nextId}`;
          table.set(id, { ...(row as FakeLedger), id });
          count += 1;
        }
        return { count };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: { in: string[] } };
        data: Partial<FakeLedger>;
      }) => {
        calls.updateMany += 1;
        let count = 0;
        for (const id of where.id.in) {
          const row = table.get(id);
          if (!row) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeLedger> }) => {
        calls.update += 1;
        const row = table.get(where.id);
        if (!row) throw new Error(`no ledger ${where.id}`);
        Object.assign(row, data);
        return { ...row };
      },
    },
    tallyCompany: {
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        companyWrites.push(args.data);
        return args.data;
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => {
      calls.transaction += 1;
      return Promise.all(ops);
    },
  };

  const reset = () => {
    calls.findMany = 0;
    calls.createMany = 0;
    calls.updateMany = 0;
    calls.update = 0;
    calls.transaction = 0;
  };

  return { db: db as unknown as PrismaClient, table, calls, companyWrites, opts, reset };
}

const pull = (ledgers: TallyLedgerRecord[]) => ({
  userId: "u1",
  clientId: "c1",
  tallyCompanyId: "tc1",
  companyName: "RAOTECH",
  companies: [{ name: "RAOTECH", booksFrom: "20260401" }],
  ledgers,
});

/** A chart the size of a real client's. */
const bigChart = (n: number): TallyLedgerRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `Ledger ${i}`,
    parent: "Sundry Creditors",
    guid: `guid-${i}`,
    reserved: false,
  }));

describe("applyMasterPull", () => {
  it("adopts a seeded ledger rather than inserting a second row", async () => {
    // The semantic the whole module exists for, asserted end to end this time:
    // Tally's spelling differs in case, and the row must keep its id — its
    // mappings and rule targets hang off it — and merely gain a GUID.
    const fake = makeLedgerDb([{ id: "seed-cash", name: "Cash", isSeeded: true }]);

    const outcome = await applyMasterPull(
      fake.db,
      pull([{ name: "CASH", parent: "Cash-in-Hand", guid: "guid-cash", reserved: true }])
    );

    expect(outcome.adopted).toBe(1);
    expect(outcome.created).toBe(0);
    expect(fake.table.size).toBe(1);

    const row = fake.table.get("seed-cash");
    expect(row?.tallyGuid).toBe("guid-cash");
    expect(row?.tallyName).toBe("CASH");
    expect(row?.tallyReserved).toBe(true);
    // The local name is untouched: it is what every mapping and every voucher
    // line snapshot already says.
    expect(row?.name).toBe("Cash");
  });

  it("writes a two-thousand ledger chart in a handful of round trips", async () => {
    const fake = makeLedgerDb();

    const outcome = await applyMasterPull(fake.db, pull(bigChart(2000)));

    expect(outcome.created).toBe(2000);
    expect(fake.table.size).toBe(2000);

    // The point of the change. One read, ten chunked inserts, one company
    // write — not two thousand statements, which at ~160-290ms each could not
    // have completed inside the request at all.
    const statements =
      fake.calls.findMany +
      fake.calls.createMany +
      fake.calls.updateMany +
      fake.calls.transaction;
    expect(statements).toBeLessThan(20);
    expect(fake.calls.update).toBe(0);
  });

  it("costs almost nothing to pull the same chart again", async () => {
    // The converged case, and therefore the case every resumed pull ends in.
    const fake = makeLedgerDb();
    const chart = bigChart(500);
    await applyMasterPull(fake.db, pull(chart));
    fake.reset();

    await applyMasterPull(fake.db, pull(chart));

    // Nothing changed, so nothing is written per row: the adoptions collapse
    // into one `updateMany` a chunk that only re-stamps `tallySyncedAt`.
    expect(fake.calls.update).toBe(0);
    expect(fake.calls.transaction).toBe(0);
    expect(fake.calls.updateMany).toBeLessThan(5);
    expect(fake.table.size).toBe(500);
  });

  it("converges from a pull that was killed part-way through", async () => {
    const fake = makeLedgerDb();
    const chart = bigChart(500);

    // Chunk one commits, chunk two dies with the request.
    fake.opts.failCreateManyOnCall = 2;
    await expect(applyMasterPull(fake.db, pull(chart))).rejects.toThrow(/killed/);

    // What is left behind is not garbage: it is 200 ledgers carrying their
    // GUIDs, which is what the next pull matches on.
    expect(fake.table.size).toBe(200);
    expect(fake.companyWrites).toHaveLength(0);

    fake.opts.failCreateManyOnCall = 0;
    const outcome = await applyMasterPull(fake.db, pull(chart));

    // The retry finishes the job and duplicates nothing.
    expect(fake.table.size).toBe(500);
    expect(outcome.created).toBe(300);
    expect(outcome.adopted).toBe(200);
    expect(fake.companyWrites.at(-1)?.status).toBe("READY");
  });

  it("only reports READY once the whole chart is in", async () => {
    const fake = makeLedgerDb();
    fake.opts.failCreateManyOnCall = 1;

    await expect(applyMasterPull(fake.db, pull(bigChart(10)))).rejects.toThrow();

    // A company left at SYNCING is what `applyJobResult` looks for when a
    // replayed result arrives, and is why the pull can be re-driven at all.
    expect(fake.companyWrites).toHaveLength(0);
  });
});
