/**
 * Layouts we ship, so the first upload of a known file shape needs no mapping.
 *
 * The competitor ships **no template library at all**. For Meesho, AJIO,
 * Zerodha, Groww, NJ India Invest and Choice Broker their answer is a help
 * article containing a hand-written two-column table — "Meesho Sheet Heading" /
 * "Mapped Column in Vyapar TaxOne" — that the accountant retypes into the UI,
 * once per client, and again whenever the marketplace renames a column. Encoding
 * those tables as data is a few hundred lines and removes seven support articles.
 *
 * Every header string below is quoted from the vendor's own FAQ under
 * `vyapar-taxone-docs/faqs/`, including its typos ("Suplier invoice number"),
 * because the point is to match the file the accountant actually has.
 *
 * **Zerodha is deliberately absent.** Both Zerodha articles
 * (`quick-easy-upload-your-zerodha-tradebook-sales-sheet-to-vyapar-taxone.md`
 * and `…-zerodha-purchase-tradebook-sheet-…`) walk through date reformatting and
 * then show the field mapping only as a screenshot — no header table. They name
 * exactly two real columns, "Trade Date" and "Order Execution Time". That is not
 * enough to key a template on, and inventing the rest would produce a template
 * that silently mismaps. Add Zerodha when we have a real tradebook export.
 *
 * A built-in is matched on header fingerprint when the sheet is untouched, and
 * on coverage of the vendor's own headers otherwise — because these guides all
 * instruct the accountant to *add* columns (a ledger name, a party name) before
 * uploading, so a prepared file never has the raw export's fingerprint.
 */

import type { ExcelDocType, ItemMode, SheetMapping, TemplateMatch } from "./types";
import type { MappableField } from "./suggestMapping";
import { suggestMapping } from "./suggestMapping";
import { headerFingerprint, normalizeHeader } from "./detectHeader";
import { detectLayout } from "./detectLayout";

export interface BuiltinTemplate {
  /** Stable key, stored on `MappingTemplate.sourceKey`. */
  sourceKey: string;
  name: string;
  docType: ExcelDocType;
  itemMode: ItemMode;
  /** Columns the vendor's own export contains. */
  headers: string[];
  /**
   * Columns the vendor does not export and the guide tells the accountant to
   * add — a ledger name, a party name. Their absence lowers the score but does
   * not stop a match, and they are reported as `missingHeaders` so the wizard
   * can say exactly what to add.
   */
  addedHeaders: string[];
  /** Field -> the header text that carries it. */
  fields: Partial<Record<MappableField, string>>;
  /** The FAQ file the mapping is quoted from. */
  source: string;
  /** What the vendor's table maps that we have nowhere to put. */
  unmapped?: string;
}

/** Below this a built-in is not offered; the header overlap is too thin to trust. */
export const BUILTIN_MATCH_FLOOR = 0.6;

