/**
 * Saved column mappings, and finding the right one for a new sheet.
 *
 * The competitor's memory is keyed on the exact text of the header row, scoped
 * to the client company and document type. Their own guides are candid about the
 * cost: "Ensure that column headers match exactly with Meesho's sales format for
 * every upload. If any discrepancies arise, manually adjust the mapping."
 *
 * Two deliberate differences here.
 *
 *  1. **The key is a fingerprint of the *normalised* headers**, so "Invoice No.",
 *     "invoice no" and "INVOICE_NO" are one layout, and a fuzzy overlap score
 *     catches the case where a marketplace renames one column out of twenty.
 *  2. **Lookup crosses the client boundary.** A template is stored against the
 *     client it was learned on, but searched across everything the *user* owns:
 *     a firm that has mapped one client's Tally export has effectively mapped
 *     every client on the same accounting package. Whether they do this is the
 *     one thing their docs never say; either way it is where clients 2 through
 *     200 stop costing a mapping session each. Same-client matches still rank
 *     first, because that template's ledger choices are this client's.
 *
 * The learning signal is `hitCount` + `lastUsedAt`, exactly as
 * `src/lib/accounting/rememberMapping.ts` does it for ledgers: what gets used,
 * wins.
 */

import type { PrismaClient } from "@prisma/client";
import type { ExcelDocType, ItemMode, SheetMapping, TemplateMatch } from "./types";
import { headerFingerprint, normalizeHeader } from "./detectHeader";
import { matchBuiltinTemplates } from "./builtinTemplates";

/** A fuzzy match below this is noise — two sheets that merely both have a "Date". */
export const FUZZY_MATCH_FLOOR = 0.55;

/** How many of the user's templates to consider. Ranking happens in memory. */
const CANDIDATE_LIMIT = 200;

export interface FindTemplatesArgs {
  userId: string;
  clientId: string;
  docType: ExcelDocType;
  headers: string[];
  /** When given, templates saved for the other item mode are demoted, not dropped. */
  itemMode?: ItemMode;
  /** Include the shipped vendor layouts. Default true. */
  includeBuiltIns?: boolean;
  limit?: number;
}

/**
 * Rank saved layouts against this sheet.
 *
 * Ordering, strongest first:
 *   1. exact fingerprint, this client        — the same sheet, same books
 *   2. exact fingerprint, another client      — same accounting package, new client
 *   3. a shipped vendor layout
 *   4. fuzzy header overlap, this client
 *   5. fuzzy header overlap, another client
 * ties broken by hitCount, then recency.
 */
export async function findTemplates(
  prisma: PrismaClient,
  args: FindTemplatesArgs
): Promise<TemplateMatch[]> {
  const fingerprint = headerFingerprint(args.headers);
  const sheetKeys = new Set(args.headers.map(normalizeHeader).filter(Boolean));

  const candidates = await prisma.mappingTemplate.findMany({
    // Deliberately not filtered by clientId — see the module comment.
    where: { userId: args.userId, docType: args.docType },
    orderBy: [{ hitCount: "desc" }, { lastUsedAt: "desc" }],
    take: CANDIDATE_LIMIT,
    select: {
      id: true,
      name: true,
      clientId: true,
      itemMode: true,
      headers: true,
      headerFingerprint: true,
      hitCount: true,
      lastUsedAt: true,
      isBuiltIn: true,
    },
  });

  const matches: Array<TemplateMatch & { sameClient: boolean; lastUsedAt: Date }> = [];

  for (const template of candidates) {
    const missingHeaders = template.headers.filter((h) => !sheetKeys.has(normalizeHeader(h)));
    const present = template.headers.length - missingHeaders.length;
    const coverage = template.headers.length ? present / template.headers.length : 0;
    const sameClient = template.clientId === args.clientId;

    let score: number;
    if (template.headerFingerprint === fingerprint) {
      score = sameClient ? 1 : 0.9;
    } else if (coverage >= FUZZY_MATCH_FLOOR) {
      // Cap below an exact match: a template that covers 100% of its own headers
      // may still be missing columns this sheet has, which the fingerprint would
      // have caught.
      score = (sameClient ? 0.8 : 0.72) * coverage;
    } else {
      continue;
    }

    // A WITH_ITEM mapping applied to a WITHOUT_ITEM sheet targets fields that do
    // not exist. Worth offering, not worth preferring.
    if (args.itemMode && template.itemMode !== args.itemMode) score *= 0.85;

    matches.push({
      templateId: template.id,
      name: template.name,
      score: Math.round(score * 100) / 100,
      missingHeaders,
      isBuiltIn: template.isBuiltIn,
      hitCount: template.hitCount,
      sameClient,
      lastUsedAt: template.lastUsedAt,
    });
  }

  if (args.includeBuiltIns !== false) {
    const seen = new Set(matches.map((m) => m.templateId));
    for (const builtin of matchBuiltinTemplates(args.headers, args.docType)) {
      if (seen.has(builtin.templateId)) continue;
      matches.push({ ...builtin, sameClient: false, lastUsedAt: new Date(0) });
    }
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.sameClient) - Number(a.sameClient) ||
      b.hitCount - a.hitCount ||
      b.lastUsedAt.getTime() - a.lastUsedAt.getTime() ||
      a.name.localeCompare(b.name)
  );

  return matches
    .slice(0, args.limit ?? 10)
    .map(({ sameClient: _sameClient, lastUsedAt: _lastUsedAt, ...match }) => match);
}

