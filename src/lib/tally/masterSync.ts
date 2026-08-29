import type { PrismaClient } from "@prisma/client";
import type { LedgerGroup, LedgerType } from "@/lib/accounting/types";

/**
 * Ingest a MASTER_PULL result into the workspace.
 *
 * This is the step everything else is gated on. Tally matches ledgers by exact
 * name — case-sensitive, whitespace-significant, and renameable — so posting
 * against a name we merely hope exists is the single largest source of failed
 * imports in this product category. After a pull we hold Tally's GUID for every
 * ledger, and a GUID survives a rename.
 *
 * The awkward part is that the workspace is not empty when the first pull
 * arrives: `seedLedgers.ts` has already created a standard chart of accounts
 * ("Cash", "Sundry Creditors", "Purchase - GST 18%", the six GST ledgers). Tally
 * ships several of those names itself. Creating a second row for each would give
 * the user two "Cash" ledgers and, because Ledger is unique on
 * (userId, clientId, name), the insert would simply fail. So a seeded ledger
 * whose trimmed name matches a Tally ledger case-insensitively is *adopted*:
 * it keeps its id, its mappings and its rule targets, and gains a GUID.
 */

export interface TallyLedgerRecord {
  name: string;
  parent?: string | null;
  guid?: string | null;
  /**
   * Tally's own masters — "Cash", "Profit & Loss A/c". They exist in every
   * company, cannot be created, and reject an alter. We record them so the
   * MASTER_CREATE builder can see they are already there and leave them alone.
   */
  reserved?: boolean | null;
}

export interface TallyCompanyRecord {
  name: string;
  /** Tally's YYYYMMDD, e.g. "20250401". */
  startingFrom?: string | null;
  endingAt?: string | null;
  booksFrom?: string | null;
  guid?: string | null;
}

/**
 * Tally's primary groups, spelled the way Tally spells them. The right-hand
 * side is our own coarser enum; `tallyParent` keeps the exact string, so this
 * mapping only decides how a ledger is filed in our picker and never what is
 * sent back to Tally.
 */
const GROUP_BY_TALLY_NAME: Record<string, LedgerGroup> = {
  "SUNDRY CREDITORS": "SUNDRY_CREDITORS",
  "SUNDRY DEBTORS": "SUNDRY_DEBTORS",
  "DUTIES & TAXES": "DUTIES_AND_TAXES",
  "DUTIES AND TAXES": "DUTIES_AND_TAXES",
  "PURCHASE ACCOUNTS": "PURCHASE_ACCOUNTS",
  "SALES ACCOUNTS": "SALES_ACCOUNTS",
  "DIRECT EXPENSES": "DIRECT_EXPENSES",
  "EXPENSES (DIRECT)": "DIRECT_EXPENSES",
  "INDIRECT EXPENSES": "INDIRECT_EXPENSES",
  "EXPENSES (INDIRECT)": "INDIRECT_EXPENSES",
  "MISC. EXPENSES (ASSET)": "CURRENT_ASSETS",
  "DIRECT INCOMES": "INDIRECT_INCOME",
  "INCOME (DIRECT)": "INDIRECT_INCOME",
  "INDIRECT INCOMES": "INDIRECT_INCOME",
  "INDIRECT INCOME": "INDIRECT_INCOME",
  "INCOME (INDIRECT)": "INDIRECT_INCOME",
  "BANK ACCOUNTS": "BANK_ACCOUNTS",
  "BANK OCC A/C": "BANK_ACCOUNTS",
  "BANK OD A/C": "BANK_ACCOUNTS",
  "CASH-IN-HAND": "CASH_IN_HAND",
  "CASH IN HAND": "CASH_IN_HAND",
  "CURRENT ASSETS": "CURRENT_ASSETS",
  "CURRENT LIABILITIES": "CURRENT_LIABILITIES",
  "FIXED ASSETS": "FIXED_ASSETS",
  "INVESTMENTS": "CURRENT_ASSETS",
  "DEPOSITS (ASSET)": "CURRENT_ASSETS",
  "LOANS & ADVANCES (ASSET)": "CURRENT_ASSETS",
  "STOCK-IN-HAND": "CURRENT_ASSETS",
  "SUSPENSE A/C": "CURRENT_ASSETS",
  "BRANCH / DIVISIONS": "CURRENT_ASSETS",
  "PROVISIONS": "CURRENT_LIABILITIES",
  "CAPITAL ACCOUNT": "CURRENT_LIABILITIES",
  "RESERVES & SURPLUS": "CURRENT_LIABILITIES",
  "RETAINED EARNINGS": "CURRENT_LIABILITIES",
  "SECURED LOANS": "CURRENT_LIABILITIES",
  "UNSECURED LOANS": "CURRENT_LIABILITIES",
  "LOANS (LIABILITY)": "CURRENT_LIABILITIES",
};

