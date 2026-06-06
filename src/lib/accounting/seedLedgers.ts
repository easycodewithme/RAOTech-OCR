import type { PrismaClient } from "@prisma/client";
import type { LedgerGroup, LedgerType } from "./types";

export interface SeedLedger {
  name: string;
  group: LedgerGroup;
  ledgerType: LedgerType;
  gstRate?: number;
  isSystem?: boolean; // tax / round-off — cannot be deleted
}

/**
 * Canonical standard chart of accounts for an Indian CA context, grouped
 * Tally-style. Used both to seed a new workspace and as the source of the
 * transform's default fallback ledgers (resolved by ledgerType, not by name).
 */
export const SEED_LEDGERS: SeedLedger[] = [
  // Parties
  { name: "Sundry Creditors", group: "SUNDRY_CREDITORS", ledgerType: "PARTY" },
  { name: "Sundry Debtors", group: "SUNDRY_DEBTORS", ledgerType: "PARTY" },

  // Duties & Taxes — GST input (purchase) and output (sales)
  { name: "CGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT", isSystem: true },
  { name: "SGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT", isSystem: true },
  { name: "IGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT", isSystem: true },
  { name: "CGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT", isSystem: true },
  { name: "SGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT", isSystem: true },
  { name: "IGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT", isSystem: true },

  // Purchase accounts (generic + rate splits)
  { name: "Purchase Accounts", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE" },
  { name: "Purchase - GST 5%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 5 },
  { name: "Purchase - GST 12%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 12 },
  { name: "Purchase - GST 18%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 18 },
  { name: "Purchase - GST 28%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 28 },

  // Sales accounts (generic + rate splits)
  { name: "Sales Accounts", group: "SALES_ACCOUNTS", ledgerType: "SALE" },
  { name: "Sales - GST 5%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 5 },
  { name: "Sales - GST 12%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 12 },
  { name: "Sales - GST 18%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 18 },
  { name: "Sales - GST 28%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 28 },

  // Common indirect expenses
  { name: "Rent", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Telephone & Internet", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Professional Fees", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Office Expenses", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Bank Charges", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Repairs & Maintenance", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Travelling & Conveyance", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Printing & Stationery", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },

  // Direct expenses
  { name: "Freight & Carriage Inward", group: "DIRECT_EXPENSES", ledgerType: "EXPENSE" },

  // Indirect income
  { name: "Discount Received", group: "INDIRECT_INCOME", ledgerType: "INCOME" },

  // Round off (system)
  { name: "Round Off", group: "CURRENT_LIABILITIES", ledgerType: "ROUND_OFF", isSystem: true },

  // Bank / cash
  { name: "Bank Account", group: "BANK_ACCOUNTS", ledgerType: "BANK" },
  { name: "Cash", group: "CASH_IN_HAND", ledgerType: "CASH" },
];

/**
 * Idempotently seed the standard chart of accounts for a workspace
 * (userId, clientId=""). Returns the number of ledgers created. Safe to call
 * repeatedly.
 */
export async function seedLedgersForUser(
  prisma: PrismaClient,
  userId: string
): Promise<number> {
  const existing = await prisma.ledger.count({
    where: { userId, clientId: "" },
  });
  if (existing > 0) return 0;

  const data = SEED_LEDGERS.map((l) => ({
    userId,
    clientId: "",
    name: l.name,
    group: l.group,
    ledgerType: l.ledgerType,
    gstRate: l.gstRate ?? null,
    isSeeded: true,
    isSystem: l.isSystem ?? false,
  }));

  await prisma.ledger.createMany({ data, skipDuplicates: true });
  return data.length;
}
