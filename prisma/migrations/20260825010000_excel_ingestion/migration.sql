-- Excel / CSV ingestion: ExcelUpload + MappingTemplate.
--
-- Additive only and idempotent, matching this repo's convention: every
-- statement creates a new object, so it cannot lose data and is safe to re-run
-- against a live pilot database.
--
-- Hand-filtered rather than generated. `prisma migrate diff` against this
-- datasource also proposes dropping 13 tables belonging to an unrelated
-- inventory application that shares the database, plus assorted index and
-- default churn. None of that belongs to this change.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ExcelDocType" AS ENUM ('PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN', 'JOURNAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ExcelItemMode" AS ENUM ('WITHOUT_ITEM', 'WITH_ITEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ExcelUploadStatus" AS ENUM ('UPLOADED', 'MAPPING', 'READY', 'COMMITTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExcelUpload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sheetName" TEXT,
    "docType" "ExcelDocType" NOT NULL,
    "itemMode" "ExcelItemMode" NOT NULL DEFAULT 'WITHOUT_ITEM',
    "headerRowIndex" INTEGER NOT NULL DEFAULT 0,
    "headers" TEXT[],
    "headerFingerprint" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "committedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "ExcelUploadStatus" NOT NULL DEFAULT 'UPLOADED',
    "error" TEXT,
    "mapping" JSONB,
    "templateId" TEXT,
    "issues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ExcelUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MappingTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" "ExcelDocType" NOT NULL,
    "itemMode" "ExcelItemMode" NOT NULL DEFAULT 'WITHOUT_ITEM',
    "headerFingerprint" TEXT NOT NULL,
    "headers" TEXT[],
    "mapping" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "sourceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExcelUpload_userId_clientId_status_idx" ON "ExcelUpload"("userId", "clientId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExcelUpload_clientId_createdAt_idx" ON "ExcelUpload"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MappingTemplate_userId_docType_headerFingerprint_idx" ON "MappingTemplate"("userId", "docType", "headerFingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MappingTemplate_clientId_lastUsedAt_idx" ON "MappingTemplate"("clientId", "lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MappingTemplate_userId_clientId_docType_headerFingerprint_key" ON "MappingTemplate"("userId", "clientId", "docType", "headerFingerprint");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ExcelUpload" ADD CONSTRAINT "ExcelUpload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ExcelUpload" ADD CONSTRAINT "ExcelUpload_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ExcelUpload" ADD CONSTRAINT "ExcelUpload_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MappingTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MappingTemplate" ADD CONSTRAINT "MappingTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "MappingTemplate" ADD CONSTRAINT "MappingTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
