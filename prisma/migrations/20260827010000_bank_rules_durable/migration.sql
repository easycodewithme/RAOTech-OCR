-- Bank rules become real rows instead of a process-memory Map.
--
-- Three things blocked reusing `MappingRule`, and this fixes each of them:
--
--  1. `RuleType` had no member for narration, amount or voucher type, so a bank
--     rule could not even be inserted.
--  2. `ledgerId` was a required FK. A bank rule holds the target ledger's NAME
--     so a ruleset can be cloned onto another client, where an id means
--     nothing. The name is resolved at read time.
--  3. `resolveLedgersForInvoice` reads EVERY enabled rule for the workspace.
--     Without a discriminator, bank rules would silently start deciding ledgers
--     for scanned bills. `scope` is that discriminator, and it defaults to
--     INVOICE so every existing row keeps its current meaning.

ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'NARRATION_CONTAINS';
ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'NARRATION_EQUALS';
ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'AMOUNT_GT';
ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'AMOUNT_LT';
ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'AMOUNT_EQUALS';
ALTER TYPE "RuleType" ADD VALUE IF NOT EXISTS 'TXN_TYPE_EQUALS';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RuleScope') THEN
    CREATE TYPE "RuleScope" AS ENUM ('INVOICE', 'BANK');
  END IF;
END $$;

ALTER TABLE "MappingRule" ADD COLUMN IF NOT EXISTS "scope" "RuleScope" NOT NULL DEFAULT 'INVOICE';
ALTER TABLE "MappingRule" ADD COLUMN IF NOT EXISTS "ledgerName" TEXT;
ALTER TABLE "MappingRule" ALTER COLUMN "ledgerId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "MappingRule_userId_clientId_scope_enabled_priority_idx"
  ON "MappingRule" ("userId", "clientId", "scope", "enabled", "priority");
