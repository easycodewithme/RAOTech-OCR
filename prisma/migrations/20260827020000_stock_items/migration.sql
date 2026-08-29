-- Stock items, so a voucher can move inventory as well as money.
--
-- Until now a WITH_ITEM spreadsheet parsed its item rows and then posted a
-- ledger-only voucher. For a client who keeps stock in Tally that is not a
-- missing feature, it is a silent corruption: the money lands correctly and the
-- quantities never move, so every stock report drifts further from reality each
-- month and nothing in either system says so.
--
-- Measured (connector-protocol.md rules 10-13): Tally will not invent a stock
-- item any more than it invents a ledger, a stock item cannot name a unit that
-- does not exist, and a stock item must be sent WITHOUT a <PARENT> because a
-- company that has never used inventory has no stock groups at all.

CREATE TABLE IF NOT EXISTS "StockItem" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "clientId"       TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  -- Base unit as Tally spells it ("Nos", "Kg", "Ltr"). Null means the item is
  -- known here but has no unit yet, which blocks the Tally create rather than
  -- guessing one: a wrong base unit cannot be altered once stock has moved.
  "unit"           TEXT,
  "hsnCode"        TEXT,
  "gstRate"        DOUBLE PRECISION,
  "alias"          TEXT,
  "openingQty"     DOUBLE PRECISION,
  "openingRate"    DOUBLE PRECISION,
  "tallyCompanyId" TEXT,
  "tallyGuid"      TEXT,
  "tallyName"      TEXT,
  "tallySyncedAt"  TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_userId_clientId_name_key"
  ON "StockItem" ("userId", "clientId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_tallyCompanyId_tallyGuid_key"
  ON "StockItem" ("tallyCompanyId", "tallyGuid");
CREATE INDEX IF NOT EXISTS "StockItem_userId_clientId_idx"
  ON "StockItem" ("userId", "clientId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockItem_userId_fkey') THEN
    ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockItem_clientId_fkey') THEN
    ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockItem_tallyCompanyId_fkey') THEN
    ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_tallyCompanyId_fkey"
      FOREIGN KEY ("tallyCompanyId") REFERENCES "TallyCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- The allocation itself. A line carrying a stockItemId posts as an
-- ALLINVENTORYENTRIES.LIST with its accounting ledger nested inside; a line
-- without one posts as a plain ALLLEDGERENTRIES.LIST exactly as before.
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "stockItemId"   TEXT;
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "stockItemName" TEXT;
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "quantity"      DOUBLE PRECISION;
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "unit"          TEXT;
ALTER TABLE "VoucherLine" ADD COLUMN IF NOT EXISTS "rate"          DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "VoucherLine_stockItemId_idx" ON "VoucherLine" ("stockItemId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VoucherLine_stockItemId_fkey') THEN
    ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_stockItemId_fkey"
      FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Bulk master upload reuses the whole spreadsheet pipeline, so the kind of
-- thing being uploaded is just another ExcelDocType. These two produce masters
-- rather than vouchers, which is why the commit route branches on them.
ALTER TYPE "ExcelDocType" ADD VALUE IF NOT EXISTS 'LEDGER_MASTER';
ALTER TYPE "ExcelDocType" ADD VALUE IF NOT EXISTS 'ITEM_MASTER';
