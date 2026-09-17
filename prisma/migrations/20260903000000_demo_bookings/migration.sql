CREATE TYPE "DemoBookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

CREATE TABLE "DemoBooking" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "meetUrl" TEXT NOT NULL,
    "calendarEventId" TEXT,
    "status" "DemoBookingStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DemoBooking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DemoBooking_userId_key" ON "DemoBooking"("userId");
CREATE INDEX "DemoBooking_startAt_endAt_idx" ON "DemoBooking"("startAt", "endAt");

ALTER TABLE "DemoBooking" ADD CONSTRAINT "DemoBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;