/**
 * Turn mapped spreadsheet rows into `NormalizedInvoice`s.
 *
 * This is the join between the spreadsheet world and the accounting world, and
 * it is deliberately the *only* one: what comes out of here goes straight into
 * the existing resolveLedger → buildVoucher → createVoucher path that the OCR
 * route already uses. There is no second accounting path, no second rounding
 * convention and no second idea of what an invoice is.
 *
 * Three things here are worth reading closely, because they are the three the
 * competitor cannot do:
 *
 *  1. **WIDE fan-out.** A sheet laid out as `Taxable@5 | CGST@5 | Taxable@18 |
 *     CGST@18 | …` becomes one item line per rate, carrying its rate. Their
 *     mapping UI has exactly one "Amount" slot, so their documented workaround
 *     is to nominate the smallest rate as the primary and hand-map the rest
 *     through the "other ledgers" stage — eight of their twenty-four GST
 *     permutation articles exist only to describe that workaround.
 *  2. **WITH_ITEM fan-in.** Rows sharing an invoice number are one bill, found
 *     by hashing the number rather than by scanning for runs, so the sheet does
 *     not have to be sorted. Every one of their checklists tells the user to
 *     sort by invoice number A-Z first.
 *  3. **Interstate per row.** Decided from the row's own party GSTIN (or an
 *     explicit column), never from a sheet-wide setting, because a sales
 *     register routinely contains both.
 */

import type {
  CellState,
  CellValue,
  ColumnIndex,
  MappedRow,
  MappingResult,
  ParsedSheet,
  RateGroup,
  RowIssue,
  SheetMapping,
} from "./types";
import { MAX_ROWS } from "./types";
import type { NormalizedInvoice, NormalizedItem } from "../accounting/types";
import { cleanDate } from "../accounting/normalize";
import {
  AMOUNT_EPSILON,
  SHEET_SCOPE,
  cellAt,
  cellText,
  groupRowIndexes,
  isBlankCell,
  isValidGstin,
  normalizeGstinCell,
  parseSheetDate,
  parseSheetNumber,
  statedTotalForGroup,
  validateRows,
} from "./validate";
import type { ValidateOptions } from "./validate";
import { normName } from "../accounting/normalize";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Round to paise, once, at the boundary.
 *
 * Every amount that leaves this module goes through here so that a rupee
 * quantity never carries binary float noise into `buildVoucher`, which converts
 * to integer paise and would otherwise turn 1234.5599999999999 into a one-paisa
 * round-off line on a perfectly clean invoice.
 *
 * The nudge matters: 1.005 is stored as 1.00499999999999989, so a plain
 * `Math.round(v * 100)` rounds it *down* — away from what the accountant reads
 * off the sheet. Half-away-from-zero on both signs, so a credit note rounds the
 * same way its invoice did.
 */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 100;
  const rounded = Math.round(scaled >= 0 ? scaled + 1e-9 : scaled - 1e-9);
  // `|| 0` rather than the raw quotient so that -0 never reaches Prisma.
  return rounded === 0 ? 0 : rounded / 100;
}

// ---------------------------------------------------------------------------
// Interstate
// ---------------------------------------------------------------------------

/**
 * The two-digit GST state code at the head of a GSTIN.
 *
 * Returns null for anything that is not a plausible GSTIN, so the caller falls
 * back rather than comparing "27" against garbage.
 */
export function stateCodeOf(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const cleaned = String(gstin).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length < 2) return null;
  const code = cleaned.slice(0, 2);
  if (!/^\d{2}$/.test(code)) return null;
  // A bare two-digit state code (e.g. a "State Code" column) is legitimate
  // input; anything longer has to look like a real GSTIN before we trust it.
  if (cleaned.length > 2 && !isValidGstin(cleaned)) return null;
  return code;
}

/**
 * Is the supply interstate?
 *
 * Interstate is not a mapping flag and not a sheet setting — it is a per-row
 * consequence of where the party is. `null` means "cannot tell from the GSTINs",
 * which is a real and common answer (unregistered parties have no GSTIN at all)
 * and is why the caller must have a fallback rather than a default.
 */