/**
 * A Tally company almost always carries user-created groups too ("Site
 * Expenses", "Directors Loan"). They arrive as a `PARENT` we have never seen,
 * and their name is the only signal available. Guessing from a keyword is worth
 * more than filing every custom group under one bucket, and being wrong costs
 * nothing at post time — the GUID is what posts.
 */
const GROUP_KEYWORDS: [RegExp, LedgerGroup][] = [
  [/\bcreditor/i, "SUNDRY_CREDITORS"],
  [/\bdebtor/i, "SUNDRY_DEBTORS"],
  [/\b(dut(y|ies)|gst|vat|tds|tcs|tax)\b/i, "DUTIES_AND_TAXES"],
  [/\bpurchase/i, "PURCHASE_ACCOUNTS"],
  [/\bsale/i, "SALES_ACCOUNTS"],
  [/\bbank/i, "BANK_ACCOUNTS"],
  [/\bcash/i, "CASH_IN_HAND"],
  [/\bfixed\b/i, "FIXED_ASSETS"],
  [/\b(loan|capital|provision|reserve|liabilit|payable)/i, "CURRENT_LIABILITIES"],
  [/\b(asset|deposit|investment|stock|receivable)/i, "CURRENT_ASSETS"],
  [/\b(income|revenue|sales)/i, "INDIRECT_INCOME"],
  [/\b(expense|expenditure|charges)/i, "INDIRECT_EXPENSES"],
];

/**
 * Where an unrecognised group lands. Current Assets is the least destructive
 * choice: it is not a posting default anywhere in the app, so a misfiled ledger
 * shows up in the picker under a slightly odd heading rather than quietly
 * becoming the default purchase or tax account for a voucher.
 */
const FALLBACK_GROUP: LedgerGroup = "CURRENT_ASSETS";

export function mapTallyGroup(parent: string | null | undefined): LedgerGroup {
  const raw = (parent ?? "").trim();
  if (!raw) return FALLBACK_GROUP;

  const exact = GROUP_BY_TALLY_NAME[raw.toUpperCase()];
  if (exact) return exact;

  for (const [pattern, group] of GROUP_KEYWORDS) {
    if (pattern.test(raw)) return group;
  }
  return FALLBACK_GROUP;
}

/**
 * A tax ledger's direction is not in the group — Tally files input and output
 * GST under the same "Duties & Taxes". The name is the only thing that
 * distinguishes them, and our own seed already follows the "CGST Input" /
 * "CGST Output" convention that most Indian charts use.
 */
export function mapTallyLedgerType(
  group: LedgerGroup,
  ledgerName: string
): LedgerType {
  switch (group) {
    case "SUNDRY_CREDITORS":
    case "SUNDRY_DEBTORS":
      return "PARTY";
    case "DUTIES_AND_TAXES":
      return /\b(output|sales|payable)\b/i.test(ledgerName)
        ? "TAX_OUTPUT"
        : "TAX_INPUT";
    case "PURCHASE_ACCOUNTS":
      return "PURCHASE";
    case "SALES_ACCOUNTS":
      return "SALE";
    case "DIRECT_EXPENSES":
    case "INDIRECT_EXPENSES":
      return "EXPENSE";
    case "INDIRECT_INCOME":
      return "INCOME";
    case "BANK_ACCOUNTS":
      return "BANK";
    case "CASH_IN_HAND":
      return "CASH";
    default:
      return "OTHER";
  }
}

