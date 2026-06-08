-- LEVEL 2 control tower v3 — adds pairing_started_24h / pairing_completed_24h
-- so /api/ops/stress-index and runAllChecks can compute pairing_success_rate
-- and the pairing_blackout 24h check. Prevents recidive of the IPv6 droplet
-- blackout (May 2026: ~30 days with zero successful pairings, undetected).
--
-- CREATE OR REPLACE preserves existing ACLs (the prior REVOKE on PUBLIC/anon/
-- authenticated stays applied). REVOKE+GRANT are re-declared anyway as defense
-- in depth in case a future migration ever DROPs and recreates this function.

CREATE OR REPLACE FUNCTION public.ops_stress_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'instances_total',         (SELECT count(*) FROM public.user_instances),
    'instances_open',          (SELECT count(*) FROM public.user_instances WHERE connection_status = 'open'),
    'instances_close',         (SELECT count(*) FROM public.user_instances WHERE connection_status = 'close'),
    'instances_refused',       (SELECT count(*) FROM public.user_instances WHERE connection_status = 'refused'),
    'disconnects_1h',          (SELECT count(*) FROM public.audit_events WHERE event_type='instance_disconnect' AND created_at > now() - interval '1 hour'),
    'disconnects_2h',          (SELECT count(*) FROM public.audit_events WHERE event_type='instance_disconnect' AND created_at > now() - interval '2 hours'),
    'worst_flapping',          (SELECT to_jsonb(t) FROM (
                                  SELECT payload->>'instance' AS instance, count(*)::int AS count, max(payload->>'code') AS sample_code
                                  FROM public.audit_events
                                  WHERE event_type='instance_disconnect' AND created_at > now() - interval '1 hour'
                                  GROUP BY payload->>'instance' ORDER BY count(*) DESC LIMIT 1
                                ) t),
    'pending_overdue',         (SELECT count(*) FROM public.scheduled_messages WHERE status='pending' AND scheduled_at < now()),
    'pending_total',           (SELECT count(*) FROM public.scheduled_messages WHERE status='pending'),
    'monitor_fresh_sec',       (SELECT round(extract(epoch FROM (now()-max(checked_at))))::int FROM public.monitoring_checks),
    'cron_heartbeat_sec',      (SELECT round(extract(epoch FROM (now()-ts)))::int FROM public.ops_heartbeat WHERE name='send-messages'),
    'avg_drift_ms',            (SELECT round(avg((payload->>'drift_ms')::numeric))::int FROM public.audit_events WHERE event_type='message_sent' AND created_at > now() - interval '24 hours' AND payload ? 'drift_ms'),
    'open_instances',          (SELECT coalesce(jsonb_agg(jsonb_build_object('plan', subscription_plan, 'sent', coalesce(messages_sent_today,0))), '[]'::jsonb) FROM public.user_instances WHERE connection_status='open'),
    'pairing_started_24h',     (SELECT count(*) FROM public.audit_events WHERE event_type='pairing_started'   AND created_at > now() - interval '24 hours'),
    'pairing_completed_24h',   (SELECT count(*) FROM public.audit_events WHERE event_type='pairing_completed' AND created_at > now() - interval '24 hours')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.ops_stress_snapshot() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.ops_stress_snapshot() TO service_role;
