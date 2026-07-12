/*
  Warnings:

  - A unique constraint covering the columns `[campaignId,externalId]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[campaignId,email]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[createdById,emailAddress]` on the table `SenderMailbox` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email,userId]` on the table `Suppression` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[domain,userId]` on the table `Suppression` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Suppression` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('NOT_ATTEMPTED', 'PENDING', 'FOUND', 'NOT_FOUND', 'INVALID', 'BOUNCED', 'SUPPRESSED');

-- DropIndex
DROP INDEX "SenderMailbox_emailAddress_key";

-- DropIndex
DROP INDEX "Suppression_domain_key";

-- DropIndex
DROP INDEX "Suppression_email_key";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "emailSource" TEXT,
ADD COLUMN     "emailStatus" "EmailStatus" NOT NULL DEFAULT 'NOT_ATTEMPTED',
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "draftIntent" TEXT,
ADD COLUMN     "oooRequeuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Suppression" ADD COLUMN     "userId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Lead_campaignId_externalId_key" ON "Lead"("campaignId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_campaignId_email_key" ON "Lead"("campaignId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "SenderMailbox_createdById_emailAddress_key" ON "SenderMailbox"("createdById", "emailAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_email_userId_key" ON "Suppression"("email", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_domain_userId_key" ON "Suppression"("domain", "userId");

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
