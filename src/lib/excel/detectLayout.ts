/**
 * Work out how a sheet expresses tax, from its headers alone.
 *
 * This is the piece the competitor cannot do. Vyapar TaxOne's mapping UI has
 * exactly one "Amount" slot and one set of three tax-ledger slots, so a sheet
 * shaped `Taxable@5 | SGST@2.5 | CGST@2.5 | Taxable@12 | SGST@6 | CGST@6` has to
 * be forced through it by hand. Their own instructions for that
 * (`horizontal-tax-rate-with-multiple-sgst-cgst-igst-duties-taxes.md`) tell the
 * accountant to "pick the smallest GST Tax Rate Number", map that group into the
 * primary slots, and then shoehorn every remaining rate into Stage 3 "Ledger
 * Mapping" - the generic (ledger, column) pairs slot meant for freight and
 * discount. Eight of their twenty-four GST articles exist to explain that
 * procedure for a slightly different sheet.
 *
 * Detecting the repeat is a header pattern match. Three notes from the research
 * that shape the implementation:
 *
 *   - Rate groups are **not necessarily contiguous**. Nothing below looks at
 *     column adjacency; grouping is by extracted rate only.
 *   - Rates are **not necessarily ordered**. The output is sorted ascending for
 *     display, but the sort carries no meaning - their "smallest rate first"
 *     rule is stated with no reason given and is not copied.
 *   - Half rates are the norm. A sheet writes `SGST 2.5` and `CGST 2.5` against
 *     `Taxable 5`, so 2.5 and 5 must end up in one group, not two.
 */

import type { ColumnIndex, LayoutDetection, RateGroup, TaxLayout } from "./types";
import { normalizeWhitespace } from "./normalizeCell";
import { normalizeHeader } from "./detectHeader";

/**
 * Rates that name a whole GST slab rather than half of one.
 *
 * Used only to decide whether a lone `CGST 9` / `SGST 9` pair means "the 9%
 * slab" (there is no such slab) or "half of 18". Deliberately excludes 2.5, 6,
 * 7.5, 9 and 14, which only ever appear as halves.
 */
const CANONICAL_GROUP_RATES = new Set([0, 0.25, 1, 1.5, 3, 5, 12, 18, 28, 40]);

export type TaxColumnKind = "TAXABLE" | "CGST" | "SGST" | "IGST" | "CESS";

export interface TaxColumn {
  index: ColumnIndex;
  header: string;
  kind: TaxColumnKind | null;
  /** The rate the header names, or null when the header names no rate. */
  rate: number | null;
}

// ---------------------------------------------------------------------------
// Reading one header
// ---------------------------------------------------------------------------

/** Longest first: alternation is first-match, and "gst" is a prefix of nothing. */
const RATE_WORDS = "cgst|sgst|igst|utgst|taxable|cess|rate|gst|tax";
const NUMBER = "\\d{1,3}(?:\\.\\d{1,2})?";
/**
 * `\b` is wrong at the end of a tax word: `_` is a word character, so `\bcgst\b`
 * does not match "CGST_14" - a header shape that survives an export to CSV and
 * back. These bound on letters instead.
 */
const BEFORE_WORD = "(?:^|[^a-z0-9])";
const AFTER_WORD = "(?![a-z])";

/**
 * The rate a header names, in the four shapes sheets actually use.
 *
 * Ordered by how much the header is telling us: an explicit `%` or `@` is a
 * declaration, a number sitting next to the word GST is an inference, and a
 * bare number is only believed when it is a real slab rate. That last guard is
 * what stops "Column 5" and "Line 12" becoming rate groups.
 */
export function extractRate(header: string): number | null {
  const text = normalizeWhitespace(header).toLowerCase();
  if (text === "") return null;

  const patterns = [
    new RegExp(`(${NUMBER})\\s*%`),
    new RegExp(`@\\s*(${NUMBER})`),
    new RegExp(`${BEFORE_WORD}(?:${RATE_WORDS})${AFTER_WORD}[\\s._@-]*(${NUMBER})(?![0-9.])`),
    new RegExp(`(?:^|[^0-9.])(${NUMBER})[\\s._-]*(?:${RATE_WORDS})${AFTER_WORD}`),
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const rate = Number(match[1]);
      if (Number.isFinite(rate) && rate >= 0 && rate <= 100) return rate;
    }
  }

  return null;
}

/**
 * Which tax slot a column fills.
 *
 * CESS is tested first because "Cess" columns often sit inside a rate group and
 * would otherwise be swallowed by the taxable-value pattern. A combined
 * "CGST/SGST" header resolves to CGST - the amount in it is one half, and
 * splitting it is the mapper's decision, not ours.
 */
