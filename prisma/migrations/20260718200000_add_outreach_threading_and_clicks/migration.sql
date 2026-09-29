-- Add self-referencing thread relationship and click counter to OutreachMessage
ALTER TABLE "OutreachMessage" ADD COLUMN "parentMessageId" TEXT;
ALTER TABLE "OutreachMessage" ADD COLUMN "clicks" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "OutreachMessage"
  ADD CONSTRAINT "OutreachMessage_parentMessageId_fkey"
  FOREIGN KEY ("parentMessageId")
  REFERENCES "OutreachMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "OutreachMessage_parentMessageId_idx" ON "OutreachMessage"("parentMessageId");
