/*
  Warnings:

  - A unique constraint covering the columns `[bullJobId]` on the table `QueueJob` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `LeadSignal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


-- ALTER TYPE "DeliverabilityEventType" ADD VALUE 'HEALTH_WARNING';
-- ALTER TYPE "DeliverabilityEventType" ADD VALUE 'HEALTH_DEGRADED';
-- ALTER TYPE "DeliverabilityEventType" ADD VALUE 'HEALTH_BLOCKED';

-- AlterTable
ALTER TABLE "LeadSignal" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
-- ALTER TABLE "QueueJob" ADD COLUMN     "bullJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "QueueJob_bullJobId_key" ON "QueueJob"("bullJobId");
