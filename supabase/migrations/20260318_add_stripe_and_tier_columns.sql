-- Migration: add_stripe_and_tier_columns
-- Run this in Supabase SQL Editor BEFORE deploying the new code
-- Date: 2026-03-18

-- 1. Add new columns to user_instances
ALTER TABLE user_instances
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS messages_sent_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upsell_sent_today boolean NOT NULL DEFAULT false;

-- 2. Drop old CHECK constraint on subscription_status
ALTER TABLE user_instances DROP CONSTRAINT IF EXISTS user_instances_subscription_status_check;

-- 3. Rename column subscription_status → subscription_plan
ALTER TABLE user_instances RENAME COLUMN subscription_status TO subscription_plan;

-- 4. Migrate existing values: 'active' → 'personal', 'expired' → 'free', 'cancelled' → 'free'
UPDATE user_instances SET subscription_plan = 'personal' WHERE subscription_plan = 'active';
UPDATE user_instances SET subscription_plan = 'free' WHERE subscription_plan IN ('expired', 'cancelled');

-- 5. Add new CHECK constraint with correct values
ALTER TABLE user_instances ADD CONSTRAINT user_instances_subscription_plan_check
  CHECK (subscription_plan IN ('trial', 'free', 'personal', 'business'));

-- 6. Add 'paused' to scheduled_messages status CHECK
ALTER TABLE scheduled_messages DROP CONSTRAINT IF EXISTS scheduled_messages_status_check;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'paused', 'awaiting_confirm', 'awaiting_time', 'awaiting_recipient'));
