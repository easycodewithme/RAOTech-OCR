export type VoucherType =
  | "PURCHASE"
  | "SALE"
  | "JOURNAL"
  | "CREDIT_NOTE"
  | "DEBIT_NOTE"
  | "PAYMENT"
  | "RECEIPT"
  | "CONTRA";
export type VoucherStatus = "DRAFT" | "APPROVED" | "POSTED" | "EXPORTED_DEMO";
export type LineRole =
  | "PARTY"
  | "ITEM"
  | "CGST"
  | "SGST"
  | "IGST"
  | "CESS"
  | "ROUND_OFF"
  | "DISCOUNT"
  /** The bank or cash side of a Payment, Receipt or Contra voucher. */
  | "BANK";
export type MappedVia =
  | "RULE"
  | "GSTIN_MEMORY"
  | "NAME_MEMORY"
  | "NARRATION_MEMORY"
  | "FUZZY"
  | "MANUAL"
  | "DEFAULT";
export type MatchKeyType = "GSTIN" | "VENDOR_NAME" | "NARRATION";
export type RuleType =
  | "GSTIN_EQUALS"
  | "VENDOR_NAME_CONTAINS"
  | "VENDOR_NAME_EQUALS"
  | "HSN_EQUALS";
export type LedgerType =
  | "PARTY"
  | "PURCHASE"
  | "SALE"
  | "TAX_INPUT"
  | "TAX_OUTPUT"
  | "EXPENSE"
  | "INCOME"
  | "ROUND_OFF"
  | "BANK"
  | "CASH"
  | "OTHER";
export type LedgerGroup =
  | "SUNDRY_CREDITORS"
  | "SUNDRY_DEBTORS"
  | "DUTIES_AND_TAXES"
  | "PURCHASE_ACCOUNTS"
  | "SALES_ACCOUNTS"
  | "DIRECT_EXPENSES"
  | "INDIRECT_EXPENSES"
  | "INDIRECT_INCOME"
  | "BANK_ACCOUNTS"
  | "CASH_IN_HAND"
  | "CURRENT_ASSETS"
  | "CURRENT_LIABILITIES"
  | "FIXED_ASSETS";

/**
 * The groups Tally tracks invoice-level outstandings for.
 *
 * This set is load-bearing in two places at once and they have to agree: the
 * ledger master is written with `ISBILLWISEON=Yes` for exactly these groups,
 * and a voucher line touching one of them must therefore carry a
 * `BILLALLOCATIONS.LIST`. Let the two lists drift and you get the SYNC-03 bug
 * in its pure form — a ledger Tally is ageing, receiving entries that name no
 * bill, which Tally silently parks On Account while the original invoice stays
 * fully outstanding. Defined once here so `exportXml` and the voucher builders
 * cannot disagree about which ledgers are bill-wise.
 *
 * Typed as a set of plain strings, not of `LedgerGroup`, because the export
 * layer carries the group as free text off a database row.
 */
export const BILL_WISE_GROUPS: ReadonlySet<string> = new Set<LedgerGroup>([
  "SUNDRY_CREDITORS",
  "SUNDRY_DEBTORS",
]);

/**
 * How a line allocates against a bill, in Tally's own vocabulary.
 *
 * Kept as a union of Tally's literal strings rather than an enum of our own
 * because these values are written straight into `<BILLTYPE>` — a translation
 * table between our names and Tally's would be one more place for a typo to
 * become a silently mis-aged ledger.
 *
 *   New Ref    — this document *creates* an outstanding (an invoice).
 *   Agst Ref   — this document *settles* a named existing one (a payment
 *                against a bill, a credit note against the invoice it reverses).
 *   Advance    — money received or paid before the bill exists.
 *   On Account — deliberately unallocated. What Tally does anyway when a
 *                bill-wise ledger gets an entry naming no bill; saying it
 *                explicitly is the honest form of the same posting.
 */
export type BillRefType = "New Ref" | "Agst Ref" | "Advance" | "On Account";

/**
 * The bill allocation a line carries, when it carries one.
 *
 * Null/absent means "no allocation", which is the correct and only correct
 * value for any line whose ledger is not bill-wise: a purchase account, a tax
 * head, a bank. Tally rejects a `BILLALLOCATIONS.LIST` on a ledger that is not
 * being aged.
 */
export interface BillAllocation {
  billRefType?: BillRefType | null;
  /** The reference being opened or settled. Empty for `On Account`. */
  billRefName?: string | null;
}

