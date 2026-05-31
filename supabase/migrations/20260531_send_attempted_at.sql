-- Adds send_attempted_at to differentiate "lambda died before fetch"
-- (safe to retry) from "lambda died during/after fetch" (Evolution
-- probably delivered, retry would duplicate) in the stale-processing
-- cleanup at /api/cron/send-messages.
--
-- Before this change, every 'processing' row older than 2 min was reset
-- to 'pending' for retry — but if Evolution had already received the
-- POST when the lambda died, that retry sent a duplicate to the user's
-- contact. For ICP D coaches a duplicate is worse than a missed message
-- (duplicate = looks like spam to the parent group, missed = user
-- reschedules), so the new cleanup picks the no-duplicate side.
--
-- After this change:
--   send_attempted_at IS NULL    → lambda died before the fetch call
--                                   (e.g. during jitter/typing/media
--                                   signing). Safe to retry → 'pending'.
--   send_attempted_at IS NOT NULL → fetch was in flight. Mark 'sent'
--                                   with error_message flag so operator
--                                   can verify the WhatsApp ✓✓ if the
--                                   message was business-critical.
--
-- Legacy rows from before this migration have send_attempted_at = NULL,
-- so they fall into the safe-retry branch — equivalent to old behavior.

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS send_attempted_at TIMESTAMPTZ;
