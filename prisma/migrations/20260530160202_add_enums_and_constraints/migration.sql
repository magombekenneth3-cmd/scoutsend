/*
  Warnings:

  - The `outcome` column on the `LearningEvent` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[domain]` on the table `Suppression` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `type` on the `DeliverabilityEvent` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `severity` on the `DeliverabilityEvent` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `eventType` on the `LearningEvent` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "DeliverabilityEventType" AS ENUM ('BOUNCE', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'SPAM_COMPLAINT', 'UNSUBSCRIBE', 'DELIVERY_FAILURE', 'DOMAIN_BLOCKED');

-- CreateEnum
CREATE TYPE "DeliverabilityEventSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LearningEventType" AS ENUM ('REVIEW_FLAGGED', 'HUMAN_EDITED', 'HUMAN_APPROVED', 'HUMAN_REJECTED', 'AUTO_APPROVED');

-- CreateEnum
CREATE TYPE "LearningOutcome" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'EDITED_AND_APPROVED', 'DISMISSED');

-- DropForeignKey
ALTER TABLE "Reply" DROP CONSTRAINT "Reply_leadId_fkey";

-- AlterTable
ALTER TABLE "DeliverabilityEvent" DROP COLUMN "type",
ADD COLUMN     "type" "DeliverabilityEventType" NOT NULL,
DROP COLUMN "severity",
ADD COLUMN     "severity" "DeliverabilityEventSeverity" NOT NULL;

-- AlterTable
ALTER TABLE "LearningEvent" DROP COLUMN "eventType",
ADD COLUMN     "eventType" "LearningEventType" NOT NULL,
DROP COLUMN "outcome",
ADD COLUMN     "outcome" "LearningOutcome";

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_domain_key" ON "Suppression"("domain");

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
