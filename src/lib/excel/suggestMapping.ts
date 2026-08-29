/**
 * Guess which column is which, before the user has told us anything.
 *
 * Their own meta description is the most precise statement of what auto-mapping
 * does anywhere in their corpus: "Sales/Purchase Excel data is auto-mapped using
 * keywords and past patterns." Keywords plus recall of a saved mapping. That is
 * the whole mechanism, and it is why their marketplace guides all end with the
 * same warning — "Ensure that column headers match exactly with Meesho's sales
 * format for every upload. If any discrepancies arise, manually adjust the
 * mapping." A renamed column drops them straight back to hand-mapping.
 *
 * Two things here are meant to remove that failure mode:
 *
 *  1. **Matching is on the normalised header**, then on substring, then on a
 *     small edit distance — so "Invoice No.", "invoice_no" and "Invioce No" all
 *     land on the same field.
 *  2. **Sampled cell values are scored, not just header text.** A column of
 *     `27AAPFU0939F1ZV`-shaped strings is a GSTIN column whatever it is called,
 *     and a column of dates is a date column. Header text is evidence; the data
 *     is also evidence, and when they disagree the data usually wins.
 *
 * Everything returned is a *suggestion* with a number attached. Below
 * `SUGGEST_FLOOR` we do not guess at all, because a wrong pre-filled mapping
 * that the user does not notice is worse than an empty one they must fill in.
 */

import type {
  CellValue,
  ColumnIndex,
  ExcelDocType,
  FieldMapping,
  GstMapping,
  ItemMode,
  LayoutDetection,
  LedgerMapping,
  SheetMapping,
} from "./types";
import { normalizeHeader } from "./detectHeader";
import { classifyColumns } from "./detectLayout";
import { toDate, toNumber, toText } from "./normalizeCell";
import { cellText, isBlankCell, isValidGstin, normalizeGstinCell } from "./validate";

// ---------------------------------------------------------------------------
// Synonyms
// ---------------------------------------------------------------------------

export type MappableField = keyof FieldMapping;

/**
 * Header text we have seen mean each field.
 *
 * Written already normalised (lower case, punctuation folded to single spaces)
 * because that is what `normalizeHeader` produces and comparing anything else
 * would be comparing two different alphabets. Entries drawn from the shapes in
 * the competitor's own permutation and marketplace articles, plus ordinary
 * Tally and Busy exports.
 */
export const FIELD_SYNONYMS: Record<MappableField, string[]> = {
  invoiceNumber: [
    "invoice no", "invoice number", "invoice", "inv no", "inv number", "inv", "inv #",
    "bill no", "bill number", "bill", "voucher no", "voucher number", "vch no", "vch no.",
    "document number", "document no", "doc no", "reference no", "ref no", "reference",
    "seller invoice no", "supplier invoice no", "supplier invoice number", "buyer invoice no",
    "journal no", "journal number", "entry no", "sr no", "serial no", "sub order num",
    "order num", "isin",
  ],
  date: [
    "date", "invoice date", "bill date", "voucher date", "txn date", "transaction date",
    "trade date", "order date", "doc date", "document date", "posting date", "entry date",
    "buy date", "sell date", "sale date", "purchase date", "execution date",
    "execution date and time", "order date time", "order execution time", "cust invoice date",
    "seller invoice date", "dated", "dt",
  ],
  partyName: [
    "party", "party name", "party a c name", "party account name", "party account",
    "customer", "customer name", "supplier", "supplier name", "vendor", "vendor name",
    "buyer", "buyer name", "seller name", "account name", "name of party", "client name",
    "sup name", "investor", "consignee", "billed to", "bill to", "sold to", "debtor",
    "creditor", "name",
  ],
  partyGstin: [
    "gstin", "gst no", "gst number", "gstin no", "gstin number", "party gstin", "gst in",
    "customer gstin", "supplier gstin", "vendor gstin", "buyer gstin", "gstin uin",
    "gst identification number", "gstin of recipient", "gstin of supplier", "recipient gstin",
  ],
  narration: [
    "narration", "remarks", "remark", "description", "note", "notes", "comment", "comments",
    "particulars of entry", "purpose",
  ],
  taxable: [
    "taxable", "taxable value", "taxable amount", "net amount", "net value", "basic",
    "basic amount", "basic value", "assessable value", "amount before tax", "value before tax",
    "base price", "gross amount", "sub total", "subtotal", "taxable amt", "invoice value before tax",
  ],
  total: [
    "total", "invoice total", "grand total", "net payable", "bill amount", "invoice amount",
    "total amount", "total value", "amount payable", "net amount payable", "final amount",
    "bill total", "total invoice value", "invoice value", "net total", "gross total",
    "total after tax", "payable amount",
  ],
  discount: [
    "discount", "discount amount", "discount value", "less discount", "disc", "disc amount",
    "trade discount", "cash discount", "scheme discount",
  ],
  roundOff: ["round off", "roundoff", "rounding", "rounded off", "round off amount", "round"],
  itemName: [
    "item", "item name", "name of item", "product", "product name", "description of goods",
    "goods description", "stock item", "stock name", "material", "material description",
    "service", "scrip", "symbol", "scrip code symbol", "seller style code", "style code",
    "sku", "article", "item description",
  ],
  quantity: [
    "qty", "quantity", "qnty", "units", "unit", "nos", "no of units", "shipped qty",
    "billed qty", "billed quantity", "qty shipped", "pcs",
  ],
  rate: [
    "rate", "unit rate", "unit price", "price", "price rs", "rate per unit", "mrp",
    "selling price", "purchase rate", "rate per qty",
  ],
  amount: [
    "amount", "amt", "line amount", "line total", "item amount", "item total", "gross",
    "buy value", "sell value", "amount rs", "value", "row total", "tcs taxable amount",
  ],
  hsnCode: ["hsn", "hsn code", "hsncode", "hsn sac", "hsn sac code", "sac", "sac code", "hsn no"],
  ledgerName: [
    "ledger", "ledger name", "account", "account name", "particulars", "gl account",
    "ledger account", "head", "account head", "dr cr ledger",
  ],
  debit: ["debit", "dr", "debit amount", "dr amount", "debit value", "debit rs"],
  credit: ["credit", "cr", "credit amount", "cr amount", "credit value", "credit rs"],
};

