-- Bank statement lines can become vouchers.
--
-- Additive and idempotent: new nullable columns and one unique index. Existing
-- BankTxn rows keep working unchanged — they simply have no voucher yet.

ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "openingBalance" DOUBLE PRECISION;
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "closingBalance" DOUBLE PRECISION;
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "balanceOk" BOOLEAN;
ALTER TABLE "BankStatement" ADD COLUMN IF NOT EXISTS "balanceNote" TEXT;

ALTER TABLE "BankTxn" ADD COLUMN IF NOT EXISTS "allocations" JSONB;
ALTER TABLE "BankTxn" ADD COLUMN IF NOT EXISTS "saved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BankTxn" ADD COLUMN IF NOT EXISTS "savedAt" TIMESTAMP(3);
ALTER TABLE "BankTxn" ADD COLUMN IF NOT EXISTS "voucherId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BankTxn_voucherId_key" ON "BankTxn"("voucherId");
CREATE INDEX IF NOT EXISTS "BankTxn_statementId_saved_idx" ON "BankTxn"("statementId", "saved");

DO $$ BEGIN
    ALTER TABLE "BankTxn" ADD CONSTRAINT "BankTxn_voucherId_fkey"
      FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
