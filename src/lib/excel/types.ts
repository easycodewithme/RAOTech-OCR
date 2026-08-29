/**
 * The contract for spreadsheet ingestion.
 *
 * Everything here is pure data — no ExcelJS types, no Prisma types, no React.
 * The parser, the mapper, the API routes and the wizard all agree on these
 * shapes and nothing else, so each can be tested without the others.
 *
 * The destination is `NormalizedInvoice` from `src/lib/accounting/types.ts`.
 * Mapped rows rejoin the existing resolveLedger → buildVoucher → createVoucher
 * path unchanged; there is deliberately no second accounting path.
 */

export type ExcelDocType =
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "SALE"
  | "SALE_RETURN"
  | "JOURNAL"
  /**
   * Bulk master upload. These two produce `Ledger` / `StockItem` rows rather
   * than vouchers: same parser, same header detection, same review before
   * commit, different thing at the end. They deliberately bypass
   * `detectLayout` and `suggestMapping`, which are built around invoice fields
   * a chart of accounts does not have.
   */
  | "LEDGER_MASTER"
  | "ITEM_MASTER";

/**
 * Whether a row carries stock-item detail.
 *
 * This one flag changes four things: which fields are mandatory, whether the
 * voucher gets inventory allocations underneath its accounting allocations,
 * whether one invoice spans several rows, and which master the GST rate is
 * resolved from (the stock item, or the sales/purchase ledger).
 */
export type ItemMode = "WITHOUT_ITEM" | "WITH_ITEM";

/** A column, addressed by position. Header text is for display only. */
export type ColumnIndex = number;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface SheetSummary {
  name: string;
  rowCount: number;
  /** Non-empty column count on the detected header row. */
  columnCount: number;
}

export interface ParsedSheet {
  sheetName: string;
  /** Zero-based index of the row holding headers, as detected. */
  headerRowIndex: number;
  headers: string[];
  /** Data rows only — everything after the header row, blank rows dropped. */
  rows: CellValue[][];
  /** Rows dropped as grand-total or separator lines, for honest reporting. */
  droppedRowIndexes: number[];
  totalRowsScanned: number;
}

/** Excel gives us four things worth distinguishing; everything else is text. */
export type CellValue = string | number | boolean | Date | null;

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

/**
 * How the sheet expresses tax.
 *
 * `LONG` — one row per line, tax in fixed CGST/SGST/IGST columns.
 * `WIDE`  — one column group per rate ("5% Taxable", "5% CGST", "12% Taxable"…).
 *
 * The competitor cannot infer this, which is why 26 of their 158 help articles
 * are the same feature described for a different sheet shape, and why their
 * users are told to reshape spreadsheets by hand. Detecting it is the single
 * highest-leverage thing this module does.
 */
export type TaxLayout = "LONG" | "WIDE";

export interface RateGroup {
  /** The GST rate this column group belongs to, e.g. 18 for "18% CGST". */
  rate: number;
  taxable: ColumnIndex | null;
  cgst: ColumnIndex | null;
  sgst: ColumnIndex | null;
  igst: ColumnIndex | null;
}

export interface LayoutDetection {
  taxLayout: TaxLayout;
  /** Populated only when taxLayout is WIDE. */
  rateGroups: RateGroup[];
  /** 0–1. Below `LAYOUT_CONFIDENCE_FLOOR` the wizard should ask rather than assume. */
  confidence: number;
  /** Human-readable justification, shown in the UI so the guess is auditable. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * Stage 1 — which column holds which field.
 *
 * `null` means "not present in this sheet", which is different from "not yet
 * mapped": an unmapped required field is a validation error, an absent optional
 * one is fine.
 */
export interface FieldMapping {
  invoiceNumber: ColumnIndex | null;
  date: ColumnIndex | null;
  partyName: ColumnIndex | null;
  partyGstin: ColumnIndex | null;
  narration: ColumnIndex | null;

  /** Value before tax. */
  taxable: ColumnIndex | null;
  /** Invoice total including tax. Derived when absent. */
  total: ColumnIndex | null;
  discount: ColumnIndex | null;
  roundOff: ColumnIndex | null;

  /** WITH_ITEM only. */
  itemName: ColumnIndex | null;
  quantity: ColumnIndex | null;
  rate: ColumnIndex | null;
  amount: ColumnIndex | null;
  hsnCode: ColumnIndex | null;

