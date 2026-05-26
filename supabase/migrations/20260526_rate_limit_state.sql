-- Migration: rate_limit_state
-- Persistent rate limiting backed by Postgres. Replaces the in-memory Map in
-- app/api/cron/send-messages/route.ts which silently broke across serverless
-- lambda boundaries (counters reset on every fresh invocation, so per-day
-- limits and SPAM_THRESHOLD auto-block were effectively no-ops in prod).
--
-- Two RPC functions provide atomic single-roundtrip updates with CASE-based
-- window reset, eliminating read-modify-write races on concurrent calls.
-- Date: 2026-05-26

create table if not exists public.rate_limit_state (
  key text primary key,
  minute_count int not null default 0,
  minute_reset bigint not null,
  daily_count int not null default 0,
  daily_reset bigint not null,
  blocked boolean not null default false,
  block_reason text,
  updated_at timestamptz not null default now()
);

create index if not exists rate_limit_state_blocked_idx
  on public.rate_limit_state(blocked) where blocked = true;

-- Atomic increment with auto-reset. Single roundtrip, no race window.
-- On INSERT (first call for the key) starts at count=1.
-- On UPDATE (subsequent calls), if the window has expired (now >= reset),
-- resets count to 1 and shifts the window; otherwise increments.
-- The blocked/block_reason fields auto-clear when the daily window rolls over.
create or replace function public.rate_limit_record(
  p_key text,
  p_now bigint,
  p_minute_reset bigint,
  p_daily_reset bigint
) returns public.rate_limit_state
language plpgsql
as $$
declare
  result public.rate_limit_state;
begin
  insert into public.rate_limit_state (key, minute_count, minute_reset, daily_count, daily_reset, updated_at)
  values (p_key, 1, p_minute_reset, 1, p_daily_reset, now())
  on conflict (key) do update set
    minute_count = case when p_now >= rate_limit_state.minute_reset then 1 else rate_limit_state.minute_count + 1 end,
    minute_reset = case when p_now >= rate_limit_state.minute_reset then p_minute_reset else rate_limit_state.minute_reset end,
    daily_count  = case when p_now >= rate_limit_state.daily_reset  then 1 else rate_limit_state.daily_count + 1 end,
    daily_reset  = case when p_now >= rate_limit_state.daily_reset  then p_daily_reset  else rate_limit_state.daily_reset end,
    blocked      = case when p_now >= rate_limit_state.daily_reset  then false else rate_limit_state.blocked end,
    block_reason = case when p_now >= rate_limit_state.daily_reset  then null  else rate_limit_state.block_reason end,
    updated_at   = now()
  returning * into result;

  return result;
end;
$$;

-- Mark a key as blocked (used when failure-rate threshold exceeded).
-- Upserts so it works even if the key has never sent a message.
create or replace function public.rate_limit_mark_blocked(
  p_key text,
  p_reason text
) returns void
language plpgsql
as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  insert into public.rate_limit_state (key, minute_reset, daily_reset, blocked, block_reason, updated_at)
  values (p_key, now_ms + 60000, now_ms + 86400000, true, p_reason, now())
  on conflict (key) do update set
    blocked = true,
    block_reason = p_reason,
    updated_at = now();
end;
$$;
