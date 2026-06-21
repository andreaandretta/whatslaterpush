-- FIX 3: recurrence chain-death + idempotent/race-safe occurrence creation.
--
-- Problem: a recurring chain could stall forever. The next occurrence was created
-- only inline on the happy-path (right after status='sent'). If the lambda died
-- between status='sent' (:502) and that INSERT (:535), or the row was recovered
-- by the stale-'processing' branch (which only looks at 'processing' rows), the
-- chain was left with no future 'pending' row and nobody to create one — silent
-- death, no error.
--
-- Fix: the cron now runs a RECONCILIATION sweep at the top of
-- /api/cron/send-messages that revives any chain with no live row whose latest
-- row ended sent/failed. This unique index makes the creation idempotent and
-- race-safe (the 3 concurrent cron triggers can all sweep at once).
--
-- Pre-checks (2026-06-21, prod inheoexhtuyjtfotbzyw):
--   * zero duplicate (parent_recurrence_id, scheduled_at) rows  -> index applies clean
--   * jitter is applied only at POST creation, never to recurrence scheduled_at
--     -> the dedup key is deterministic, so the index actually deduplicates.

-- Dedup key is the CHAIN IDENTITY + time, keyed identically to the RPC below:
-- COALESCE(parent_recurrence_id, id) (root rows group on their own id; children
-- group on the root's id). This is deliberately the same expression the RPC uses
-- to partition chains, so the "is this occurrence already created?" check and the
-- "which chain is this?" check can never diverge. Predicate covers ALL recurring
-- rows (root included). Non-recurring rows are excluded (recurrence_rule IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_recurrence_occurrence
  ON public.scheduled_messages ((COALESCE(parent_recurrence_id, id)), scheduled_at)
  WHERE recurrence_rule IS NOT NULL;

-- Returns the latest-row id of every recurring chain that (a) has NO live row and
-- (b) whose latest row ended sent/failed — i.e. chains whose next occurrence was
-- never created. The cron fetches these rows, computes the next occurrence in JS
-- (RRULE logic lives in app/lib/recurrence.ts — SQL can't evaluate it), and
-- inserts it idempotently against the unique index above.
--
-- grp = COALESCE(parent_recurrence_id, id) = the chain's root id (root rows have
-- parent_recurrence_id IS NULL and group on their own id; children group on the
-- root's id). 'cancelled' latest rows are intentionally excluded (user stopped
-- the chain). STABLE + service-role-only: the cron calls it via the service role.
CREATE OR REPLACE FUNCTION public.recurring_chains_needing_next()
RETURNS TABLE (latest_id uuid)
LANGUAGE sql
STABLE
AS $$
  WITH ranked AS (
    SELECT
      m.id,
      m.status,
      row_number() OVER (
        PARTITION BY COALESCE(m.parent_recurrence_id, m.id)
        ORDER BY m.scheduled_at DESC, m.id DESC
      ) AS rn,
      bool_or(
        m.status IN ('pending','processing','paused','awaiting_time','awaiting_recipient','awaiting_confirm')
      ) OVER (PARTITION BY COALESCE(m.parent_recurrence_id, m.id)) AS has_live
    FROM public.scheduled_messages m
    WHERE m.recurrence_rule IS NOT NULL
  )
  SELECT id
  FROM ranked
  WHERE rn = 1
    AND has_live = false
    AND status IN ('sent','failed');
$$;

-- Cron (service role) only; never anon/authenticated.
REVOKE EXECUTE ON FUNCTION public.recurring_chains_needing_next() FROM PUBLIC, anon, authenticated;
