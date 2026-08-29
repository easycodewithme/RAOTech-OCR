-- Tally connector: Phase 1 data model.
--
-- Additive only. Every statement below either creates a new object or adds a
-- nullable/defaulted column, so it cannot lose data and is safe to run against
-- a live pilot database.
--
-- Hand-written rather than generated: `prisma migrate diff` against this
-- datasource also proposes dropping an unrelated inventory schema that shares
-- the database (products, warehouses, stock, deliveries, ...) and re-creating
-- several existing indexes. None of that belongs to this change.

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "TallyCompanyStatus" AS ENUM ('UNSYNCED', 'SYNCING', 'READY', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SyncJobKind" AS ENUM ('MASTER_PULL', 'MASTER_CREATE', 'VOUCHER_PUSH', 'VOUCHER_DELETE', 'PING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "SyncJobState" AS ENUM ('QUEUED', 'CLAIMED', 'DONE', 'FAILED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "VoucherSyncState" AS ENUM ('QUEUED', 'SENDING', 'POSTED', 'FAILED', 'DELETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "Ledger" ADD COLUMN IF NOT EXISTS "tallyCompanyId" TEXT,
ADD COLUMN IF NOT EXISTS "tallyGuid" TEXT,
ADD COLUMN IF NOT EXISTS "tallyName" TEXT,
ADD COLUMN IF NOT EXISTS "tallyParent" TEXT,
ADD COLUMN IF NOT EXISTS "tallyReserved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "tallySyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TallyCompany" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "companyGuid" TEXT,
    "booksFrom" TIMESTAMP(3),
    "fyStart" TIMESTAMP(3),
    "fyEnd" TIMESTAMP(3),
    "status" "TallyCompanyStatus" NOT NULL DEFAULT 'UNSYNCED',
    "lastSyncedAt" TIMESTAMP(3),
    "ledgerCount" INTEGER NOT NULL DEFAULT 0,
    "educationMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConnectorDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "machineId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "tallyHost" TEXT NOT NULL DEFAULT 'localhost',
    "tallyPort" INTEGER NOT NULL DEFAULT 9000,
    "appVersion" TEXT,
    "osVersion" TEXT,
    "tallyReachable" BOOLEAN,
    "tallyMessage" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PairingCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tallyCompanyId" TEXT,
    "deviceId" TEXT,
    "kind" "SyncJobKind" NOT NULL,
    "state" "SyncJobState" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "VoucherSync" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "tallyCompanyId" TEXT NOT NULL,
    "jobId" TEXT,
    "remoteId" TEXT NOT NULL,
    "state" "VoucherSyncState" NOT NULL DEFAULT 'QUEUED',
    "tallyMasterId" INTEGER,
    "tallyVoucherNumber" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoucherSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TallyCompany_clientId_key" ON "TallyCompany"("clientId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TallyCompany_userId_idx" ON "TallyCompany"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ConnectorDevice_tokenHash_key" ON "ConnectorDevice"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ConnectorDevice_userId_revokedAt_idx" ON "ConnectorDevice"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PairingCode_code_key" ON "PairingCode"("code");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PairingCode_userId_idx" ON "PairingCode"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncJob_userId_state_createdAt_idx" ON "SyncJob"("userId", "state", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncJob_clientId_state_idx" ON "SyncJob"("clientId", "state");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VoucherSync_remoteId_key" ON "VoucherSync"("remoteId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VoucherSync_tallyCompanyId_state_idx" ON "VoucherSync"("tallyCompanyId", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VoucherSync_jobId_idx" ON "VoucherSync"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "VoucherSync_voucherId_tallyCompanyId_key" ON "VoucherSync"("voucherId", "tallyCompanyId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ledger_tallyCompanyId_idx" ON "Ledger"("tallyCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ledger_tallyCompanyId_tallyGuid_key" ON "Ledger"("tallyCompanyId", "tallyGuid");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_tallyCompanyId_fkey" FOREIGN KEY ("tallyCompanyId") REFERENCES "TallyCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TallyCompany" ADD CONSTRAINT "TallyCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TallyCompany" ADD CONSTRAINT "TallyCompany_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "ConnectorDevice" ADD CONSTRAINT "ConnectorDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_tallyCompanyId_fkey" FOREIGN KEY ("tallyCompanyId") REFERENCES "TallyCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ConnectorDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "VoucherSync" ADD CONSTRAINT "VoucherSync_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "VoucherSync" ADD CONSTRAINT "VoucherSync_tallyCompanyId_fkey" FOREIGN KEY ("tallyCompanyId") REFERENCES "TallyCompany"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "VoucherSync" ADD CONSTRAINT "VoucherSync_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
