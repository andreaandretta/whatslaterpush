-- Close security gap #1 (applied to prod via Supabase MCP 2026-06-03).
-- user_instances was readable AND writable by the public anon key: the policy
-- user_instances_service_all was FOR ALL TO public USING(true) WITH CHECK(true),
-- which defeated RLS and exposed phones / plans / stripe_customer_id and let anon
-- tamper with rows. Server access uses the service role (bypasses RLS), so dropping
-- this policy leaves RLS enabled with NO policy => deny-all to anon/authenticated;
-- the app is unaffected (the dashboard's connection-status realtime degrades to the
-- existing polling fallback).
DROP POLICY IF EXISTS user_instances_service_all ON public.user_instances;

-- Revoke EXECUTE on 4 SECURITY DEFINER functions that were callable by anon via
-- /rest/v1/rpc/. Verified none are invoked by the app (client or server); owner and
-- service_role retain EXECUTE.
REVOKE EXECUTE ON FUNCTION public.get_pending_messages_to_send() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_user_active(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_message_action(uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
