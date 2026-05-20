-- Migration: add_professional_plan
-- Adds 'professional' to the user_instances.subscription_plan CHECK constraint.
-- Without this, Stripe webhook UPDATEs after a Professional checkout silently
-- fail at the DB level: the constraint rejects the value, the row stays on
-- the previous plan, and the user pays without being upgraded.
--
-- Apply via Supabase SQL Editor BEFORE merging the app-side FIX 4 commit.
-- Date: 2026-05-20

ALTER TABLE user_instances DROP CONSTRAINT IF EXISTS user_instances_subscription_plan_check;
ALTER TABLE user_instances ADD CONSTRAINT user_instances_subscription_plan_check
  CHECK (subscription_plan IN ('trial', 'free', 'personal', 'professional', 'business'));
