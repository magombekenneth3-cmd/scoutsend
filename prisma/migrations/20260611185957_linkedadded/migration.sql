-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('EMAIL', 'LINKEDIN_VISIT', 'LINKEDIN_CONNECT', 'LINKEDIN_MESSAGE', 'LINKEDIN_INMAIL');

-- CreateEnum
CREATE TYPE "StepTrigger" AS ENUM ('AFTER_DELAY', 'ON_NO_REPLY', 'ON_OPEN', 'ON_CONNECT_ACCEPT');

-- CreateEnum
CREATE TYPE "StepExecutionStatus" AS ENUM ('PENDING', 'SCHEDULED', 'EXECUTING', 'DONE', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LinkedInStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REPLIED', 'FAILED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "linkedInAccountId" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "channel" "Channel" NOT NULL DEFAULT 'EMAIL';

-- AlterTable
ALTER TABLE "SenderMailbox" ADD COLUMN     "calendlyToken" JSONB;

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "channel" "Channel" NOT NULL,
    "trigger" "StepTrigger" NOT NULL DEFAULT 'AFTER_DELAY',
    "delayDays" INTEGER NOT NULL DEFAULT 3,
    "messageTemplate" TEXT,
    "subjectTemplate" TEXT,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStepStatus" (
    "id" TEXT NOT NULL,
    "status" "StepExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "errorMsg" TEXT,
    "stepId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "linkedInActivityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadStepStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedInActivity" (
    "id" TEXT NOT NULL,
    "activityType" "Channel" NOT NULL,
    "providerRef" TEXT,
    "message" TEXT,
    "connectionNote" TEXT,
    "status" "LinkedInStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "leadId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SequenceStep_campaignId_idx" ON "SequenceStep"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_campaignId_stepIndex_key" ON "SequenceStep"("campaignId", "stepIndex");

-- CreateIndex
CREATE INDEX "LeadStepStatus_stepId_idx" ON "LeadStepStatus"("stepId");

-- CreateIndex
CREATE INDEX "LeadStepStatus_leadId_idx" ON "LeadStepStatus"("leadId");

-- CreateIndex
CREATE INDEX "LeadStepStatus_status_scheduledAt_idx" ON "LeadStepStatus"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStepStatus_stepId_leadId_key" ON "LeadStepStatus"("stepId", "leadId");

-- CreateIndex
CREATE INDEX "LinkedInActivity_leadId_idx" ON "LinkedInActivity"("leadId");

-- CreateIndex
CREATE INDEX "LinkedInActivity_status_idx" ON "LinkedInActivity"("status");

-- CreateIndex
CREATE INDEX "LinkedInActivity_activityType_idx" ON "LinkedInActivity"("activityType");

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStepStatus" ADD CONSTRAINT "LeadStepStatus_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "SequenceStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStepStatus" ADD CONSTRAINT "LeadStepStatus_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStepStatus" ADD CONSTRAINT "LeadStepStatus_linkedInActivityId_fkey" FOREIGN KEY ("linkedInActivityId") REFERENCES "LinkedInActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedInActivity" ADD CONSTRAINT "LinkedInActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
