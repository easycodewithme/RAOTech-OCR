CREATE TABLE "GoogleOAuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoogleOAuthToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleOAuthToken_userId_key" ON "GoogleOAuthToken"("userId");
ALTER TABLE "GoogleOAuthToken" ADD CONSTRAINT "GoogleOAuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;