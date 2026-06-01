-- Migration: enable Row Level Security on the 8 tables exposed to the public
-- anon key (Supabase advisor rls_disabled, level=critical). Server access uses
-- the service-role key (bypasses RLS); no browser anon client reads these.
-- Date: 2026-06-02

ALTER TABLE public.pending_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