/**
 * Tally hands dates back as YYYYMMDD with no separators and no timezone.
 * Constructed at UTC midnight so a pull run from IST does not shift the
 * financial year back a day — the preflight date-range check compares against
 * these bounds and an off-by-one there rejects every voucher on 1 April.
 */
export function parseTallyDate(value: string | null | undefined): Date | null {
  const raw = (value ?? "").trim();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return null;

  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    return null;
  }
  return date;
}

/**
 * The Indian financial year containing `d`: 1 April to 31 March.
 *
 * Needed because Tally's reported `EndingAt` cannot be relied on — see
 * `deriveCompanyPeriod` below.
 */
export function indianFinancialYear(d: Date): { start: Date; end: Date } {
  const year = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return {
    start: new Date(Date.UTC(year, 3, 1)),
    end: new Date(Date.UTC(year + 1, 2, 31)),
  };
}

export interface CompanyPeriod {
  booksFrom: Date | null;
  fyStart: Date | null;
  fyEnd: Date | null;
  /** True when `fyEnd` was computed rather than taken from Tally. */
  fyEndDerived: boolean;
}

/**
 * Work out the company's period from what Tally reported.
 *
 * Measured against a live TallyPrime 7.1 (company RAOTECH, books beginning
 * 2026-04-01, probed on 2026-08-25 by posting and then deleting real vouchers
 * at eight dates):
 *
 *   REJECT  2026-03-31  "The date 31-3-2026 is Out of Range!"
 *   ACCEPT  2026-04-01, 2026-08-01, 2026-08-25, 2027-03-31
 *   ACCEPT  2027-04-01  — the first day of the *next* financial year
 *   ACCEPT  2028-06-15  — two financial years out
 *   REJECT  2019-01-01  "The date 1-1-2019 is Out of Range!"
 *
 * Two conclusions, both load-bearing:
 *
 * 1. Tally enforces a **lower bound only**. Nothing above BooksFrom was ever
 *    rejected, including dates two financial years away.
 * 2. That company reported StartingFrom = EndingAt = BooksFrom = 20260401 —
 *    all three identical. `EndingAt` is therefore not the end of the postable
 *    range and must never be fed to preflight as one: doing so would reject
 *    every voucher dated after 1 April 2026, which is all real work including
 *    the current day.
 *
 * 3. `EndingAt` is not a fixed property of the company at all — it tracks the
 *    latest voucher in the books. The same company read twice on 2026-08-25
 *    reported `20260401` while empty and `20260801` once vouchers dated up to
 *    1 August existed. So it cannot be rescued by sanity-checking it against
 *    the anchor: "later than BooksFrom" is exactly what a perfectly ordinary
 *    voucher date looks like.
 *
 * `fyEnd` is therefore always derived from the Indian financial year containing
 * BooksFrom, and Tally's reported `EndingAt` is never stored. It is display-only
 * either way — pre-flight bounds on `booksFrom` alone, because Tally enforces no
 * upper bound.
 */
export function deriveCompanyPeriod(
  record: TallyCompanyRecord | null | undefined
): CompanyPeriod {
  const reportedStart = parseTallyDate(record?.startingFrom);
  const booksFrom = parseTallyDate(record?.booksFrom) ?? reportedStart;

  const anchor = booksFrom ?? reportedStart;
  if (!anchor) {
    // No anchor to derive from, so there is nothing honest to report.
    return { booksFrom, fyStart: reportedStart, fyEnd: null, fyEndDerived: false };
  }

  const fy = indianFinancialYear(anchor);

  return {
    booksFrom,
    fyStart: reportedStart ?? fy.start,
    // Always derived. See (3) above: the reported EndingAt is the date of the
    // most recent voucher, so trusting it makes the displayed financial year
    // creep forward every time somebody posts.
    fyEnd: fy.end,
    fyEndDerived: true,
  };
}