export const BUILTIN_TEMPLATES: readonly BuiltinTemplate[] = [
  {
    sourceKey: "meesho-sales",
    name: "Meesho — sales",
    docType: "SALE",
    itemMode: "WITH_ITEM",
    headers: [
      "order_date",
      "order_num",
      "sub_order_num",
      "quantity",
      "sup_name",
      "reseller_state",
      "end_customer_state",
      "hsn_code",
      "tcs_taxable_amount",
      "end_customer_state_new",
    ],
    addedHeaders: ["Sales Ledger"],
    fields: {
      date: "order_date",
      // Their table sends order_num to "Order No(s)" and sub_order_num to
      // "Reference No". We have one document-number slot, and the sub-order is
      // what identifies the line's bill.
      invoiceNumber: "sub_order_num",
      quantity: "quantity",
      partyName: "sup_name",
      // Their table maps hsn_code to "Name of Item" — a Meesho sheet has no
      // product name, so the HSN is what identifies the line. It is both here.
      itemName: "hsn_code",
      hsnCode: "hsn_code",
      taxable: "tcs_taxable_amount",
    },
    source: "faqs/how-to-map-meesho-sales-sheet-in-vyapar-taxone.md",
    unmapped:
      "reseller_state / end_customer_state / end_customer_state_new are Place of Supply and State (Buyer/Consignee); the contract has no field for either. Sales Ledger is a Tally ledger name and is chosen on the ledger stage instead.",
  },
  {
    sourceKey: "ajio-sales",
    name: "AJIO — sales",
    docType: "SALE",
    itemMode: "WITH_ITEM",
    headers: [
      "Cust Order No",
      "Cust Order Date",
      "Seller Invoice No",
      "Seller Invoice Date",
      "Cust Invoice No",
      "Cust Invoice Date",
      "Seller Style Code",
      "Base Price",
      "Shipped QTY",
      "Seller Name",
    ],
    addedHeaders: ["Sales Ledger"],
    fields: {
      invoiceNumber: "Seller Invoice No",
      date: "Cust Invoice Date",
      itemName: "Seller Style Code",
      amount: "Base Price",
      quantity: "Shipped QTY",
      partyName: "Seller Name",
    },
    source: "faqs/how-to-map-ajio-sales-sheets-in-vyapar-taxone-with-preparation-guide.md",
    unmapped:
      "Cust Order No/Date and Cust Invoice No are order and reference numbers; the contract has one document-number slot, which the seller invoice number takes.",
  },
  {
    sourceKey: "groww-purchase",
    name: "Groww — purchase",
    docType: "PURCHASE",
    itemMode: "WITH_ITEM",
    headers: [
      "Stock name",
      "ISIN",
      "Type",
      "Quantity",
      "Price",
      "Exchange Order Id",
      "Execution date and time",
    ],
    addedHeaders: ["Party Name"],
    fields: {
      itemName: "Stock name",
      // Their table sends ISIN to "Supplier Invoice No." — the ISIN is the only
      // stable per-line identifier a Groww export carries.
      invoiceNumber: "ISIN",
      quantity: "Quantity",
      rate: "Price",
      date: "Execution date and time",
      partyName: "Party Name",
    },
    source: "faqs/how-to-upload-and-map-a-groww-purchase-excel-sheet-in-vyapar-taxone.md",
    unmapped:
      "Type carries the purchase ledger name and Exchange Order Id is an order number; neither has a field in the contract.",
  },
  {
    sourceKey: "nj-india-invest-purchase",
    name: "NJ India Invest — purchase",
    docType: "PURCHASE",
    itemMode: "WITH_ITEM",
    headers: [
      "Sr. No.",
      "DP",
      "Investor",
      "Order No",
      "Trade Date",
      "Scrip code / Symbol",
      "Qty",
      "Price (₹)",
    ],
    addedHeaders: ["Purchase Ledger"],
    fields: {
      invoiceNumber: "Sr. No.",
      partyName: "Investor",
      date: "Trade Date",
      itemName: "Scrip code / Symbol",
      quantity: "Qty",
      rate: "Price (₹)",
    },
    source: "faqs/upload-nj-india-invest-purchase-stock-excel-in-vyapar-taxone.md",
    unmapped:
      "DP is Supplier (Bill To) and Order No is an order number; the contract has neither field.",
  },
  {
    sourceKey: "choice-broker-purchase",
    name: "Choice Broker — purchase",
    docType: "PURCHASE",
    itemMode: "WITH_ITEM",
    headers: ["SYMBOL", "QUANTITY", "BUY DATE", "BUY VALUE"],
    // Spelled as the guide spells it. The accountant is told to add this column
    // by hand, typo included, so this is the string a prepared file contains.
    addedHeaders: ["Suplier invoice number", "Party Name", "Purchase Name"],
    fields: {
      itemName: "SYMBOL",
      quantity: "QUANTITY",
      date: "BUY DATE",
      amount: "BUY VALUE",
      invoiceNumber: "Suplier invoice number",
      partyName: "Party Name",
    },
    source: "faqs/how-to-format-and-upload-choice-broker-purchase-excel-sheet-in-vyapar-taxone.md",
    unmapped: "Purchase Name carries the purchase ledger name, chosen on the ledger stage instead.",
  },
];

/** The fingerprint of the vendor's raw export, before the accountant adds columns. */
export function builtinFingerprint(template: BuiltinTemplate): string {
  return headerFingerprint(template.headers);
}

/** The fingerprint of the sheet the guide tells the accountant to produce. */
export function builtinPreparedFingerprint(template: BuiltinTemplate): string {
  return headerFingerprint([...template.headers, ...template.addedHeaders]);
}