export interface SaveTemplateArgs {
  userId: string;
  clientId: string;
  name: string;
  docType: ExcelDocType;
  itemMode: ItemMode;
  headers: string[];
  mapping: SheetMapping;
  /** Set for layouts we ship rather than ones the user taught us. */
  sourceKey?: string | null;
  isBuiltIn?: boolean;
}

export interface SavedTemplate {
  id: string;
  name: string;
  headerFingerprint: string;
  hitCount: number;
}

/**
 * Remember a mapping the user has confirmed works.
 *
 * Upsert on the same natural key the schema constrains — one template per
 * (user, client, docType, header shape) — and increment on re-save, so saving
 * the same layout a second time is a vote for it rather than a duplicate row.
 * Same shape as `upsertOne` in rememberMapping.ts.
 */
export async function saveTemplate(
  prisma: PrismaClient,
  args: SaveTemplateArgs
): Promise<SavedTemplate> {
  const fingerprint = headerFingerprint(args.headers);
  return prisma.mappingTemplate.upsert({
    where: {
      userId_clientId_docType_headerFingerprint: {
        userId: args.userId,
        clientId: args.clientId,
        docType: args.docType,
        headerFingerprint: fingerprint,
      },
    },
    create: {
      userId: args.userId,
      clientId: args.clientId,
      name: args.name,
      docType: args.docType,
      itemMode: args.itemMode,
      headerFingerprint: fingerprint,
      headers: args.headers,
      mapping: args.mapping as never,
      hitCount: 1,
      isBuiltIn: args.isBuiltIn ?? false,
      sourceKey: args.sourceKey ?? null,
    },
    update: {
      name: args.name,
      itemMode: args.itemMode,
      headers: args.headers,
      mapping: args.mapping as never,
      hitCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
    select: { id: true, name: true, headerFingerprint: true, hitCount: true },
  });
}

/**
 * Record that a template was actually applied.
 *
 * Separate from `saveTemplate` on purpose: saving is the user asserting a
 * mapping is right, applying is evidence that it is. Both feed the same counter
 * that ranks the next lookup.
 */
export async function recordTemplateUse(
  prisma: PrismaClient,
  templateId: string
): Promise<void> {
  if (!templateId || templateId.startsWith("builtin:")) return;
  await prisma.mappingTemplate.update({
    where: { id: templateId },
    data: { hitCount: { increment: 1 }, lastUsedAt: new Date() },
  });
}

/**
 * Re-point a saved mapping at this sheet's columns.
 *
 * A template stores column *indexes* alongside the header text they were saved
 * against. When the same export arrives with its columns in a different order —
 * or with one inserted in the middle — the indexes are wrong but the names are
 * not, so the mapping is rebuilt by name. This is the failure their exact-text
 * key cannot survive, and it is why we store `headers` next to `mapping`.
 *
 * Returns null when too little of the template lands, rather than a mapping with
 * most of its fields silently nulled.
 */
export function applyTemplate(
  template: { headers: string[]; mapping: SheetMapping },
  headers: string[],
  opts: { headerRowIndex?: number; minFieldCoverage?: number } = {}
): SheetMapping | null {
  const indexByKey = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = normalizeHeader(header);
    if (key && !indexByKey.has(key)) indexByKey.set(key, index);
  });

  const remap = (column: number | null): number | null => {
    if (column === null) return null;
    const savedHeader = template.headers[column];
    if (savedHeader === undefined) return null;
    return indexByKey.get(normalizeHeader(savedHeader)) ?? null;
  };

  const fields = { ...template.mapping.fields };
  let wanted = 0;
  let landed = 0;
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    if (fields[key] === null) continue;
    wanted += 1;
    const moved = remap(fields[key]);
    fields[key] = moved;
    if (moved !== null) landed += 1;
  }
  if (wanted === 0) return null;
  if (landed / wanted < (opts.minFieldCoverage ?? 0.5)) return null;

  const gst = {
    ...template.mapping.gst,
    cgst: remap(template.mapping.gst.cgst),
    sgst: remap(template.mapping.gst.sgst),
    igst: remap(template.mapping.gst.igst),
    cess: remap(template.mapping.gst.cess),
    rateColumn: remap(template.mapping.gst.rateColumn),
    interstateColumn: remap(template.mapping.gst.interstateColumn),
    rateGroups: template.mapping.gst.rateGroups.map((group) => ({
      ...group,
      taxable: remap(group.taxable),
      cgst: remap(group.cgst),
      sgst: remap(group.sgst),
      igst: remap(group.igst),
    })),
  };

  return {
    ...template.mapping,
    headerRowIndex: opts.headerRowIndex ?? template.mapping.headerRowIndex,
    fields,
    gst,
  };
}