/** The GST rate column, which is not a `FieldMapping` field but is mapped the same way. */
const RATE_COLUMN_SYNONYMS = [
  "gst rate", "gst %", "gst percent", "gst percentage", "tax rate", "tax %", "rate of tax",
  "rate of gst", "gst rate %", "tax percentage", "rate %", "gst slab", "tax slab",
];

/** An explicit interstate/intrastate column. */
const INTERSTATE_SYNONYMS = [
  "interstate", "inter state", "is interstate", "inter intra", "intra inter",
  "supply type", "type of supply", "nature of supply", "inter or intra",
];

/**
 * Below this we leave the field unmapped and let the user pick.
 *
 * Deliberately not zero: a confidently wrong pre-fill is the thing that makes a
 * user stop reading the mapping screen, and a mapping screen nobody reads is
 * how a month of vouchers gets posted against the wrong ledger.
 */
export const SUGGEST_FLOOR = 0.45;

/** How many data rows to look at when scoring a column by its contents. */
const SAMPLE_LIMIT = 40;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface FieldSuggestion {
  column: ColumnIndex | null;
  /** 0–1. 1 means the header is an exact match for a known name for this field. */
  confidence: number;
  /** Shown in the UI so a guess is auditable rather than magic. */
  reason: string;
}

export interface MappingSuggestion {
  /** Ready to hand to `mapRows`, once the user has picked ledgers. */
  mapping: SheetMapping;
  /** Per-field confidence and justification, including for the fields we skipped. */
  fields: Record<MappableField, FieldSuggestion>;
  /** Columns nothing claimed, so the wizard can show what it is ignoring. */
  unmappedColumns: ColumnIndex[];
  /** Mean confidence over the fields that matter for this doc type. */
  overall: number;
}

export interface SuggestOptions {
  /**
   * Data rows. Scoring the contents is what catches a GSTIN column called
   * "Tax ID" and rejects a "Date" column that turns out to hold serial numbers.
   */
  sampleRows?: CellValue[][];
  /** Carried into the returned mapping; the parser knows it, we do not. */
  headerRowIndex?: number;
}

// ---------------------------------------------------------------------------
// suggestMapping
// ---------------------------------------------------------------------------

