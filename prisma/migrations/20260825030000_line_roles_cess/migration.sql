-- Flat voucher line model: two roles the invoice shape could not express, and
-- a place for compensation cess.
--
-- Additive and idempotent. New enum values only ever widen what a column can
-- hold, so existing rows are untouched and the change is safe to re-run.
--
-- BANK is the bank/cash side of a Payment, Receipt or Contra voucher — the
-- roles a bank statement produces. CESS previously had nowhere to go and the
-- amount was absorbed into the round-off residual.

ALTER TYPE "LineRole" ADD VALUE IF NOT EXISTS 'CESS';
ALTER TYPE "LineRole" ADD VALUE IF NOT EXISTS 'BANK';

ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "cess" DOUBLE PRECISION;
