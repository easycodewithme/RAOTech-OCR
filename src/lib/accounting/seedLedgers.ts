import type { PrismaClient } from "@prisma/client";
import type { LedgerGroup, LedgerType } from "./types";

export interface SeedLedger {
  name: string;
  group: LedgerGroup;
  ledgerType: LedgerType;
  gstRate?: number;
  isSystem?: boolean;
}

export const SEED_LEDGERS: SeedLedger[] = [
  { name: "Sundry Creditors", group: "SUNDRY_CREDITORS", ledgerType: "PARTY" },
  { name: "Sundry Debtors", group: "SUNDRY_DEBTORS", ledgerType: "PARTY" },

  { name: "CGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT", isSystem: true },
  { name: "SGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT", isSystem: true },
  { name: "IGST Input", group: "DUTIES_AND_TAXES", ledgerType: "TAX_INPUT", isSystem: true },
  { name: "CGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT", isSystem: true },
  { name: "SGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT", isSystem: true },
  { name: "IGST Output", group: "DUTIES_AND_TAXES", ledgerType: "TAX_OUTPUT", isSystem: true },

  { name: "Purchase Accounts", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE" },
  { name: "Purchase - GST 5%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 5 },
  { name: "Purchase - GST 12%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 12 },
  { name: "Purchase - GST 18%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 18 },
  { name: "Purchase - GST 28%", group: "PURCHASE_ACCOUNTS", ledgerType: "PURCHASE", gstRate: 28 },

  { name: "Sales Accounts", group: "SALES_ACCOUNTS", ledgerType: "SALE" },
  { name: "Sales - GST 5%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 5 },
  { name: "Sales - GST 12%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 12 },
  { name: "Sales - GST 18%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 18 },
  { name: "Sales - GST 28%", group: "SALES_ACCOUNTS", ledgerType: "SALE", gstRate: 28 },

  { name: "Rent", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Telephone & Internet", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Professional Fees", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Office Expenses", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Bank Charges", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Repairs & Maintenance", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Travelling & Conveyance", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Printing & Stationery", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },

  { name: "Freight & Carriage Inward", group: "DIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Discount Received", group: "INDIRECT_INCOME", ledgerType: "INCOME" },
  { name: "Discount Allowed", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "Round Off", group: "CURRENT_LIABILITIES", ledgerType: "ROUND_OFF", isSystem: true },
  { name: "Bank Account", group: "BANK_ACCOUNTS", ledgerType: "BANK" },
  { name: "Cash", group: "CASH_IN_HAND", ledgerType: "CASH" },
];

/**
 * Idempotently seed the standard chart of accounts for a client workspace.
 */
export async function seedLedgersForUser(
  prisma: PrismaClient,
  userId: string,
  clientId: string
): Promise<number> {
  if (!clientId) return 0;

  const existing = await prisma.ledger.count({
    where: { userId, clientId },
  });
  if (existing > 0) return 0;

  const data = SEED_LEDGERS.map((l) => ({
    userId,
    clientId,
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
