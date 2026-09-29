-- CreateTable
CREATE TABLE "CompetitorInsight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "painPoint" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "source" TEXT,
    "userFixesIt" BOOLEAN,
    "userNote" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorInsight_userId_tool_painPoint_key" ON "CompetitorInsight"("userId", "tool", "painPoint");
CREATE INDEX "CompetitorInsight_userId_tool_idx" ON "CompetitorInsight"("userId", "tool");

-- AddForeignKey
ALTER TABLE "CompetitorInsight" ADD CONSTRAINT "CompetitorInsight_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
