-- CreateEnum
CREATE TYPE "LedgerGroup" AS ENUM ('SUNDRY_CREDITORS', 'SUNDRY_DEBTORS', 'DUTIES_AND_TAXES', 'PURCHASE_ACCOUNTS', 'SALES_ACCOUNTS', 'DIRECT_EXPENSES', 'INDIRECT_EXPENSES', 'INDIRECT_INCOME', 'BANK_ACCOUNTS', 'CASH_IN_HAND', 'CURRENT_ASSETS', 'CURRENT_LIABILITIES', 'FIXED_ASSETS');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('PARTY', 'PURCHASE', 'SALE', 'TAX_INPUT', 'TAX_OUTPUT', 'EXPENSE', 'INCOME', 'ROUND_OFF', 'BANK', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "MatchKeyType" AS ENUM ('GSTIN', 'VENDOR_NAME');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('GSTIN_EQUALS', 'VENDOR_NAME_CONTAINS', 'VENDOR_NAME_EQUALS', 'HSN_EQUALS');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('PURCHASE', 'SALE', 'JOURNAL');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED');

-- CreateEnum
CREATE TYPE "LineRole" AS ENUM ('PARTY', 'ITEM', 'CGST', 'SGST', 'IGST', 'ROUND_OFF', 'DISCOUNT');

-- CreateEnum
CREATE TYPE "MappedVia" AS ENUM ('RULE', 'GSTIN_MEMORY', 'NAME_MEMORY', 'FUZZY', 'MANUAL', 'DEFAULT');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "documentType" TEXT;

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "group" "LedgerGroup" NOT NULL,
    "ledgerType" "LedgerType" NOT NULL,
    "gstRate" DOUBLE PRECISION,
    "isSeeded" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "parentGstin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerMapping" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "matchType" "MatchKeyType" NOT NULL,
    "matchKey" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "ruleType" "RuleType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "ledgerId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MappingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL DEFAULT '',
    "invoiceId" TEXT NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "date" TIMESTAMP(3) NOT NULL,
    "narration" TEXT,
    "totalDebit" DOUBLE PRECISION NOT NULL,
    "totalCredit" DOUBLE PRECISION NOT NULL,
    "roundOff" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerId" TEXT,
    "ledgerNameSnapshot" TEXT,
    "role" "LineRole" NOT NULL,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "mappedVia" "MappedVia",
    "hsnCode" TEXT,
    "gstRate" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Ledger_userId_ledgerType_idx" ON "Ledger"("userId", "ledgerType");

-- CreateIndex
CREATE UNIQUE INDEX "Ledger_userId_clientId_name_key" ON "Ledger"("userId", "clientId", "name");

-- CreateIndex
CREATE INDEX "LedgerMapping_userId_matchType_matchKey_idx" ON "LedgerMapping"("userId", "matchType", "matchKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerMapping_userId_clientId_matchType_matchKey_key" ON "LedgerMapping"("userId", "clientId", "matchType", "matchKey");

-- CreateIndex
CREATE INDEX "MappingRule_userId_enabled_priority_idx" ON "MappingRule"("userId", "enabled", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_invoiceId_key" ON "Voucher"("invoiceId");

-- CreateIndex
CREATE INDEX "Voucher_userId_status_idx" ON "Voucher"("userId", "status");

-- CreateIndex
CREATE INDEX "Voucher_userId_voucherType_date_idx" ON "Voucher"("userId", "voucherType", "date");

-- CreateIndex
CREATE INDEX "VoucherLine_voucherId_idx" ON "VoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "VoucherLine_ledgerId_idx" ON "VoucherLine"("ledgerId");

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerMapping" ADD CONSTRAINT "LedgerMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerMapping" ADD CONSTRAINT "LedgerMapping_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingRule" ADD CONSTRAINT "MappingRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingRule" ADD CONSTRAINT "MappingRule_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "Ledger"("id") ON DELETE SET NULL ON UPDATE CASCADE;
