-- FIX 4: Stripe webhook idempotency ledger.
--
-- stripe.webhooks.constructEvent verifies the signature (blocks forgeries) but
-- does NOT block replays of legitimately-signed events: Stripe itself retries on
-- non-2xx, and a captured signed payload can be re-POSTed. Without idempotency a
-- replayed event re-runs its side effects (duplicate audit rows; a replayed
-- subscription.deleted re-downgrades, etc.). The webhook now records each event.id
-- here and skips any it has already processed.
--
-- Same shape/RLS as processed_webhook_events. Prune old rows later if needed.
CREATE TABLE IF NOT EXISTS public.processed_stripe_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pse_processed_at ON public.processed_stripe_events(processed_at);
-- Deny anon/authenticated; the webhook uses the service role (RLS bypass).
ALTER TABLE public.processed_stripe_events ENABLE ROW LEVEL SECURITY;