export interface NormalizedItem {
  name: string;
  qty: number;
  rate: number;
  price: number;
  hsnCode: string | null;
  gstRate: number | null;
}

export interface NormalizedInvoice {
  invoiceNumber: string | null;
  date: Date;
  vendor: string | null;
  vendorGstin: string | null;
  customerName: string | null;
  customerGstin: string | null;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Compensation cess. Optional because OCR rarely finds one. */
  cess?: number;
  discount: number;
  total: number;
  items: NormalizedItem[];

  /**
   * The document a credit or debit note reverses.
   *
   * Optional because most documents are not returns, and because a return whose
   * original nobody recorded must still post — it simply cannot be allocated,
   * and falls back to opening its own reference. When it *is* present the
   * builder emits `Agst Ref` against it, which is the only way the credit note
   * actually knocks the invoice off the client's ageing rather than sitting
   * beside it as a second outstanding.
   *
   * Mirrors `Invoice.againstInvoiceNumber` / `againstInvoiceDate`. Carried as
   * the number and date rather than a foreign key for the same reason the
   * column is: the original is very often not in this workspace at all.
   */
  againstInvoiceNumber?: string | null;
  againstInvoiceDate?: Date | null;
}

export interface LedgerRef {
  id: string;
  name: string;
  confidence: number;
  via: MappedVia;
  needsReview?: boolean;
}

export interface ResolvedLedgers {
  party: LedgerRef | null;
  itemLedgers: Array<{ item: NormalizedItem; ledger: LedgerRef | null }>;
  cgstLedgerId: string;
  sgstLedgerId: string;
  igstLedgerId: string;
  roundOffLedgerId: string;
  cessLedgerId?: string | null;
  discountLedgerId?: string | null;
  cgstLedgerName?: string;
  sgstLedgerName?: string;
  igstLedgerName?: string;
  roundOffLedgerName?: string;
  cessLedgerName?: string;
  discountLedgerName?: string;
}


/**
 * The stock a line moves, when it moves any.
 *
 * Optional everywhere on purpose: a bank payment, a journal and a services
 * invoice have no inventory, and the great majority of what a CA firm keys in
 * never will. A line carrying `stockItemName` is emitted to Tally as an
 * inventory entry with its accounting ledger nested inside; a line without one
 * is unchanged.
 */
export interface InventoryAllocation {
  stockItemId?: string | null;
  stockItemName?: string | null;
  quantity?: number | null;
  /** As Tally spells it: "Nos", "Kg". Tally wants "10 Nos", not "10". */
  unit?: string | null;
  /** Per-unit. Derived from amount / quantity when a sheet omits it. */
  rate?: number | null;
}

export interface VoucherLineDraft extends InventoryAllocation, BillAllocation {
  ledgerId: string | null;
  ledgerNameSnapshot: string | null;
  role: LineRole;
  debit: number;
  credit: number;
  confidence: number | null;
  mappedVia: MappedVia | null;
  hsnCode: string | null;
  gstRate: number | null;
  sortOrder: number;
}

/**
 * One posting: a ledger, an amount, and a side. Nothing else.
 *
 * `amount` is always positive — the side decides the column. Signed amounts
 * invite the bug where a negative credit quietly becomes a debit somewhere
 * downstream and the voucher still "balances".
 */
export interface VoucherLineInput extends InventoryAllocation, BillAllocation {
  role: LineRole;
  ledgerId: string | null;
  ledgerName: string | null;
  amount: number;
  side: "DR" | "CR";
  confidence?: number | null;
  mappedVia?: MappedVia | null;
  hsnCode?: string | null;
  gstRate?: number | null;
}

/**
 * A voucher expressed as lines, which every source can produce: an invoice, a
 * journal row, a bank transaction, a multi-rate spreadsheet row.
 */
export interface VoucherInput {
  voucherType: VoucherType;
  date: Date;
  narration?: string | null;
  lines: VoucherLineInput[];
  /** Where the balancing residual posts. */
  roundOffLedgerId?: string | null;
  roundOffLedgerName?: string | null;
}

export interface VoucherDraft {
  voucherType: VoucherType;
  date: Date;
  narration: string | null;
  lines: VoucherLineDraft[];
  totalDebit: number;
  totalCredit: number;
  roundOff: number;
  hasUnmapped: boolean;
  warnings: string[];
}
