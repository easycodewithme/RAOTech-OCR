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

ALTER TABLE "IntakeDocument" DROP CONSTRAINT IF EXISTS "IntakeDocument_intakeLinkId_fkey";
ALTER TABLE "IntakeDocument" ADD CONSTRAINT "IntakeDocument_intakeLinkId_fkey" FOREIGN KEY ("intakeLinkId") REFERENCES "IntakeLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntakeDocument" DROP CONSTRAINT IF EXISTS "IntakeDocument_clientId_fkey";
ALTER TABLE "IntakeDocument" ADD CONSTRAINT "IntakeDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntakeDocument" DROP CONSTRAINT IF EXISTS "IntakeDocument_userId_fkey";
ALTER TABLE "IntakeDocument" ADD CONSTRAINT "IntakeDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
