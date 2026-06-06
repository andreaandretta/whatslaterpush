-- Fix #1: real daily-quota reset guard + atomic claim/refund.
-- Applied to prod 2026-06-07 via Supabase MCP; this file backfills the repo
-- (source of truth is supabase/migrations/) so the schema is reproducible.

-- Per-row date guard: the cron resets messages_sent_today once per calendar day
-- (Europe/Rome), not on every 60s tick (that bug made tier limits "theatre").
ALTER TABLE public.user_instances
  ADD COLUMN IF NOT EXISTS last_daily_reset_at date;

-- Non-NULL baseline for existing rows so the date-guard reset matches them.
UPDATE public.user_instances
   SET last_daily_reset_at = (now() AT TIME ZONE 'Europe/Rome')::date
 WHERE last_daily_reset_at IS NULL;

-- Atomic quota claim: increment only if strictly under the tier limit; stamp the
-- reset date on the first claim of a fresh row. Returns the new count, or NULL
-- when at/over the limit (caller skips the send) -> closes the overshoot race.
CREATE OR REPLACE FUNCTION public.claim_daily_quota(p_phone text, p_limit integer)
RETURNS integer
LANGUAGE sql
AS $$
  UPDATE public.user_instances
     SET messages_sent_today = messages_sent_today + 1,
         last_daily_reset_at = COALESCE(last_daily_reset_at, (now() AT TIME ZONE 'Europe/Rome')::date)
   WHERE phone_number = p_phone
     AND messages_sent_today < p_limit
  RETURNING messages_sent_today;
$$;

-- Refund a claimed slot (floored at 0) when a send attempt fails, so retries
-- do not double-count and terminal failures do not consume quota.
CREATE OR REPLACE FUNCTION public.refund_daily_quota(p_phone text)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.user_instances
     SET messages_sent_today = GREATEST(0, messages_sent_today - 1)
   WHERE phone_number = p_phone;
$$;

-- Only the service role (cron) calls these; never anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.claim_daily_quota(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_daily_quota(text) FROM PUBLIC, anon, authenticated;
