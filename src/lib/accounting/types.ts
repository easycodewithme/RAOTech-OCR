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

export interface VoucherLineDraft extends InventoryAllocation {
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
export interface VoucherLineInput extends InventoryAllocation {
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
