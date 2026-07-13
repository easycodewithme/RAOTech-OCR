-- TaxOne Phase 1–2 schema upgrade with safe clientId backfill
-- Existing rows get a per-user "Default Client" before NOT NULL is enforced.

-- Enums (idempotent where possible)
DO $$ BEGIN
  CREATE TYPE "UserRole" AS ENUM ('CA', 'CLERK', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MemberRole" AS ENUM ('CA', 'CLERK', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "BankTxnClass" AS ENUM ('PAYMENT', 'RECEIPT', 'CONTRA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReconStatus" AS ENUM ('MATCHED', 'VALUE_MISMATCH', 'MISSING_IN_2B', 'MISSING_IN_BOOKS', 'DUPLICATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Extend existing enums
ALTER TYPE "MatchKeyType" ADD VALUE IF NOT EXISTS 'NARRATION';
ALTER TYPE "MappedVia" ADD VALUE IF NOT EXISTS 'NARRATION_MEMORY';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'CREDIT_NOTE';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'PAYMENT';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'RECEIPT';
ALTER TYPE "VoucherType" ADD VALUE IF NOT EXISTS 'CONTRA';
ALTER TYPE "VoucherStatus" ADD VALUE IF NOT EXISTS 'EXPORTED_DEMO';

-- User role / active client
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'CA';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeClientId" TEXT;

-- Client workspace
CREATE TABLE IF NOT EXISTS "Client" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "gstin" TEXT,
  "pan" TEXT,
  "address" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "tallyCompany" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Client_userId_name_key" ON "Client"("userId", "name");
CREATE INDEX IF NOT EXISTS "Client_userId_idx" ON "Client"("userId");

DO $$ BEGIN
  ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClientMember" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "MemberRole" NOT NULL DEFAULT 'CLERK',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClientMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientMember_clientId_userId_key" ON "ClientMember"("clientId", "userId");
CREATE INDEX IF NOT EXISTS "ClientMember_userId_idx" ON "ClientMember"("userId");

DO $$ BEGIN
  ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Ensure every user has a default client
INSERT INTO "Client" ("id", "userId", "name", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", 'Default Client', true, NOW(), NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Client" c WHERE c."userId" = u."id"
);

UPDATE "User" u
SET "activeClientId" = c."id"
FROM "Client" c
WHERE c."userId" = u."id" AND c."isDefault" = true AND u."activeClientId" IS NULL;

-- Helper: pick default client id for a user
-- Invoice new columns + clientId
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "validationFlags" JSONB;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "isDuplicate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "duplicateOfId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "irn" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "ackNo" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "ewayBillNo" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "documentType" TEXT;

UPDATE "Invoice" i
SET "clientId" = c."id"
FROM "Client" c
WHERE c."userId" = i."userId" AND (c."isDefault" = true OR true)
  AND i."clientId" IS NULL
  AND c."id" = (
    SELECT c2."id" FROM "Client" c2
    WHERE c2."userId" = i."userId"
    ORDER BY c2."isDefault" DESC, c2."createdAt" ASC
    LIMIT 1
  );

-- Ledger / Mapping / Rule / Voucher / BankStatement already may have clientId DEFAULT ''
ALTER TABLE "Ledger" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "LedgerMapping" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "MappingRule" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "avgConfidence" DOUBLE PRECISION;
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "exportedAt" TIMESTAMP(3);
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Voucher" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;

ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'DRAFT';

ALTER TABLE "BankTxn" ADD COLUMN IF NOT EXISTS "classification" "BankTxnClass";
ALTER TABLE "BankTxn" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION;

UPDATE "Ledger" l SET "clientId" = (
  SELECT c."id" FROM "Client" c WHERE c."userId" = l."userId"
  ORDER BY c."isDefault" DESC, c."createdAt" ASC LIMIT 1
) WHERE l."clientId" IS NULL OR l."clientId" = '';

UPDATE "LedgerMapping" m SET "clientId" = (
  SELECT c."id" FROM "Client" c WHERE c."userId" = m."userId"
  ORDER BY c."isDefault" DESC, c."createdAt" ASC LIMIT 1
) WHERE m."clientId" IS NULL OR m."clientId" = '';

UPDATE "MappingRule" r SET "clientId" = (
  SELECT c."id" FROM "Client" c WHERE c."userId" = r."userId"
  ORDER BY c."isDefault" DESC, c."createdAt" ASC LIMIT 1
) WHERE r."clientId" IS NULL OR r."clientId" = '';

UPDATE "Voucher" v SET "clientId" = (
  SELECT c."id" FROM "Client" c WHERE c."userId" = v."userId"
  ORDER BY c."isDefault" DESC, c."createdAt" ASC LIMIT 1
) WHERE v."clientId" IS NULL OR v."clientId" = '';

UPDATE "BankStatement" b SET "clientId" = (
  SELECT c."id" FROM "Client" c WHERE c."userId" = b."userId"
  ORDER BY c."isDefault" DESC, c."createdAt" ASC LIMIT 1
) WHERE b."clientId" IS NULL OR b."clientId" = '';

-- Enforce NOT NULL now that backfill is done
ALTER TABLE "Invoice" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "Ledger" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "LedgerMapping" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "MappingRule" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "Voucher" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "BankStatement" ALTER COLUMN "clientId" SET NOT NULL;

-- Drop old unique indexes that conflict with client-scoped uniques (best-effort)
DROP INDEX IF EXISTS "Ledger_userId_name_key";
DROP INDEX IF EXISTS "LedgerMapping_userId_matchType_matchKey_key";

CREATE UNIQUE INDEX IF NOT EXISTS "Ledger_userId_clientId_name_key" ON "Ledger"("userId", "clientId", "name");
CREATE INDEX IF NOT EXISTS "Ledger_userId_clientId_ledgerType_idx" ON "Ledger"("userId", "clientId", "ledgerType");

CREATE UNIQUE INDEX IF NOT EXISTS "LedgerMapping_userId_clientId_matchType_matchKey_key"
  ON "LedgerMapping"("userId", "clientId", "matchType", "matchKey");
CREATE INDEX IF NOT EXISTS "LedgerMapping_userId_clientId_matchType_matchKey_idx"
  ON "LedgerMapping"("userId", "clientId", "matchType", "matchKey");

CREATE INDEX IF NOT EXISTS "MappingRule_userId_clientId_enabled_priority_idx"
  ON "MappingRule"("userId", "clientId", "enabled", "priority");

CREATE INDEX IF NOT EXISTS "Invoice_userId_clientId_idx" ON "Invoice"("userId", "clientId");
CREATE INDEX IF NOT EXISTS "Invoice_clientId_invoiceNumber_vendorGstin_idx"
  ON "Invoice"("clientId", "invoiceNumber", "vendorGstin");
CREATE INDEX IF NOT EXISTS "Invoice_clientId_status_idx" ON "Invoice"("clientId", "status");

CREATE INDEX IF NOT EXISTS "Voucher_userId_clientId_status_idx" ON "Voucher"("userId", "clientId", "status");
CREATE INDEX IF NOT EXISTS "Voucher_userId_clientId_voucherType_date_idx"
  ON "Voucher"("userId", "clientId", "voucherType", "date");

CREATE INDEX IF NOT EXISTS "BankStatement_userId_clientId_status_idx"
  ON "BankStatement"("userId", "clientId", "status");

-- FKs to Client
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_activeClientId_fkey"
    FOREIGN KEY ("activeClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LedgerMapping" ADD CONSTRAINT "LedgerMapping_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MappingRule" ADD CONSTRAINT "MappingRule_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- New GST / export / intake / task tables
CREATE TABLE IF NOT EXISTS "Gst2bUpload" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "period" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "matched" INTEGER NOT NULL DEFAULT 0,
  "mismatched" INTEGER NOT NULL DEFAULT 0,
  "missingBooks" INTEGER NOT NULL DEFAULT 0,
  "missing2b" INTEGER NOT NULL DEFAULT 0,
  "itcEligible" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "itcAtRisk" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rawSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Gst2bUpload_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Gst2bUpload_userId_clientId_idx" ON "Gst2bUpload"("userId", "clientId");

CREATE TABLE IF NOT EXISTS "Gst2bRow" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "supplierGstin" TEXT,
  "supplierName" TEXT,
  "invoiceNumber" TEXT,
  "invoiceDate" TIMESTAMP(3),
  "taxableValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "igst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sgst" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cess" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalTax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "invoiceType" TEXT,
  "raw" JSONB,
  CONSTRAINT "Gst2bRow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Gst2bRow_uploadId_idx" ON "Gst2bRow"("uploadId");
CREATE INDEX IF NOT EXISTS "Gst2bRow_supplierGstin_invoiceNumber_idx" ON "Gst2bRow"("supplierGstin", "invoiceNumber");

CREATE TABLE IF NOT EXISTS "GstReconMatch" (
  "id" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "gst2bRowId" TEXT,
  "invoiceId" TEXT,
  "status" "ReconStatus" NOT NULL,
  "taxableDiff" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "taxDiff" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GstReconMatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GstReconMatch_gst2bRowId_key" ON "GstReconMatch"("gst2bRowId");
CREATE INDEX IF NOT EXISTS "GstReconMatch_uploadId_status_idx" ON "GstReconMatch"("uploadId", "status");

CREATE TABLE IF NOT EXISTS "TallyExport" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "voucherIds" TEXT[],
  "fileName" TEXT NOT NULL,
  "voucherCount" INTEGER NOT NULL DEFAULT 0,
  "ledgerCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'EXPORTED_DEMO',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TallyExport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TallyExport_userId_clientId_idx" ON "TallyExport"("userId", "clientId");

CREATE TABLE IF NOT EXISTS "IntakeLink" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "label" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntakeLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IntakeLink_token_key" ON "IntakeLink"("token");
CREATE INDEX IF NOT EXISTS "IntakeLink_clientId_idx" ON "IntakeLink"("clientId");

CREATE TABLE IF NOT EXISTS "Task" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
  "priority" INTEGER NOT NULL DEFAULT 2,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Task_userId_clientId_status_idx" ON "Task"("userId", "clientId", "status");

-- FKs for new tables
DO $$ BEGIN
  ALTER TABLE "Gst2bUpload" ADD CONSTRAINT "Gst2bUpload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Gst2bUpload" ADD CONSTRAINT "Gst2bUpload_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Gst2bRow" ADD CONSTRAINT "Gst2bRow_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "Gst2bUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "GstReconMatch" ADD CONSTRAINT "GstReconMatch_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "Gst2bUpload"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GstReconMatch" ADD CONSTRAINT "GstReconMatch_gst2bRowId_fkey"
    FOREIGN KEY ("gst2bRowId") REFERENCES "Gst2bRow"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GstReconMatch" ADD CONSTRAINT "GstReconMatch_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TallyExport" ADD CONSTRAINT "TallyExport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "TallyExport" ADD CONSTRAINT "TallyExport_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "IntakeLink" ADD CONSTRAINT "IntakeLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "IntakeLink" ADD CONSTRAINT "IntakeLink_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Task" ADD CONSTRAINT "Task_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