export function classifyTaxColumn(header: string): TaxColumnKind | null {
  const key = normalizeHeader(header);
  if (key === "") return null;

  if (/\bcess\b/.test(key)) return "CESS";
  if (/\bc\s?gst\b|\bcentral\s+(?:gst|tax)\b/.test(key)) return "CGST";
  if (/\bs\s?gst\b|\butgst\b|\bstate\s+(?:gst|tax)\b|\bunion\s+territory\b/.test(key)) return "SGST";
  if (/\bi\s?gst\b|\bintegrated\s+(?:gst|tax)\b/.test(key)) return "IGST";
  if (/\btaxable\b|\bassessable\b|\bbasic\s+(?:amount|value)\b|\bnet\s+(?:amount|value)\b/.test(key)) {
    return "TAXABLE";
  }

  // "18% Amount" is a taxable column; a bare "Amount" is not, because in a LONG
  // sheet that is the invoice total and belongs to the field mapping instead.
  if (extractRate(header) !== null && /\b(?:amount|amt|value|sales|purchase|turnover)\b/.test(key)) {
    return "TAXABLE";
  }

  return null;
}

export function classifyColumns(headers: string[]): TaxColumn[] {
  return headers.map((header, index) => ({
    index,
    header,
    kind: classifyTaxColumn(header),
    rate: extractRate(header),
  }));
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

type Bucket = { rate: number; columns: TaxColumn[] };

function isHalfOnly(bucket: Bucket): boolean {
  return (
    bucket.columns.length > 0 &&
    bucket.columns.every((c) => c.kind === "CGST" || c.kind === "SGST")
  );
}

/**
 * Fold `CGST 2.5 / SGST 2.5` into the `Taxable 5` group.
 *
 * A bucket holding nothing but CGST and SGST columns is a half-rate bucket when
 * either the doubled rate already exists in the sheet (the common case, and the
 * strongest evidence available) or the doubled rate is a real slab while this
 * one is not. Everything else is left alone: a sheet may legitimately carry a
 * 1.5% group, and inventing a 3% one would be worse than leaving it.
 */
function mergeHalfRates(buckets: Map<number, Bucket>): Map<number, Bucket> {
  const merged = new Map<number, Bucket>();
  const halves: Bucket[] = [];

  for (const bucket of buckets.values()) {
    const doubled = bucket.rate * 2;
    const shouldMerge =
      bucket.rate > 0 &&
      isHalfOnly(bucket) &&
      (buckets.has(doubled) ||
        (CANONICAL_GROUP_RATES.has(doubled) && !CANONICAL_GROUP_RATES.has(bucket.rate)));

    if (shouldMerge) halves.push(bucket);
    else merged.set(bucket.rate, { rate: bucket.rate, columns: bucket.columns.slice() });
  }

  for (const half of halves) {
    const target = half.rate * 2;
    const existing = merged.get(target);
    if (existing) existing.columns.push(...half.columns);
    else merged.set(target, { rate: target, columns: half.columns.slice() });
  }

  return merged;
}

/** First column of each kind wins; a repeat is a second sheet's worth of data. */
function bucketToRateGroup(bucket: Bucket): RateGroup {
  const pick = (kind: TaxColumnKind): ColumnIndex | null => {
    const found = bucket.columns.find((c) => c.kind === kind);
    return found ? found.index : null;
  };
  return {
    rate: bucket.rate,
    taxable: pick("TAXABLE"),
    cgst: pick("CGST"),
    sgst: pick("SGST"),
    igst: pick("IGST"),
  };
}

function filledSlots(group: RateGroup): number {
  return [group.taxable, group.cgst, group.sgst, group.igst].filter((v) => v !== null).length;
}

function buildRateGroups(columns: TaxColumn[]): RateGroup[] {
  const buckets = new Map<number, Bucket>();
  for (const column of columns) {
    if (column.rate === null || column.kind === null || column.kind === "CESS") continue;
    const bucket = buckets.get(column.rate) ?? { rate: column.rate, columns: [] };
    bucket.columns.push(column);
    buckets.set(column.rate, bucket);
  }

  return Array.from(mergeHalfRates(buckets).values())
    .map(bucketToRateGroup)
    .filter((group) => filledSlots(group) > 0)
    .sort((a, b) => a.rate - b.rate);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0, Math.min(0.98, Math.round(value * 100) / 100));
}

