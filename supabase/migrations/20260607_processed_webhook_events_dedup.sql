-- Fix #3: atomic cross-lambda webhook dedup ledger. INSERT ... ON CONFLICT
-- DO NOTHING replaces the non-atomic SELECT-then-insert and the per-process
-- in-memory Map (useless across serverless instances). Rows older than 7 days
-- are pruned by the cleanup-webhook-logs cron.
CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  message_key text PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pwe_ts ON public.processed_webhook_events(ts);
-- Deny anon/authenticated; webhook + cron use the service role (RLS bypass).
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;
