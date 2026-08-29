-- Excel ingestion: staging area for parsed rows between mapping and commit.
-- Additive; cleared at commit so it never becomes a second copy of the data.

ALTER TABLE "ExcelUpload" ADD COLUMN IF NOT EXISTS "rows" JSONB;