export function findBuiltinTemplate(sourceKey: string): BuiltinTemplate | null {
  return BUILTIN_TEMPLATES.find((t) => t.sourceKey === sourceKey) ?? null;
}

/** `TemplateMatch.templateId` for a built-in, namespaced so it cannot collide with a uuid. */
export function builtinTemplateId(sourceKey: string): string {
  return `builtin:${sourceKey}`;
}

export function isBuiltinTemplateId(templateId: string): boolean {
  return templateId.startsWith("builtin:");
}

/**
 * Rank the shipped layouts against a sheet.
 *
 * Scoring is over the *vendor's own* headers, not the whole prepared list: a
 * raw Meesho export is still a Meesho export before the accountant has added
 * the Sales Ledger column, and telling them which column to add is more useful
 * than refusing to recognise the file.
 */
export function matchBuiltinTemplates(
  headers: string[],
  docType?: ExcelDocType
): TemplateMatch[] {
  const sheetKeys = new Set(headers.map(normalizeHeader).filter(Boolean));
  const fingerprint = headerFingerprint(headers);
  const matches: TemplateMatch[] = [];

  for (const template of BUILTIN_TEMPLATES) {
    if (docType && template.docType !== docType) continue;

    const all = [...template.headers, ...template.addedHeaders];
    const missingHeaders = all.filter((h) => !sheetKeys.has(normalizeHeader(h)));
    const vendorPresent = template.headers.filter((h) => sheetKeys.has(normalizeHeader(h))).length;
    const coverage = template.headers.length ? vendorPresent / template.headers.length : 0;

    const exact =
      fingerprint === builtinFingerprint(template) ||
      fingerprint === builtinPreparedFingerprint(template);

    // Capped below 1 even on an exact fingerprint: a mapping this firm saved and
    // has used ten times knows the client's ledgers, and ours does not.
    const score = exact ? 0.88 : coverage >= BUILTIN_MATCH_FLOOR ? 0.5 + 0.35 * coverage : 0;
    if (score <= 0) continue;

    matches.push({
      templateId: builtinTemplateId(template.sourceKey),
      name: template.name,
      score: Math.round(score * 100) / 100,
      missingHeaders,
      isBuiltIn: true,
      hitCount: 0,
    });
  }

  return matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function indexOfHeader(headers: string[], header: string): number | null {
  const wanted = normalizeHeader(header);
  if (!wanted) return null;
  const index = headers.findIndex((h) => normalizeHeader(h) === wanted);
  return index === -1 ? null : index;
}

/**
 * Turn a built-in into a mapping for this particular sheet.
 *
 * The template pins only what the vendor's FAQ actually documents. Everything
 * else — the tax layout, a GST rate column, a discount column the accountant
 * added — comes from the ordinary suggestion pass, so a prepared file with extra
 * columns is better mapped than the guide's table alone would allow.
 */
export function builtinToMapping(
  template: BuiltinTemplate,
  headers: string[],
  opts: { headerRowIndex?: number; docType?: ExcelDocType; itemMode?: ItemMode } = {}
): SheetMapping | null {
  const docType = opts.docType ?? template.docType;
  const itemMode = opts.itemMode ?? template.itemMode;
  const layout = detectLayout(headers);
  const suggested = suggestMapping(headers, layout, docType, itemMode, {
    headerRowIndex: opts.headerRowIndex,
  });

  const fields = { ...suggested.mapping.fields };
  const pinned = new Map<MappableField, number>();
  for (const [field, header] of Object.entries(template.fields) as Array<
    [MappableField, string]
  >) {
    const index = indexOfHeader(headers, header);
    if (index !== null) pinned.set(field, index);
  }
  if (pinned.size === 0) return null;

  // Apply the pins, then clear any suggestion that was holding a pinned column
  // for a different field — one column, one field.
  for (const [field, index] of pinned) fields[field] = index;
  for (const key of Object.keys(fields) as MappableField[]) {
    if (pinned.has(key)) continue;
    if (fields[key] !== null && [...pinned.values()].includes(fields[key] as number)) {
      fields[key] = null;
    }
  }

  return { ...suggested.mapping, docType, itemMode, fields };
}