export function suggestMapping(
  headers: string[],
  layout: LayoutDetection,
  docType: ExcelDocType,
  itemMode: ItemMode,
  opts: SuggestOptions = {}
): MappingSuggestion {
  const keys = headers.map(normalizeHeader);
  const samples = sampleColumns(headers.length, opts.sampleRows ?? []);
  const shapes = samples.map(profileColumn);

  // Columns the tax layout has already claimed are out of the running for the
  // ordinary fields: a "5% CGST" column is not the invoice total, however much
  // the word "amount" appears in it.
  const claimed = new Set<ColumnIndex>();
  const taxColumns = classifyColumns(headers);
  if (layout.taxLayout === "WIDE") {
    for (const group of layout.rateGroups) {
      for (const column of [group.taxable, group.cgst, group.sgst, group.igst]) {
        if (column !== null) claimed.add(column);
      }
    }
  } else {
    for (const column of taxColumns) {
      if (column.kind && column.kind !== "TAXABLE") claimed.add(column.index);
    }
  }

  const fieldsInPlay = fieldsFor(docType, itemMode);
  const suggestions = assign(keys, shapes, fieldsInPlay, claimed);

  const fields: Record<MappableField, FieldSuggestion> = {} as Record<
    MappableField,
    FieldSuggestion
  >;
  for (const field of Object.keys(FIELD_SYNONYMS) as MappableField[]) {
    fields[field] = suggestions.get(field) ?? {
      column: null,
      confidence: 0,
      reason: fieldsInPlay.includes(field)
        ? "No column looked like this field."
        : `Not used for ${docType}${itemMode === "WITH_ITEM" ? " with items" : ""}.`,
    };
  }

  const fieldMapping: FieldMapping = {
    invoiceNumber: fields.invoiceNumber.column,
    date: fields.date.column,
    partyName: fields.partyName.column,
    partyGstin: fields.partyGstin.column,
    narration: fields.narration.column,
    taxable: fields.taxable.column,
    total: fields.total.column,
    discount: fields.discount.column,
    roundOff: fields.roundOff.column,
    itemName: fields.itemName.column,
    quantity: fields.quantity.column,
    rate: fields.rate.column,
    amount: fields.amount.column,
    hsnCode: fields.hsnCode.column,
    ledgerName: fields.ledgerName.column,
    debit: fields.debit.column,
    credit: fields.credit.column,
  };

  // A LONG sheet's taxable column is a field, not a tax column, so hand it over
  // when the header classifier found one and the synonyms did not.
  if (layout.taxLayout === "LONG" && fieldMapping.taxable === null) {
    const taxable = taxColumns.find((c) => c.kind === "TAXABLE" && c.rate === null);
    if (taxable) {
      fieldMapping.taxable = taxable.index;
      fields.taxable = {
        column: taxable.index,
        confidence: 0.8,
        reason: `"${taxable.header}" reads as the taxable value column.`,
      };
    }
  }

  const gst = buildGstMapping(headers, keys, shapes, layout, taxColumns, docType);
  const ledgers: LedgerMapping = {
    // Ledger ids are the user's choice and cannot be guessed from a spreadsheet.
    // The competitor's answer here is to make the accountant type Tally ledger
    // names into the sheet, which is why renaming a ledger breaks their saved
    // mappings; ours stay ids, chosen once on the mapping screen.
    primaryLedgerId: null,
    cgstLedgerId: null,
    sgstLedgerId: null,
    igstLedgerId: null,
    cessLedgerId: null,
    roundOffLedgerId: null,
    discountLedgerId: null,
    perRateLedgerIds: {},
  };

  const used = new Set<ColumnIndex>(claimed);
  for (const value of Object.values(fieldMapping)) {
    if (value !== null) used.add(value);
  }
  if (gst.rateColumn !== null) used.add(gst.rateColumn);
  if (gst.interstateColumn !== null) used.add(gst.interstateColumn);
  for (const column of [gst.cgst, gst.sgst, gst.igst, gst.cess]) {
    if (column !== null) used.add(column);
  }

  const unmappedColumns: ColumnIndex[] = [];
  headers.forEach((_, index) => {
    if (!used.has(index)) unmappedColumns.push(index);
  });

  const scored = fieldsInPlay.map((field) => fields[field].confidence);
  const overall = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0;

  return {
    mapping: {
      docType,
      itemMode,
      headerRowIndex: opts.headerRowIndex ?? 0,
      fields: fieldMapping,
      gst,
      ledgers,
    },
    fields,
    unmappedColumns,
    overall: Math.round(overall * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Which fields are even in play
// ---------------------------------------------------------------------------

/**
 * A field that cannot appear in this kind of sheet must not be offered a column,
 * or "Particulars" ends up mapped to both the item name and the journal ledger.
 */
export function fieldsFor(docType: ExcelDocType, itemMode: ItemMode): MappableField[] {
  if (docType === "JOURNAL") {
    return ["invoiceNumber", "date", "ledgerName", "debit", "credit", "narration", "partyName"];
  }
  const base: MappableField[] = [
    "invoiceNumber",
    "date",
    "partyName",
    "partyGstin",
    "narration",
    "taxable",
    "total",
    "discount",
    "roundOff",
    "hsnCode",
  ];
  if (itemMode === "WITH_ITEM") {
    base.push("itemName", "quantity", "rate", "amount");
  }
  return base;
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

interface Candidate {
  field: MappableField;
  column: ColumnIndex;
  score: number;
  reason: string;
}

function assign(
  keys: string[],
  shapes: ColumnShape[],
  fields: MappableField[],
  claimed: Set<ColumnIndex>
): Map<MappableField, FieldSuggestion> {
  const candidates: Candidate[] = [];
  for (const field of fields) {
    keys.forEach((key, column) => {
      if (claimed.has(column)) return;
      const scored = scoreField(field, key, shapes[column]);
      if (scored.score < SUGGEST_FLOOR) return;
      candidates.push({ field, column, score: scored.score, reason: scored.reason });
    });
  }

  // Greedy over the whole grid rather than field-by-field: the strongest pairing
  // anywhere wins first, so a column that is a mediocre match for one field and
  // an excellent match for another goes to the field that needs it.
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const result = new Map<MappableField, FieldSuggestion>();
  const takenColumns = new Set<ColumnIndex>();
  for (const candidate of candidates) {
    if (result.has(candidate.field) || takenColumns.has(candidate.column)) continue;
    result.set(candidate.field, {
      column: candidate.column,
      confidence: Math.round(candidate.score * 100) / 100,
      reason: candidate.reason,
    });
    takenColumns.add(candidate.column);
  }
  return result;
}

/** Fields whose data has a shape distinctive enough to identify them on its own. */
const SELF_EVIDENT: ReadonlySet<MappableField> = new Set<MappableField>([
  "partyGstin",
  "date",
  "hsnCode",
]);

export function scoreField(
  field: MappableField,
  headerKey: string,
  shape: ColumnShape
): { score: number; reason: string } {
  const header = headerScore(headerKey, FIELD_SYNONYMS[field]);
  const value = valueScore(field, shape);

  let score: number;
  let reason: string;
  if (header.score > 0) {
    score = Math.min(1, header.score + 0.12 * value);
    reason =
      header.kind === "exact"
        ? `Header "${headerKey}" is a known name for this field.`
        : header.kind === "contains"
          ? `Header "${headerKey}" contains "${header.alias}".`
          : `Header "${headerKey}" is one or two characters from "${header.alias}".`;
    if (value > 0.6) reason += " The column's values agree.";
  } else if (SELF_EVIDENT.has(field) && value > 0) {
    // The header said nothing useful, but the data is unmistakable. This is the
    // case that removes "manually adjust the mapping": a GSTIN column called
    // "Tax ID" is still a GSTIN column.
    score = 0.85 * value;
    reason = `Header "${headerKey}" matched nothing, but the column's values look like this field.`;
  } else {
    return { score: 0, reason: "" };
  }

  // Contradiction. A column headed "Date" that holds no dates is a column the
  // user has to look at, not one to pre-fill silently.
  if (SELF_EVIDENT.has(field) && shape.nonBlank >= 3 && value < 0.2) {
    score = Math.min(score, 0.44);
    reason = `Header "${headerKey}" says ${field}, but the values in the column do not look like it.`;
  }

  return { score: Math.round(score * 1000) / 1000, reason };
}

// ---------------------------------------------------------------------------
// Header matching
// ---------------------------------------------------------------------------

type HeaderMatchKind = "exact" | "contains" | "fuzzy";

function headerScore(
  key: string,
  aliases: string[]
): { score: number; kind: HeaderMatchKind; alias: string } {
  if (!key) return { score: 0, kind: "fuzzy", alias: "" };
  const tokens = new Set(key.split(" ").filter(Boolean));
  let best = { score: 0, kind: "fuzzy" as HeaderMatchKind, alias: "" };

  for (const alias of aliases) {
    if (key === alias) return { score: 1, kind: "exact", alias };

    const aliasTokens = alias.split(" ").filter(Boolean);
    if (aliasTokens.length > 0 && aliasTokens.every((t) => tokens.has(t))) {
      // Every word of the alias is present: "party a c name" inside
      // "party a c name buyer". Longer aliases score higher because they are
      // more specific — "invoice number" beats a bare "invoice".
      const cover = alias.length / Math.max(key.length, 1);
      const score = 0.72 + 0.2 * Math.min(1, cover);
      if (score > best.score) best = { score, kind: "contains", alias };
      continue;
    }

    if (alias.length >= 4 && key.includes(alias)) {
      const score = 0.66 + 0.18 * (alias.length / Math.max(key.length, 1));
      if (score > best.score) best = { score, kind: "contains", alias };
      continue;
    }

    // Typo tolerance, scaled: one edit on a short word, two on a long one.
    // "Invioce No" is a real header, seen more than once.
    const tolerance = alias.length <= 5 ? 1 : 2;
    const distance = levenshtein(key, alias, tolerance);
    if (distance <= tolerance) {
      const score = 0.7 - 0.07 * distance;
      if (score > best.score) best = { score, kind: "fuzzy", alias };
    }
  }

  return { score: Math.min(best.score, 0.95), kind: best.kind, alias: best.alias };
}

/** Levenshtein, abandoning early once the distance cannot come in under `cap`. */
export function levenshtein(a: string, b: string, cap = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > cap) return cap + 1;
    previous = current;
  }
  return previous[b.length];
}

// ---------------------------------------------------------------------------
// Value shape
// ---------------------------------------------------------------------------

export interface ColumnShape {
  samples: CellValue[];
  nonBlank: number;
  gstin: number;
  date: number;
  numeric: number;
  /** Numbers that look like money: not all integers, or large. */
  money: number;
  /** 4, 6 or 8 digit codes. */
  hsn: number;
  /** Numbers on a real GST slab, or any 0–28 with a percent sign. */
  ratelike: number;
  boolish: number;
  distinctRatio: number;
}

function sampleColumns(width: number, rows: CellValue[][]): CellValue[][] {
  const columns: CellValue[][] = Array.from({ length: width }, () => []);
  const limit = Math.min(rows.length, SAMPLE_LIMIT);
  for (let r = 0; r < limit; r += 1) {
    for (let c = 0; c < width; c += 1) {
      columns[c].push(rows[r]?.[c] ?? null);
    }
  }
  return columns;
}

const HSN_RE = /^\d{4}(\d{2}(\d{2})?)?$/;
const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28];
const BOOLISH = new Set([
  "y", "n", "yes", "no", "true", "false", "inter", "intra", "interstate", "intrastate",
  "inter state", "intra state", "local",
]);

export function profileColumn(samples: CellValue[]): ColumnShape {
  const shape: ColumnShape = {
    samples,
    nonBlank: 0,
    gstin: 0,
    date: 0,
    numeric: 0,
    money: 0,
    hsn: 0,
    ratelike: 0,
    boolish: 0,
    distinctRatio: 0,
  };
  const seen = new Set<string>();
  let integers = 0;

  for (const sample of samples) {
    if (isBlankCell(sample)) continue;
    shape.nonBlank += 1;
    const text = toText(sample);
    seen.add(text.toLowerCase());

    if (isValidGstin(normalizeGstinCell(sample))) shape.gstin += 1;
    // A bare number is only a date if it is an Excel serial; `toDate` already
    // refuses small numbers, which is what keeps a quantity column from
    // reading as dates.
    if (toDate(sample) !== null) shape.date += 1;

    const numeric = toNumber(sample);
    if (numeric !== null) {
      shape.numeric += 1;
      if (Number.isInteger(numeric)) integers += 1;
      if (Math.abs(numeric) >= 1) shape.money += 1;
      if (SLABS.some((s) => Math.abs(s - numeric) < 0.001)) shape.ratelike += 1;
    }
    if (typeof sample === "boolean" || BOOLISH.has(text.toLowerCase())) shape.boolish += 1;
    if (typeof sample === "string" && HSN_RE.test(text.replace(/\s+/g, ""))) shape.hsn += 1;
    else if (typeof sample === "number" && HSN_RE.test(String(sample))) shape.hsn += 1;
  }

  if (shape.nonBlank > 0) {
    shape.distinctRatio = seen.size / shape.nonBlank;
    // Money that is entirely whole numbers in a small range is more likely a
    // quantity; demote it rather than calling it money.
    if (integers === shape.numeric && shape.numeric > 0) shape.money = Math.floor(shape.money / 2);
  }
  return shape;
}

function ratio(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

export function valueScore(field: MappableField, shape: ColumnShape): number {
  if (shape.nonBlank === 0) return 0;
  const n = shape.nonBlank;
  switch (field) {
    case "partyGstin":
      return ratio(shape.gstin, n);
    case "date":
      return ratio(shape.date, n);
    case "hsnCode":
      return ratio(shape.hsn, n);
    case "quantity":
      return ratio(shape.numeric, n) * 0.7;
    case "taxable":
    case "total":
    case "amount":
    case "rate":
    case "discount":
    case "roundOff":
    case "debit":
    case "credit":
      return ratio(shape.money, n);
    case "invoiceNumber":
      // High cardinality and rarely a plain amount.
      return shape.distinctRatio > 0.8 ? 0.6 : shape.distinctRatio * 0.5;
    case "partyName":
    case "itemName":
    case "ledgerName":
    case "narration":
      return ratio(n - shape.numeric - shape.date, n);
  }
}

// ---------------------------------------------------------------------------
// GST stage
// ---------------------------------------------------------------------------

function buildGstMapping(
  headers: string[],
  keys: string[],
  shapes: ColumnShape[],
  layout: LayoutDetection,
  taxColumns: ReturnType<typeof classifyColumns>,
  docType: ExcelDocType
): GstMapping {
  const gst: GstMapping = {
    source: "FROM_SHEET",
    taxLayout: layout.taxLayout,
    cgst: null,
    sgst: null,
    igst: null,
    cess: null,
    rateGroups: layout.taxLayout === "WIDE" ? layout.rateGroups : [],
    rateColumn: null,
    flatRate: null,
    interstateColumn: null,
  };

  // A journal has no GST stage at all; leave the whole thing inert rather than
  // inventing tax columns for a sheet that has none.
  if (docType === "JOURNAL") return { ...gst, source: "FROM_SHEET" };

  if (layout.taxLayout === "LONG") {
    // Only the rate-less tax columns: on a LONG sheet a column headed
    // "CGST 9%" still holds the CGST amount, but a *set* of them would have
    // been detected as WIDE, so whichever we find first is the one.
    const pick = (kind: string) =>
      taxColumns.find((c) => c.kind === kind)?.index ?? null;
    gst.cgst = pick("CGST");
    gst.sgst = pick("SGST");
    gst.igst = pick("IGST");
    gst.cess = pick("CESS");
  }

  const rateColumn = bestByHeader(keys, RATE_COLUMN_SYNONYMS, 0.7);
  // A "Rate" column of unit prices is not a GST rate column: insist the values
  // land on real slabs before believing it.
  if (rateColumn !== null) {
    const shape = shapes[rateColumn];
    if (shape.nonBlank === 0 || ratio(shape.ratelike, shape.nonBlank) >= 0.6) {
      gst.rateColumn = rateColumn;
    }
  }

  let interstate = bestByHeader(keys, INTERSTATE_SYNONYMS, 0.7);
  if (interstate === null) {
    // Fall back to the data: a column of yes/no or inter/intra tokens is an
    // interstate flag whatever it is headed.
    headers.forEach((_, index) => {
      if (interstate !== null) return;
      const shape = shapes[index];
      if (shape.nonBlank >= 3 && ratio(shape.boolish, shape.nonBlank) >= 0.9) {
        if (/inter|intra|state|supply/.test(keys[index])) interstate = index;
      }
    });
  }
  gst.interstateColumn = interstate;

  const hasTaxColumns =
    layout.taxLayout === "WIDE"
      ? layout.rateGroups.some((g) => g.cgst !== null || g.sgst !== null || g.igst !== null)
      : gst.cgst !== null || gst.sgst !== null || gst.igst !== null;

  // Nothing in the sheet carries a tax amount, but something carries a rate:
  // derive it. This is their "GST Auto Calculation = Yes" toggle, decided from
  // the sheet rather than asked as a question.
  gst.source = hasTaxColumns ? "FROM_SHEET" : gst.rateColumn !== null ? "CALCULATE" : "FROM_SHEET";

  return gst;
}

function bestByHeader(keys: string[], aliases: string[], floor: number): ColumnIndex | null {
  let best: ColumnIndex | null = null;
  let bestScore = floor;
  keys.forEach((key, index) => {
    const { score } = headerScore(key, aliases);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** Exported for the wizard: the header text a column would be described by. */
export function describeColumn(headers: string[], column: ColumnIndex | null): string | null {
  if (column === null) return null;
  return cellText(headers[column] ?? null);
}
