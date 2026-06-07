-- Admin "Torre di Controllo" Section 1 data: one row per WhatsApp instance with
-- its plan/connection/quota state plus live queue depth (pending) and 24h
-- throughput (sent_24h). Server-side aggregation in one round-trip so the admin
-- endpoint never has to fetch+count thousands of scheduled_messages rows in JS.
-- STABLE + read-only. Called only by the service-role client inside
-- /api/admin/tower (itself gated by requireAdmin); EXECUTE is revoked from
-- anon/authenticated/public so a leaked anon key cannot read user PII through it.
create or replace function public.admin_tower_users()
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  from (
    select
      ui.phone_number,
      ui.display_name,
      ui.subscription_plan,
      ui.connection_status,
      ui.messages_sent_today,
      ui.trial_ends_at,
      ui.last_disconnect_code,
      ui.last_disconnect_at,
      coalesce(p.pending, 0)  as pending,
      coalesce(s.sent_24h, 0) as sent_24h
    from public.user_instances ui
    left join (
      select instance_phone, count(*)::int as pending
      from public.scheduled_messages
      where status = 'pending'
      group by instance_phone
    ) p on p.instance_phone = ui.phone_number
    left join (
      select instance_phone, count(*)::int as sent_24h
      from public.scheduled_messages
      where status = 'sent' and sent_at > now() - interval '24 hours'
      group by instance_phone
    ) s on s.instance_phone = ui.phone_number
    order by
      case ui.connection_status when 'open' then 0 when 'connecting' then 1 else 2 end,
      ui.messages_sent_today desc nulls last,
      ui.phone_number
  ) t;
$$;

revoke execute on function public.admin_tower_users() from public;
revoke execute on function public.admin_tower_users() from anon;
revoke execute on function public.admin_tower_users() from authenticated;
