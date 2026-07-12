-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable
ALTER TABLE "LossRecord" ADD COLUMN     "embedding" vector(768);

-- AlterTable
ALTER TABLE "WinRecord" ADD COLUMN     "embedding" vector(768);
