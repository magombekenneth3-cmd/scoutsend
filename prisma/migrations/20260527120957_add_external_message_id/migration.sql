-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "externalMessageId" TEXT;

-- CreateTable
CREATE TABLE "BrandSettings" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "tagline" TEXT,
    "logoUrl" TEXT,
    "primaryColour" TEXT NOT NULL DEFAULT '#1a1a2e',
    "secondaryColour" TEXT NOT NULL DEFAULT '#e94560',
    "accentColour" TEXT,
    "textColour" TEXT NOT NULL DEFAULT '#333333',
    "backgroundColour" TEXT NOT NULL DEFAULT '#ffffff',
    "fontFamily" TEXT NOT NULL DEFAULT 'Arial, sans-serif',
    "senderName" TEXT NOT NULL,
    "senderTitle" TEXT,
    "senderPhone" TEXT,
    "companyAddress" TEXT,
    "unsubscribeText" TEXT NOT NULL DEFAULT 'You received this email because you match our ideal customer profile. To unsubscribe, reply with ''unsubscribe''.',
    "facebookUrl" TEXT,
    "linkedinUrl" TEXT,
    "twitterUrl" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandSettings_userId_key" ON "BrandSettings"("userId");

-- AddForeignKey
ALTER TABLE "BrandSettings" ADD CONSTRAINT "BrandSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