export function isInterstateByGstin(
  partyGstin: string | null | undefined,
  companyStateCode: string | null | undefined
): boolean | null {
  const party = stateCodeOf(partyGstin);
  const company = companyStateCode ? stateCodeOf(companyStateCode) : null;
  if (!party || !company) return null;
  return party !== company;
}

const TRUE_TOKENS = new Set(["y", "yes", "true", "1", "interstate", "inter", "inter state", "inter-state", "igst", "outside", "outside state", "ots"]);
const FALSE_TOKENS = new Set(["n", "no", "false", "0", "intrastate", "intra", "intra state", "intra-state", "local", "within state", "cgst/sgst", "within"]);

/** Read an explicit interstate column. `null` when the cell says nothing useful. */
export function parseInterstateCell(value: CellValue): boolean | null {
  if (isBlankCell(value)) return null;
  if (typeof value === "boolean") return value;
  const text = cellText(value);
  if (!text) return null;
  const key = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (TRUE_TOKENS.has(key)) return true;
  if (FALSE_TOKENS.has(key)) return false;
  return null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LedgerCandidate {
  id: string;
  name: string;
  tallyGuid?: string | null;
}

export interface MapRowsOptions {
  /** Present for symmetry with the rest of the pipeline; not used for lookup here. */
  userId?: string;
  clientId?: string;
  /**
   * Ledgers already synced from Tally, used to answer "does this party exist?"
   * without a query per row. Supplying these is what makes the review grid able
   * to say NOT_IN_TALLY rather than just "unmapped".
   */
  ledgers?: LedgerCandidate[];
  /**
   * The company's own GST state code, e.g. "27". A full company GSTIN is also
   * accepted — only the first two digits are used.
   */
  companyStateCode?: string | null;
  /** The company's books-beginning date, forwarded to validation. */
  booksFrom?: Date | null;
  /** Override the default name-based party lookup. */
  resolveParty?: (name: string | null, gstin: string | null) => string | null;
  /**
   * Pre-computed issues from `validateRows`. Supply these when the caller has
   * already validated, so the work is not done twice; omit them and mapRows
   * validates for you, because a `MappedRow` with an empty `issues` array is a
   * row a commit loop will happily post.
   */
  issues?: RowIssue[];
  /** Forwarded to `validateRows` when mapRows validates for itself. */
  validate?: ValidateOptions;
  /** Row ceiling; defaults to `MAX_ROWS`. Rows past it are not mapped. */
  maxRows?: number;
}

// ---------------------------------------------------------------------------
// mapRows
// ---------------------------------------------------------------------------

export function mapRows(
  parsed: ParsedSheet,
  mapping: SheetMapping,
  opts: MapRowsOptions = {}
): MappingResult {
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const issues =
    opts.issues ??
    validateRows(parsed, mapping, {
      booksFrom: opts.booksFrom ?? null,
      maxRows,
      // The ledger stage is checked by the wizard, which knows whether the user
      // is pinning ledger ids or letting resolveLedger find them; re-checking it
      // here would block a commit path that resolves ledgers at post time.
      requireLedgerMapping: false,
      ...opts.validate,
    });
  const companyState = opts.companyStateCode ? stateCodeOf(opts.companyStateCode) : null;
  const resolveParty = opts.resolveParty ?? ledgerLookup(opts.ledgers);

  const issuesByRow = new Map<number, RowIssue[]>();
  let sheetHasBlockingIssue = false;
  for (const issue of issues) {
    if (issue.row === SHEET_SCOPE) {
      if (issue.severity === "error") sheetHasBlockingIssue = true;
      continue;
    }
    const bucket = issuesByRow.get(issue.row);
    if (bucket) bucket.push(issue);
    else issuesByRow.set(issue.row, [issue]);
  }

  const groups = groupRowIndexes(parsed, mapping).filter((g) => g[0] < maxRows);
  const rows: MappedRow[] = [];
  const missingParties = new Set<string>();
  let committableCount = 0;

  for (const group of groups) {
    const anchor = group[0];
    const head = parsed.rows[anchor];

    // Every row of a multi-row bill carries the same issues to the reviewer,
    // because the reviewer is looking at one document, not at spreadsheet rows.
    const groupIssues = group.flatMap((index) => issuesByRow.get(index) ?? []);

    const partyName = cellText(cellAt(head, mapping.fields.partyName));
    const partyGstin = normalizeGstinCell(cellAt(head, mapping.fields.partyGstin));
    const partyLedgerId = resolveParty(partyName, partyGstin) ?? null;
    const partyState = resolvePartyState(partyName, partyGstin, partyLedgerId);
    if (!partyLedgerId && partyName) missingParties.add(partyName);

    const invoice =
      mapping.docType === "JOURNAL"
        ? null
        : buildInvoice(parsed.rows, group, mapping, companyState, partyName, partyGstin);

    rows.push({ row: anchor, invoice, issues: groupIssues, partyLedgerId, partyState });

    const blocked = groupIssues.some((i) => i.severity === "error");
    if (invoice && !blocked && !sheetHasBlockingIssue) committableCount++;
  }

  return {
    rows,
    issues,
    committableCount,
    missingParties: [...missingParties],
  };
}

/**
 * Default party lookup: fold the ledger names the same way `resolveLedger.ts`
 * folds them (`normName` — lower-cased, legal suffixes dropped) so "Acme Pvt
 * Ltd" in the sheet finds "ACME PRIVATE LIMITED" in Tally. This is a preview,
 * not the resolution: `resolveLedgersForInvoice` still has the last word at
 * commit time, with rules and memory that this cannot see.
 */
function ledgerLookup(
  ledgers: LedgerCandidate[] | undefined
): (name: string | null, gstin: string | null) => string | null {
  if (!ledgers || ledgers.length === 0) return () => null;
  const byName = new Map<string, string>();
  for (const ledger of ledgers) {
    const key = normName(ledger.name);
    if (key && !byName.has(key)) byName.set(key, ledger.id);
  }
  return (name) => {
    const key = normName(name);
    return key ? byName.get(key) ?? null : null;
  };
}

function resolvePartyState(
  name: string | null,
  gstin: string | null,
  ledgerId: string | null
): CellState {
  if (ledgerId) return "RESOLVED";
  if (!name && !gstin) return "UNMAPPED";
  if (gstin && !isValidGstin(gstin)) return "INVALID";
  return "NOT_IN_TALLY";
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

function buildInvoice(
  allRows: CellValue[][],
  group: number[],
  mapping: SheetMapping,
  companyState: string | null,
  partyName: string | null,
  partyGstin: string | null
): NormalizedInvoice {
  const f = mapping.fields;
  const g = mapping.gst;
  const head = allRows[group[0]];
  const rows = group.map((index) => allRows[index]);
  const isSale = mapping.docType === "SALE" || mapping.docType === "SALE_RETURN";

  const interstate = decideInterstate(head, mapping, partyGstin, companyState);

  const items: NormalizedItem[] = [];
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (mapping.itemMode === "WITH_ITEM") {
    for (const row of rows) items.push(...itemsFromRow(row, mapping));
  }

  if (g.taxLayout === "WIDE") {
    for (const row of rows) {
      for (const rateGroup of g.rateGroups) {
        const taxable = readNumber(row, rateGroup.taxable);
        if (Math.abs(taxable) < AMOUNT_EPSILON) continue;

        // Each populated rate block is its own line at its own rate. Carrying
        // the rate on the item is what lets `rankItem` in resolveLedger.ts pick
        // "Sales @ 18%" without anybody typing a ledger name into the
        // spreadsheet — which is precisely the manual labour their
        // "sheet modification for multiple GST rates" guide prescribes.
        if (mapping.itemMode === "WITHOUT_ITEM") {
          items.push({
            name: `Taxable @ ${rateGroup.rate}%`,
            qty: 1,
            rate: roundMoney(taxable),
            price: roundMoney(taxable),
            hsnCode: cellText(cellAt(row, f.hsnCode)),
            gstRate: rateGroup.rate,
          });
        }

        const tax = taxForRateGroup(row, rateGroup, taxable, g.source, interstate);
        cgst += tax.cgst;
        sgst += tax.sgst;
        igst += tax.igst;
      }
    }
  } else if (g.source === "FROM_SHEET") {
    for (const row of rows) {
      cgst += readNumber(row, g.cgst);
      sgst += readNumber(row, g.sgst);
      igst += readNumber(row, g.igst);
    }
  }

  const discount = roundMoney(sumOver(rows, f.discount));
  const roundOffColumn = roundMoney(sumOver(rows, f.roundOff));

  let subtotal = items.length
    ? roundMoney(items.reduce((sum, item) => sum + item.price, 0))
    : roundMoney(sumOver(rows, f.taxable) || sumOver(rows, f.amount));

  if (g.taxLayout === "LONG" && g.source === "CALCULATE") {
    // No tax columns to read: derive from the rate, per row so that a rate
    // column with a mix of rates still works.
    for (const row of rows) {
      const base = rowTaxableBase(row, mapping, items.length > 0);
      const rate = rateForRow(row, mapping);
      if (rate === null || Math.abs(base) < AMOUNT_EPSILON) continue;
      const tax = splitTax(roundMoney((base * rate) / 100), interstate);
      cgst += tax.cgst;
      sgst += tax.sgst;
      igst += tax.igst;
    }
  }

  cgst = roundMoney(cgst);
  sgst = roundMoney(sgst);
  igst = roundMoney(igst);

  // A LONG sheet with neither a taxable column nor items still knows the total;
  // work backwards so the voucher is not built from a zero base.
  if (Math.abs(subtotal) < AMOUNT_EPSILON && f.total !== null) {
    const stated = statedTotalForGroup(allRows, mapping, group);
    if (stated !== null) subtotal = roundMoney(stated - cgst - sgst - igst - roundOffColumn + discount);
  }

  // Nothing carries a rate in the WITHOUT_ITEM/LONG case, so give the single
  // synthesised line one when the mapping knows it. `rankItem` uses it; without
  // it the line falls through to the generic default ledger.
  if (items.length === 0 && mapping.itemMode === "WITHOUT_ITEM") {
    const rate = rateForRow(head, mapping);
    if (rate !== null && Math.abs(subtotal) >= AMOUNT_EPSILON) {
      items.push({
        name: `Taxable @ ${rate}%`,
        qty: 1,
        rate: subtotal,
        price: subtotal,
        hsnCode: cellText(cellAt(head, f.hsnCode)),
        gstRate: rate,
      });
    }
  }

  const stated = statedTotalForGroup(allRows, mapping, group);
  const total = roundMoney(
    stated !== null && Math.abs(stated) >= AMOUNT_EPSILON
      ? stated
      : subtotal - discount + cgst + sgst + igst + roundOffColumn
  );

  const invoiceNumber = cellText(cellAt(head, f.invoiceNumber));
  const date = parseSheetDate(cellAt(head, f.date)) ?? cleanDate(cellAt(head, f.date));

  return {
    invoiceNumber,
    date,
    // `resolveLedgersForInvoice` reads `vendor`/`vendorGstin` as *the party*
    // for both sides of the book (resolveLedger.ts:285), so the party always
    // goes there. `customerName`/`customerGstin` is filled in as well on the
    // sales side so the record still reads correctly on its own.
    vendor: partyName,
    vendorGstin: partyGstin,
    customerName: isSale ? partyName : null,
    customerGstin: isSale ? partyGstin : null,
    subtotal: roundMoney(subtotal),
    cgst,
    sgst,
    igst,
    discount,
    total,
    items,
  };
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

function readNumber(row: CellValue[], column: ColumnIndex | null): number {
  if (column === null) return 0;
  const value = parseSheetNumber(cellAt(row, column));
  return value === null ? 0 : value;
}

function sumOver(rows: CellValue[][], column: ColumnIndex | null): number {
  if (column === null) return 0;
  return rows.reduce((sum, row) => sum + readNumber(row, column), 0);
}

function decideInterstate(
  head: CellValue[],
  mapping: SheetMapping,
  partyGstin: string | null,
  companyState: string | null
): boolean {
  const explicit = parseInterstateCell(cellAt(head, mapping.gst.interstateColumn));
  if (explicit !== null) return explicit;
  const byGstin = isInterstateByGstin(partyGstin, companyState);
  if (byGstin !== null) return byGstin;
  // Unknowable from this row. Intrastate is the safe default: it is the common
  // case, and it only ever matters in CALCULATE mode — when tax comes from the
  // sheet, which columns carry an amount already answers the question.
  return false;
}

/** Split a tax amount CGST/SGST or IGST. Halves are rounded so they re-add exactly. */
export function splitTax(tax: number, interstate: boolean): { cgst: number; sgst: number; igst: number } {
  const amount = roundMoney(tax);
  if (interstate) return { cgst: 0, sgst: 0, igst: amount };
  const cgst = roundMoney(amount / 2);
  return { cgst, sgst: roundMoney(amount - cgst), igst: 0 };
}

function taxForRateGroup(
  row: CellValue[],
  rateGroup: RateGroup,
  taxable: number,
  source: SheetMapping["gst"]["source"],
  interstate: boolean
): { cgst: number; sgst: number; igst: number } {
  if (source === "CALCULATE") {
    return splitTax(roundMoney((taxable * rateGroup.rate) / 100), interstate);
  }
  return {
    cgst: readNumber(row, rateGroup.cgst),
    sgst: readNumber(row, rateGroup.sgst),
    igst: readNumber(row, rateGroup.igst),
  };
}

/** The GST rate that applies to a row: a rate column if there is one, else the flat rate. */
export function rateForRow(row: CellValue[], mapping: SheetMapping): number | null {
  const column = mapping.gst.rateColumn;
  if (column !== null) {
    const value = parseSheetNumber(cellAt(row, column));
    if (value !== null) {
      // "0.18" and "18" both mean eighteen percent; sheets carry both.
      return value > 0 && value < 1 ? roundMoney(value * 100) : value;
    }
  }
  return mapping.gst.flatRate ?? null;
}

function rowTaxableBase(row: CellValue[], mapping: SheetMapping, hasItems: boolean): number {
  const f = mapping.fields;
  if (hasItems) {
    const amount = readNumber(row, f.amount);
    if (Math.abs(amount) >= AMOUNT_EPSILON) return amount;
    const qty = readNumber(row, f.quantity);
    const rate = readNumber(row, f.rate);
    if (Math.abs(qty * rate) >= AMOUNT_EPSILON) return qty * rate;
  }
  const taxable = readNumber(row, f.taxable);
  if (Math.abs(taxable) >= AMOUNT_EPSILON) return taxable;
  return readNumber(row, f.amount);
}

function itemsFromRow(row: CellValue[], mapping: SheetMapping): NormalizedItem[] {
  const f = mapping.fields;
  const name = cellText(cellAt(row, f.itemName));
  const qty = readNumber(row, f.quantity);
  const rate = readNumber(row, f.rate);
  let price = readNumber(row, f.amount);
  if (Math.abs(price) < AMOUNT_EPSILON) price = readNumber(row, f.taxable);
  if (Math.abs(price) < AMOUNT_EPSILON) price = qty * rate;
  if (!name && Math.abs(price) < AMOUNT_EPSILON) return [];

  let gstRate = rateForRow(row, mapping);
  if (gstRate === null && mapping.gst.taxLayout === "WIDE") {
    // On a WITH_ITEM wide sheet the rate is whichever block this row populated.
    const populated = mapping.gst.rateGroups.find(
      (candidate) => Math.abs(readNumber(row, candidate.taxable)) >= AMOUNT_EPSILON
    );
    gstRate = populated?.rate ?? null;
  }
  if (gstRate === null && mapping.gst.taxLayout === "LONG" && Math.abs(price) >= AMOUNT_EPSILON) {
    // Last resort: infer the rate from the tax actually charged, and only when
    // it lands on a real GST slab. A derived 17.6% is noise, not a rate.
    const tax =
      readNumber(row, mapping.gst.cgst) +
      readNumber(row, mapping.gst.sgst) +
      readNumber(row, mapping.gst.igst);
    if (Math.abs(tax) >= AMOUNT_EPSILON) {
      const derived = (tax / price) * 100;
      const slab = [0, 0.25, 3, 5, 12, 18, 28].find((s) => Math.abs(s - derived) < 0.51);
      if (slab !== undefined) gstRate = slab;
    }
  }

  return [
    {
      name: name ?? "Item",
      qty: qty || 1,
      rate: roundMoney(rate || (qty ? price / qty : price)),
      price: roundMoney(price),
      hsnCode: cellText(cellAt(row, f.hsnCode)),
      gstRate,
    },
  ];
}
