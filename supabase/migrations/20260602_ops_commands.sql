-- Migration: ops_commands queue for control-tower mutations (Evolution/Coolify/DO).
-- A row is enqueued (status=pending) by the control tower; /api/cron/ops-worker
-- claims it atomically (pending -> processing) and executes the allowlisted
-- action, writing the outcome back (done/failed). Service-role only.
-- Date: 2026-06-02

CREATE TABLE IF NOT EXISTS public.ops_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command text NOT NULL,
  target text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  result jsonb,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ops_commands_status_created_idx
  ON public.ops_commands (status, created_at);

ALTER TABLE public.ops_commands ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service-role key (server + worker) touches
-- this table, and service-role bypasses RLS. Anon/authenticated get zero access.
