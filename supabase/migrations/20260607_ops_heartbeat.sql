-- LEVEL 2: per-tick heartbeat from the send-messages cron so /api/ops/stress-index
-- can detect a stalled send-cron (>3min) directly, instead of misusing the slower
-- monitor cadence. Plus ops_stress_snapshot v2 exposing cron_heartbeat_sec.
CREATE TABLE IF NOT EXISTS public.ops_heartbeat (
  name text PRIMARY KEY,
  ts timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ops_heartbeat ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.ops_stress_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'instances_total',   (SELECT count(*) FROM public.user_instances),
    'instances_open',    (SELECT count(*) FROM public.user_instances WHERE connection_status = 'open'),
    'instances_close',   (SELECT count(*) FROM public.user_instances WHERE connection_status = 'close'),
    'instances_refused', (SELECT count(*) FROM public.user_instances WHERE connection_status = 'refused'),
    'disconnects_1h',    (SELECT count(*) FROM public.audit_events WHERE event_type='instance_disconnect' AND created_at > now() - interval '1 hour'),
    'disconnects_2h',    (SELECT count(*) FROM public.audit_events WHERE event_type='instance_disconnect' AND created_at > now() - interval '2 hours'),
    'worst_flapping',    (SELECT to_jsonb(t) FROM (
                            SELECT payload->>'instance' AS instance, count(*)::int AS count, max(payload->>'code') AS sample_code
                            FROM public.audit_events
                            WHERE event_type='instance_disconnect' AND created_at > now() - interval '1 hour'
                            GROUP BY payload->>'instance' ORDER BY count(*) DESC LIMIT 1
                          ) t),
    'pending_overdue',   (SELECT count(*) FROM public.scheduled_messages WHERE status='pending' AND scheduled_at < now()),
    'pending_total',     (SELECT count(*) FROM public.scheduled_messages WHERE status='pending'),
    'monitor_fresh_sec', (SELECT round(extract(epoch FROM (now()-max(checked_at))))::int FROM public.monitoring_checks),
    'cron_heartbeat_sec',(SELECT round(extract(epoch FROM (now()-ts)))::int FROM public.ops_heartbeat WHERE name='send-messages'),
    'avg_drift_ms',      (SELECT round(avg((payload->>'drift_ms')::numeric))::int FROM public.audit_events WHERE event_type='message_sent' AND created_at > now() - interval '24 hours' AND payload ? 'drift_ms'),
    'open_instances',    (SELECT coalesce(jsonb_agg(jsonb_build_object('plan', subscription_plan, 'sent', coalesce(messages_sent_today,0))), '[]'::jsonb) FROM public.user_instances WHERE connection_status='open')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.ops_stress_snapshot() FROM PUBLIC, anon, authenticated;
