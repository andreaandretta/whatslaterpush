-- Migration: disconnect_retry_count
-- Smart-retry counter for messages whose owner instance is disconnected.
-- Replaces the previous "always reschedule to tomorrow" path with a
-- 12-attempt × 5min staircase (≈1h total retry window) before giving up
-- and deferring to next day with an explicit user notification.
-- Date: 2026-05-28

alter table public.scheduled_messages
  add column if not exists disconnect_retry_count int not null default 0;
