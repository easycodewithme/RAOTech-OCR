-- Two unrelated gaps that both come down to "the books cannot answer a
-- question a CA firm has to be able to answer".
--
-- Hand-written and additive, like every migration here: this database is shared
-- with an unrelated project, so `prisma migrate diff` would propose dropping
-- thirteen tables that have nothing to do with this app. Every statement is
-- idempotent so a partially-applied run can simply be re-run.

-- ---------------------------------------------------------------------------
-- 1. Who did what.
--
-- The only actor field in the schema was `Voucher.approvedBy`, and with one
-- login per firm that is a constant. Nothing recorded who pushed to a client's
-- live books, and deletions were recorded nowhere at all. The actor's identity
-- is denormalised on purpose: the record has to still make sense after the
-- staff member has left, and a join to a deleted `User` answers nothing.
--
-- `entityId` is deliberately NOT a foreign key. The row must outlive the thing
-- it describes being deleted, which is exactly the case worth auditing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "AuditEvent" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "clientId"     TEXT,
  "actorClerkId" TEXT,
  "actorEmail"   TEXT,
  "actorName"    TEXT,
  "action"       TEXT NOT NULL,
  "entityType"   TEXT NOT NULL,
  "entityId"     TEXT,
  "summary"      TEXT NOT NULL,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AuditEvent_userId_createdAt_idx"
  ON "AuditEvent" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_clientId_createdAt_idx"
  ON "AuditEvent" ("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_entityType_entityId_idx"
  ON "AuditEvent" ("entityType", "entityId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditEvent_userId_fkey') THEN
    ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- SET NULL, not CASCADE: removing a client must not erase the record of what
  -- was done to their books while they were one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AuditEvent_clientId_fkey') THEN
    ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. What a bill allocation is actually against.
--
-- Every allocation was emitted as `New Ref`, which is correct only for the
-- document that *creates* an outstanding. A payment or a return carrying
-- `New Ref` opens a second reference beside the invoice it was meant to
-- settle: Tally parks it On Account, the original stays fully outstanding, and
-- the client's ageing is wrong from the first payment onwards.
--
-- `billRefType` holds Tally's own vocabulary — "New Ref", "Agst Ref",
-- "Advance", "On Account" — as text rather than an enum, because that list is
-- Tally's to change and a new value must not require a migration here.
-- ---------------------------------------------------------------------------
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "billRefType" TEXT;
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "billRefName" TEXT;

-- The document a credit or debit note reverses. Stored as number and date
-- rather than a foreign key because the original very often is not in this
-- workspace: the firm may have keyed it straight into Tally, or it may predate
-- the client's onboarding. These are also the two values GSTR-1 Table 9B
-- (CDNR) requires, so without them a return was unfilable as well as
-- unallocated.
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "againstInvoiceNumber" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "againstInvoiceDate"   TIMESTAMP(3);
