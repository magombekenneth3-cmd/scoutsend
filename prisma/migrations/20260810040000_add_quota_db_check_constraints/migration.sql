-- PostgreSQL Check Constraints for Quota & Ledger Invariants

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_sender_mailbox_current_sent_positive'
  ) THEN
    ALTER TABLE "SenderMailbox" ADD CONSTRAINT "check_sender_mailbox_current_sent_positive" CHECK ("currentSent" >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_campaign_daily_send_limit_positive'
  ) THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "check_campaign_daily_send_limit_positive" CHECK ("dailySendLimit" >= 0);
  END IF;
END $$;
