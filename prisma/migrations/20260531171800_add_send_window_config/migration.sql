-- Add send-window configuration to Campaign
-- sendWindowStart / sendWindowEnd: UTC hour (0-23) bounding the delivery window
-- sendWindowDays:  bitmask 1=Mon … 7=Sun, stored as int[]. NULL = use global default (Mon-Fri 07-17 UTC).
-- followUpDelayDays:  days to wait before sending first follow-up (replaces hard-coded 3)
-- followUpMaxSteps:   maximum follow-up messages per lead (replaces hard-coded 2)
-- timezone:          IANA timezone string used to resolve sendWindowStart/End for the recipient

ALTER TABLE "Campaign"
  ADD COLUMN "sendWindowStart"   INTEGER,
  ADD COLUMN "sendWindowEnd"     INTEGER,
  ADD COLUMN "sendWindowDays"    INTEGER[],
  ADD COLUMN "timezone"          TEXT,
  ADD COLUMN "followUpDelayDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "followUpMaxSteps"  INTEGER NOT NULL DEFAULT 2;

-- Validate ranges at the DB level so bad values never reach the application
ALTER TABLE "Campaign"
  ADD CONSTRAINT "campaign_send_window_start_range"
    CHECK ("sendWindowStart" IS NULL OR ("sendWindowStart" >= 0 AND "sendWindowStart" <= 23)),
  ADD CONSTRAINT "campaign_send_window_end_range"
    CHECK ("sendWindowEnd" IS NULL OR ("sendWindowEnd" >= 0 AND "sendWindowEnd" <= 23)),
  ADD CONSTRAINT "campaign_follow_up_delay_positive"
    CHECK ("followUpDelayDays" >= 1),
  ADD CONSTRAINT "campaign_follow_up_max_steps_range"
    CHECK ("followUpMaxSteps" >= 1 AND "followUpMaxSteps" <= 10);
