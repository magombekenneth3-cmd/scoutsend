-- AlterEnum
ALTER TYPE "StepTrigger" ADD VALUE 'ON_NO_ACCEPT';

-- DropIndex
DROP INDEX "LossRecord_embedding_ivfflat_idx";

-- DropIndex
DROP INDEX "WinRecord_embedding_ivfflat_idx";
