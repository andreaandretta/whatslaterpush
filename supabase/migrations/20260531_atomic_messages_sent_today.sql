-- Closes the read-modify-write race in /api/cron/send-messages where
-- Promise.allSettled batches of 5 concurrent sends for the same user
-- previously read identical messages_sent_today from a JOIN snapshot and
-- all wrote back the same value+1 -- losing N-1 increments per batch.
-- Symptom for ICP D: an allenatore scheduling 12 messages to 12 parents at
-- the same minute saw the tier-limit counter under-report by up to 4 per
-- cron cycle, so the user could blow past their plan quota silently.
--
-- UPDATE ... RETURNING is a single MVCC operation, so concurrent callers
-- observe post-increment values monotonically without external locks. The
-- RPC returns the new counter so the cron's downstream upsell check
-- (newSentToday === upsellThreshold) works without a separate SELECT.
--
-- Note: this does NOT fix the *limit-overshoot* race (the tier limit check
-- still reads a stale sentToday from the JOIN at line 248). Fixing that
-- requires increment-then-check-then-decrement and is a separate change.

CREATE OR REPLACE FUNCTION increment_messages_sent_today(p_phone TEXT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  result INT;
BEGIN
  UPDATE user_instances
  SET messages_sent_today = messages_sent_today + 1
  WHERE phone_number = p_phone
  RETURNING messages_sent_today INTO result;
  RETURN result;
END;
$$;
