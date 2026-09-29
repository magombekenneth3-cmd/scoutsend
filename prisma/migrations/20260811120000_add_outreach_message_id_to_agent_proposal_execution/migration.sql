-- AlterTable
ALTER TABLE "AgentProposalExecution" ADD COLUMN IF NOT EXISTS "outreachMessageId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentProposalExecution_outreachMessageId_idx" ON "AgentProposalExecution"("outreachMessageId");