/** The adoption key: trimmed and case-folded, exactly what Tally is careless about. */
export function ledgerKey(name: string): string {
  return name.trim().toLowerCase();
}

export interface ExistingLedgerRow {
  id: string;
  name: string;
  tallyGuid: string | null;
}

export type LedgerMatchKind = "guid" | "name" | "reserved-name";

export interface LedgerPlanEntry {
  guid: string;
  name: string;
  tallyName: string;
  tallyParent: string | null;
  reserved: boolean;
  group: LedgerGroup;
  ledgerType: LedgerType;
  /** null means "insert a new row". */
  existingId: string | null;
  matchedBy: LedgerMatchKind | null;
}

export interface LedgerPlan {
  entries: LedgerPlanEntry[];
  /** Recorded rather than thrown: one odd master must not fail a whole pull. */
  skipped: { name: string; guid: string | null; reason: string }[];
}

/**
 * Decide, for every ledger Tally reported, whether it adopts an existing row or
 * creates one. Pure, because this is the part that is worth testing: getting it
 * wrong duplicates a user's chart of accounts, and that is not undoable from the
 * UI.
 *
 * Three passes, in priority order:
 *
 *  1. GUID. Authoritative — it is the same ledger even if it has been renamed on
 *     both sides.
 *  2. Name, non-reserved first. This is the seeded-chart reconciliation.
 *  3. Name, reserved. A reserved master does not get to claim a seeded row
 *     ahead of a normal one, but if the name is still taken when its turn comes
 *     it takes the row anyway rather than being dropped: the alternative is an
 *     unrecorded reserved ledger, which MASTER_CREATE would then try to create
 *     and Tally would reject. Adopting it stamps `tallyReserved`, which is what
 *     keeps it out of every future create and delete.
 */
export function planLedgerReconciliation(
  existing: ExistingLedgerRow[],
  incoming: TallyLedgerRecord[]
): LedgerPlan {
  const plan: LedgerPlan = { entries: [], skipped: [] };

  const byGuid = new Map<string, ExistingLedgerRow>();
  const byName = new Map<string, ExistingLedgerRow>();
  for (const row of existing) {
    if (row.tallyGuid) byGuid.set(row.tallyGuid, row);
    const key = ledgerKey(row.name);
    if (key && !byName.has(key)) byName.set(key, row);
  }

  const claimed = new Set<string>();
  const seenGuids = new Set<string>();

  type Pending = { record: TallyLedgerRecord; guid: string; name: string };
  const pending: Pending[] = [];

  for (const record of incoming) {
    const name = (record.name ?? "").trim();
    const guid = (record.guid ?? "").trim();

    if (!name) {
      plan.skipped.push({ name: record.name ?? "", guid: guid || null, reason: "unnamed" });
      continue;
    }
    if (!guid) {
      // Without a GUID there is nothing to key the upsert on, and matching on
      // name alone is exactly the failure mode this whole module exists to
      // avoid.
      plan.skipped.push({ name, guid: null, reason: "no GUID reported" });
      continue;
    }
    if (seenGuids.has(guid)) {
      plan.skipped.push({ name, guid, reason: "duplicate GUID in the same pull" });
      continue;
    }
    seenGuids.add(guid);

    const match = byGuid.get(guid);
    if (match) {
      claimed.add(match.id);
      plan.entries.push(entryFor(record, name, guid, match.id, "guid"));
      continue;
    }
    pending.push({ record, guid, name });
  }

  // Non-reserved before reserved; otherwise stable, so a pull is deterministic.
  pending.sort((a, b) => Number(!!a.record.reserved) - Number(!!b.record.reserved));

  for (const { record, guid, name } of pending) {
    const reserved = !!record.reserved;
    const row = byName.get(ledgerKey(name));

    if (row && !claimed.has(row.id)) {
      claimed.add(row.id);
      plan.entries.push(
        entryFor(record, name, guid, row.id, reserved ? "reserved-name" : "name")
      );
      continue;
    }

    if (row) {
      // The name is taken by a row this same pull already adopted, so inserting
      // would violate (userId, clientId, name). Nothing sensible is left to do.
      plan.skipped.push({
        name,
        guid,
        reason: `another Tally ledger already adopted the local ledger named "${row.name}"`,
      });
      continue;
    }

    plan.entries.push(entryFor(record, name, guid, null, null));
  }

  return plan;
}

