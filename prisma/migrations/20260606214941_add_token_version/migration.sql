/*
  Warnings:

  - You are about to drop the column `type` on the `LeadSignal` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[emailAddress]` on the table `SenderMailbox` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliverabilityEventType" ADD VALUE 'MAILBOX_BLOCKED';
ALTER TYPE "DeliverabilityEventType" ADD VALUE 'SUBJECT_LINE_EXHAUSTION';

-- AlterTable
ALTER TABLE "LeadSignal" DROP COLUMN "type";

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "subjectVariant" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "SenderMailbox_emailAddress_key" ON "SenderMailbox"("emailAddress");
