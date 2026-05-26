-- Migration: recurring_messages
-- Adds RRULE-based recurrence to scheduled_messages. Pattern: cron processes
-- a recurring row normally (status pending -> sent), then INSERTs a NEW row
-- with scheduled_at = nextOccurrence(rule, current.scheduled_at) and the
-- same parent_recurrence_id. Only one "live" pending row per recurrence
-- group exists at any time; past sent/cancelled rows remain as history.
--
-- RRULE subset supported (RFC 5545):
--   FREQ=DAILY
--   FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU (one or more)
--   FREQ=MONTHLY;BYMONTHDAY=N (1-31; months without day N are skipped)
-- Date: 2026-05-26

alter table public.scheduled_messages
  add column if not exists recurrence_rule text null,
  add column if not exists parent_recurrence_id uuid null
    references public.scheduled_messages(id) on delete set null;

-- Quickly locate all rows in a recurrence group (for "cancel all future" UX).
create index if not exists idx_scheduled_messages_recurrence_parent
  on public.scheduled_messages(parent_recurrence_id)
  where parent_recurrence_id is not null;

-- For cron to find pending recurring rows efficiently.
create index if not exists idx_scheduled_messages_recurrence_rule
  on public.scheduled_messages(recurrence_rule)
  where recurrence_rule is not null and status = 'pending';