function entryFor(
  record: TallyLedgerRecord,
  name: string,
  guid: string,
  existingId: string | null,
  matchedBy: LedgerMatchKind | null
): LedgerPlanEntry {
  const parent = (record.parent ?? "").trim();
  const group = mapTallyGroup(parent);
  return {
    guid,
    name,
    tallyName: name,
    tallyParent: parent || null,
    reserved: !!record.reserved,
    group,
    ledgerType: mapTallyLedgerType(group, name),
    existingId,
    matchedBy,
  };
}

export interface MasterPullInput {
  userId: string;
  clientId: string;
  tallyCompanyId: string;
  companyName: string;
  companies?: TallyCompanyRecord[] | null;
  ledgers?: TallyLedgerRecord[] | null;
}

export interface MasterPullOutcome {
  adopted: number;
  created: number;
  skipped: number;
  ledgerCount: number;
  fyStart: Date | null;
  fyEnd: Date | null;
  booksFrom: Date | null;
}

/**
 * Apply a MASTER_PULL result. Writes are sequential rather than batched: the
 * whole point is per-row reconciliation, and `createMany` cannot adopt.
 */
export async function applyMasterPull(
  db: PrismaClient,
  input: MasterPullInput
): Promise<MasterPullOutcome> {
  const incoming = input.ledgers ?? [];

  const existing = await db.ledger.findMany({
    where: { userId: input.userId, clientId: input.clientId },
    select: { id: true, name: true, tallyGuid: true },
  });

  const plan = planLedgerReconciliation(existing, incoming);
  const now = new Date();
  let adopted = 0;
  let created = 0;

  for (const entry of plan.entries) {
    if (entry.existingId) {
      await db.ledger.update({
        where: { id: entry.existingId },
        data: {
          tallyCompanyId: input.tallyCompanyId,
          tallyGuid: entry.guid,
          tallyName: entry.tallyName,
          tallyParent: entry.tallyParent,
          tallyReserved: entry.reserved,
          tallySyncedAt: now,
        },
      });
      adopted += 1;
    } else {
      await db.ledger.create({
        data: {
          userId: input.userId,
          clientId: input.clientId,
          name: entry.name,
          group: entry.group,
          ledgerType: entry.ledgerType,
          isSeeded: false,
          tallyCompanyId: input.tallyCompanyId,
          tallyGuid: entry.guid,
          tallyName: entry.tallyName,
          tallyParent: entry.tallyParent,
          tallyReserved: entry.reserved,
          tallySyncedAt: now,
        },
      });
      created += 1;
    }
  }

  // Tally reports the open companies; the one this workspace is bound to is
  // matched by name, because that is the only handle <SVCURRENTCOMPANY> has.
  const wanted = input.companyName.trim().toLowerCase();
  const companies = input.companies ?? [];
  const match =
    companies.find((c) => (c.name ?? "").trim().toLowerCase() === wanted) ??
    (companies.length === 1 ? companies[0] : undefined);

  const { fyStart, fyEnd, booksFrom } = deriveCompanyPeriod(match);

  await db.tallyCompany.update({
    where: { id: input.tallyCompanyId },
    data: {
      status: "READY",
      lastSyncedAt: now,
      ledgerCount: plan.entries.length,
      ...(match?.guid ? { companyGuid: match.guid } : {}),
      ...(fyStart ? { fyStart } : {}),
      ...(fyEnd ? { fyEnd } : {}),
      ...(booksFrom ? { booksFrom } : {}),
    },
  });

  return {
    adopted,
    created,
    skipped: plan.skipped.length,
    ledgerCount: plan.entries.length,
    fyStart,
    fyEnd,
    booksFrom,
  };
}
