// Accounting domain types.
//
// These string-union types intentionally mirror the Prisma enums (same string
// values) so pure modules here stay decoupled from the Prisma client runtime
// while remaining assignable to Prisma's generated enum types at the
// persistence layer (API routes).

export type VoucherType = "PURCHASE" | "SALE" | "JOURNAL";
export type VoucherStatus = "DRAFT" | "APPROVED" | "POSTED";
export type LineRole =
  | "PARTY"
  | "ITEM"
  | "CGST"
  | "SGST"
  | "IGST"
  | "ROUND_OFF"
  | "DISCOUNT";
export type MappedVia =
  | "RULE"
  | "GSTIN_MEMORY"
  | "NAME_MEMORY"
  | "FUZZY"
  | "MANUAL"
  | "DEFAULT";
export type MatchKeyType = "GSTIN" | "VENDOR_NAME";
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
  price: number; // line total (pre-tax as extracted)
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
  discount: number;
  total: number; // total_amount
  items: NormalizedItem[];
}

/** A reference to a resolved ledger, with provenance from the resolver. */
export interface LedgerRef {
  id: string;
  name: string;
  confidence: number; // 0..1
  via: MappedVia;
  needsReview?: boolean;
}

/** Output of the ledger resolution step, fed into buildVoucher. */
export interface ResolvedLedgers {
  party: LedgerRef | null; // null => unmapped party line (blocks approval)
  itemLedgers: Array<{ item: NormalizedItem; ledger: LedgerRef | null }>;
  // System ledger ids (always present once the chart is seeded)
  cgstLedgerId: string;
  sgstLedgerId: string;
  igstLedgerId: string;
  roundOffLedgerId: string;
  discountLedgerId?: string | null;
  // Snapshots for the system ledgers (for line snapshots / display)
  cgstLedgerName?: string;
  sgstLedgerName?: string;
  igstLedgerName?: string;
  roundOffLedgerName?: string;
  discountLedgerName?: string;
}

export interface VoucherLineDraft {
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

export interface VoucherDraft {
  voucherType: VoucherType;
  date: Date;
  narration: string | null;
  lines: VoucherLineDraft[];
  totalDebit: number;
  totalCredit: number;
  roundOff: number;
  hasUnmapped: boolean; // gates approval (party null or any item null)
  warnings: string[]; // e.g. rounding exceeded tolerance, tax inconsistency
}
