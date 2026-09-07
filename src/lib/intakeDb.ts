import { prisma } from "@/lib/prisma";

let tablesEnsured = false;

/**
 * Ensures IntakeLink and IntakeDocument tables and indexes exist in the connected database.
 * This guarantees the feature works even if the production database has not yet
 * had `prisma db push` or migrations run on it.
 */
export async function ensureIntakeTables(): Promise<void> {
  if (tablesEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
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

      CREATE TABLE IF NOT EXISTS "IntakeDocument" (
        "id" TEXT NOT NULL,
        "intakeLinkId" TEXT NOT NULL,
        "clientId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "fileName" TEXT NOT NULL,
        "fileSize" INTEGER NOT NULL,
        "mimeType" TEXT NOT NULL,
        "fileData" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "IntakeDocument_pkey" PRIMARY KEY ("id")
      );
      CREATE INDEX IF NOT EXISTS "IntakeDocument_clientId_status_idx" ON "IntakeDocument"("clientId", "status");
      CREATE INDEX IF NOT EXISTS "IntakeDocument_intakeLinkId_idx" ON "IntakeDocument"("intakeLinkId");
    `);
    tablesEnsured = true;
  } catch (e) {
    console.error("[ENSURE_INTAKE_TABLES]", e);
  }
}
