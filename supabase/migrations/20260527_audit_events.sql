-- Migration: audit_events
-- Structured audit trail for security/compliance/debug. Append-only table
-- with two filtered indexes (per-user lookup + per-event-type lookup).
-- Date: 2026-05-27
--
-- PII policy enforced in app/lib/audit.ts:
--   - never log message body in cleartext
--   - never log contact_number in cleartext (use SHA-256 8-char hash for dedup)
--   - never log full JWT/cookie
--   - IP + user_agent OK (legitimate audit evidence)

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_phone text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_events_user_phone_time
  on public.audit_events(user_phone, created_at desc)
  where user_phone is not null;

create index if not exists idx_audit_events_event_type_time
  on public.audit_events(event_type, created_at desc);

alter table public.audit_events enable row level security;