function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate : rate.toFixed(2).replace(/0$/, "")}%`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Which layout the headers describe, how sure we are, and why.
 *
 * Both layouts are scored and the higher wins, rather than short-circuiting on
 * the first LONG-looking column, because a sheet that carries both fixed and
 * per-rate tax columns is genuinely ambiguous and the wizard needs to be told
 * so. `confidence` below `LAYOUT_CONFIDENCE_FLOOR` means "ask, do not assume";
 * `reason` is rendered in the UI, so it names the columns it actually saw.
 */
export function detectLayout(headers: string[]): LayoutDetection {
  const columns = classifyColumns(headers);
  const taxColumns = columns.filter((c) => c.kind !== null);

  const fixedTax = taxColumns.filter(
    (c) => c.rate === null && (c.kind === "CGST" || c.kind === "SGST" || c.kind === "IGST")
  );
  const fixedKinds = new Set(fixedTax.map((c) => c.kind));
  const hasFixedTaxable = taxColumns.some((c) => c.rate === null && c.kind === "TAXABLE");
  // Deliberately not a bare "rate": in a WITH_ITEM sheet that column is the unit
  // price, and treating it as a tax rate would turn 450 into a 450% slab.
  const hasRateColumn = columns.some((c) =>
    /\b(?:gst|tax)\s*rate\b|\brate\s+of\s+tax\b|\brate\s*%/.test(normalizeHeader(c.header))
  );

  const rateGroups = buildRateGroups(columns);
  const wide = scoreWide(rateGroups, fixedKinds.size);
  const long = scoreLong(fixedKinds, hasFixedTaxable, hasRateColumn, rateGroups.length);

  if (rateGroups.length >= 2 && wide >= long) {
    return {
      taxLayout: "WIDE" as TaxLayout,
      rateGroups,
      confidence: clamp(wide),
      reason: wideReason(rateGroups, columns, fixedKinds.size),
    };
  }

  return {
    taxLayout: "LONG" as TaxLayout,
    rateGroups: [],
    confidence: clamp(long),
    reason: longReason(fixedTax, hasFixedTaxable, hasRateColumn, rateGroups.length),
  };
}

function scoreLong(
  fixedKinds: Set<TaxColumnKind | null>,
  hasFixedTaxable: boolean,
  hasRateColumn: boolean,
  rateGroupCount: number
): number {
  if (fixedKinds.size === 0) {
    // No tax columns at all is still LONG - the mapper can calculate tax from a
    // rate column - but there is nothing here to be confident about.
    return hasRateColumn ? 0.3 : 0.15;
  }

  let score = 0.45;
  if (fixedKinds.size >= 2) score += 0.2;
  if (fixedKinds.size >= 3) score += 0.15;
  if (hasFixedTaxable) score += 0.08;
  if (hasRateColumn) score += 0.05;
  if (rateGroupCount >= 2) score -= 0.25;
  return score;
}

function scoreWide(rateGroups: RateGroup[], fixedKindCount: number): number {
  if (rateGroups.length < 2) return 0;

  let score = 0.5;
  const complete = rateGroups.filter((g) => filledSlots(g) >= 2).length;
  score += Math.min(0.2, complete * 0.08);
  if (rateGroups.length >= 3) score += 0.08;
  if (rateGroups.every((g) => CANONICAL_GROUP_RATES.has(g.rate))) score += 0.12;
  else score -= 0.12;
  if (rateGroups.every((g) => g.taxable !== null)) score += 0.1;
  if (fixedKindCount >= 2) score -= 0.2;
  return score;
}

function longReason(
  fixedTax: TaxColumn[],
  hasFixedTaxable: boolean,
  hasRateColumn: boolean,
  rateGroupCount: number
): string {
  if (fixedTax.length === 0) {
    const tail = hasRateColumn
      ? "there is a rate column, so tax can be calculated rather than read."
      : "there is no rate column either, so tax will have to be supplied at mapping time.";
    return `No CGST/SGST/IGST columns and no repeating per-rate column groups; ${tail}`;
  }

  const names = joinList(fixedTax.map((c) => `"${normalizeWhitespace(c.header)}"`));
  const parts = [`Fixed tax columns ${names} carry no rate in their headers, so each row states its own tax.`];
  if (hasFixedTaxable) parts.push("A taxable-value column sits alongside them.");
  if (rateGroupCount >= 2) {
    parts.push(
      `${rateGroupCount} per-rate column groups were also found, so this sheet is mixed - confirm before mapping.`
    );
  }
  return parts.join(" ");
}

function wideReason(rateGroups: RateGroup[], columns: TaxColumn[], fixedKindCount: number): string {
  const rates = joinList(rateGroups.map((g) => formatRate(g.rate)));
  const parts = [
    `${rateGroups.length} repeating per-rate column groups (${rates}), matched on header text rather than column position.`,
  ];

  const halves = columns
    .filter((c) => c.rate !== null && (c.kind === "CGST" || c.kind === "SGST"))
    .filter((c) => !rateGroups.some((g) => g.rate === c.rate));
  if (halves.length > 0) {
    const halfRates = joinList(
      Array.from(new Set(halves.map((c) => formatRate(c.rate as number)))).sort()
    );
    parts.push(`Half-rate columns (${halfRates}) were folded into their parent slabs.`);
  }

  const incomplete = rateGroups.filter((g) => filledSlots(g) < 2);
  if (incomplete.length > 0) {
    parts.push(
      `${incomplete.length} of them has only one mapped column, so check the ones that look thin.`
    );
  }
  if (fixedKindCount >= 2) {
    parts.push("Fixed CGST/SGST/IGST columns are present too, so this sheet is mixed.");
  }
  return parts.join(" ");
}
