-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ProposalExecutionStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentProposalExecution" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalHash" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" "ProposalExecutionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "AgentProposalExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentProposalExecution_proposalId_key" ON "AgentProposalExecution"("proposalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentProposalExecution_proposalId_idx" ON "AgentProposalExecution"("proposalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentProposalExecution_requestFingerprint_idx" ON "AgentProposalExecution"("requestFingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentProposalExecution_contextHash_idx" ON "AgentProposalExecution"("contextHash");