  /** JOURNAL only — a row names its own ledger and side. */
  ledgerName: ColumnIndex | null;
  debit: ColumnIndex | null;
  credit: ColumnIndex | null;
}

/**
 * Stage 2 — where tax comes from.
 *
 * `FROM_SHEET` reads tax amounts out of columns. `CALCULATE` derives them from
 * a rate. Their docs make this a pair of toggles ("GST ledger from sheet?" and
 * "auto-calculate?"); one enum is the same information without the illegal
 * fourth combination.
 */
export type GstSource = "FROM_SHEET" | "CALCULATE";

export interface GstMapping {
  source: GstSource;
  taxLayout: TaxLayout;

  /** LONG layout: fixed tax columns. */
  cgst: ColumnIndex | null;
  sgst: ColumnIndex | null;
  igst: ColumnIndex | null;
  cess: ColumnIndex | null;

  /** WIDE layout: one group per rate. */
  rateGroups: RateGroup[];

  /** CALCULATE: the rate column, or a flat rate when the sheet has none. */
  rateColumn: ColumnIndex | null;
  flatRate: number | null;

  /**
   * Interstate is decided per row, not per sheet — from a column, or by
   * comparing party GSTIN state to the company's. Deliberately not a mapping
   * flag: a sheet routinely contains both.
   */
  interstateColumn: ColumnIndex | null;
}

/**
 * Stage 3 — which Tally ledger each generated line posts to.
 *
 * Ledger *ids*, resolved once at mapping time. The competitor makes the
 * accountant type Tally ledger names into the spreadsheet itself, which is why
 * renaming a ledger in Tally silently breaks their saved mappings.
 */
export interface LedgerMapping {
  /** The sales or purchase account. */
  primaryLedgerId: string | null;
  cgstLedgerId: string | null;
  sgstLedgerId: string | null;
  igstLedgerId: string | null;
  cessLedgerId: string | null;
  roundOffLedgerId: string | null;
  discountLedgerId: string | null;
  /** WIDE layout may post each rate to its own duty ledger. */
  perRateLedgerIds: Record<string, { cgst?: string; sgst?: string; igst?: string }>;
}

export interface SheetMapping {
  docType: ExcelDocType;
  itemMode: ItemMode;
  headerRowIndex: number;
  fields: FieldMapping;
  gst: GstMapping;
  ledgers: LedgerMapping;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type IssueCode =
  | "MISSING_REQUIRED_FIELD"
  | "UNPARSEABLE_DATE"
  | "DATE_BEFORE_BOOKS"
  | "UNPARSEABLE_NUMBER"
  | "NEGATIVE_AMOUNT"
  | "TOTAL_MISMATCH"
  | "UNBALANCED_JOURNAL"
  | "MISSING_PARTY"
  | "INVALID_GSTIN"
  | "DUPLICATE_INVOICE"
  | "UNMAPPED_LEDGER"
  | "ROW_LIMIT_EXCEEDED"
  | "GRAND_TOTAL_ROW";

export interface RowIssue {
  /** Zero-based index into `ParsedSheet.rows`. */
  row: number;
  column: ColumnIndex | null;
  code: IssueCode;
  /** "error" blocks the commit; "warning" is surfaced but still commits. */
  severity: "error" | "warning";
  message: string;
}

/**
 * One row's resolution state, mirroring the blue/orange convention the
 * competitor uses — with one deliberate change. They colour "not found in
 * Tally" and "not chosen by the user" identically; we keep them distinct,
 * because the fixes are different.
 */
export type CellState = "RESOLVED" | "UNMAPPED" | "NOT_IN_TALLY" | "INVALID";

export interface MappedRow {
  row: number;
  invoice: import("../accounting/types").NormalizedInvoice | null;
  issues: RowIssue[];
  /** Party ledger resolution, so the grid can show what will be created. */
  partyLedgerId: string | null;
  partyState: CellState;
}

export interface MappingResult {
  rows: MappedRow[];
  issues: RowIssue[];
  /** Rows with no blocking issue — what a commit would actually write. */
  committableCount: number;
  /** Distinct party names with no ledger, which MASTER_CREATE would need. */
  missingParties: string[];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export interface TemplateMatch {
  templateId: string;
  name: string;
  /** 0–1 over normalised header text. 1 means every header matched. */
  score: number;
  /** Headers in the template absent from this sheet. */
  missingHeaders: string[];
  isBuiltIn: boolean;
  hitCount: number;
}

/** Below this, present the guess as a suggestion rather than applying it. */
export const LAYOUT_CONFIDENCE_FLOOR = 0.7;

/**
 * Rows per upload.
 *
 * The competitor caps at 7,000 and says so because "Tally becomes
 * unresponsive". Ours is a guard against a runaway file rather than a Tally
 * limit — we post one voucher per request and never hand Tally a batch — but a
 * ceiling still belongs here so a 200k-row export fails fast and clearly.
 */
export const MAX_ROWS = 20_000;
