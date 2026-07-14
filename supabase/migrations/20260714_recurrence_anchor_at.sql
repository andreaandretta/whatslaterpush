-- Migration: 20260714_recurrence_anchor_at
-- BUG #2 fix: recurring chains drift toward midnight because the reconciliation
-- sweep seeds nextOccurrence() from the (operationally-mutated) scheduled_at —
-- a daily-limit / cool-down / disconnect reschedule pushes scheduled_at toward
-- 00:15, and from there every future occurrence inherits that time-of-day.
--
-- Fix: an immutable anchor holding the user's ORIGINAL intended instant
-- (pre-jitter). The cron re-derives the next occurrence's Rome time-of-day from
-- it (app/lib/recurrence.ts atAnchorTimeOfDay / reconcileRecurringChain), never
-- from the mutated scheduled_at. NULL for one-shot rows (legacy behavior).
-- Idempotent: ADD COLUMN IF NOT EXISTS + IS NULL-guarded backfill.

ALTER TABLE public.scheduled_messages
  ADD COLUMN IF NOT EXISTS recurrence_anchor_at timestamptz NULL;

COMMENT ON COLUMN public.scheduled_messages.recurrence_anchor_at IS
  'BUG#2: original user-intended instant of a recurring chain (pre-jitter). TIME-OF-DAY ONLY: the reconciliation derives the next occurrence''s Rome time-of-day from it, never a delivery instant. NULL for one-shot rows.';

-- Backfill any recurring chains that predate the column. Anchor = the oldest
-- (by created_at) row's scheduled_at per chain — the ROOT, inserted at the user's
-- real time-of-day. If that root already looks midnight-drifted (Rome hour 00,
-- minute < 36) we cannot recover the real time, so we leave the anchor NULL and
-- the chain keeps legacy behavior (no worse than today) rather than guessing.
-- Guarded by IS NULL so re-runs are a no-op.  (Census 2026-07-14: zero recurring
-- chains in prod, so this is a no-op today — kept for correctness/robustness.)
WITH roots AS (
  SELECT DISTINCT ON (COALESCE(parent_recurrence_id, id))
    COALESCE(parent_recurrence_id, id) AS grp,
    scheduled_at                        AS anchor_at
  FROM public.scheduled_messages
  WHERE recurrence_rule IS NOT NULL
  ORDER BY COALESCE(parent_recurrence_id, id), created_at ASC
)
UPDATE public.scheduled_messages m
SET recurrence_anchor_at = r.anchor_at
FROM roots r
WHERE COALESCE(m.parent_recurrence_id, m.id) = r.grp
  AND m.recurrence_rule IS NOT NULL
  AND m.recurrence_anchor_at IS NULL
  AND NOT (
    EXTRACT(hour   FROM (r.anchor_at AT TIME ZONE 'Europe/Rome')) = 0
    AND EXTRACT(minute FROM (r.anchor_at AT TIME ZONE 'Europe/Rome')) < 36
  );
