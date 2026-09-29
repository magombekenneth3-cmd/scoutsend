-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN "aggregateVersion" INTEGER NOT NULL DEFAULT 0;
