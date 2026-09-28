-- Reset giornaliero quote BASATO SULLA DATA (audit 28 set 2026).
-- DA APPLICARE SOLO CON L'OK DI ANDREA. Non ancora applicata a prod.
--
-- Bug: reset_daily_counters (20260707) toccava solo le righe con
-- messages_sent_today > 0 (o upsell inviato). Dopo un giorno SENZA invii la
-- data last_daily_reset_at restava a ieri l'altro, e claim_daily_quota la
-- timbra solo se NULL (COALESCE). Il giorno dopo i primi claim portavano il
-- contatore sopra 0 con la data ancora vecchia → il tick successivo del cron
-- (il reset gira a OGNI tick) lo riazzerava a metà giornata. Cap giornaliero e
-- rampa warm-up valevano il doppio ogni giorno che segue un giorno fermo (il
-- caso normale per chi manda pochi promemoria). Prod al 28 set: tutte le date
-- non nulle erano più vecchie di oggi, con contatore 0.
--
-- Fix, due livelli:
--  1. reset_daily_counters fa avanzare la data di OGNI riga vecchia, anche con
--     0 invii (azzerare uno 0 non cambia niente, ma la data diventa di oggi).
--  2. claim_daily_quota è consapevole della data: se la riga è di un giorno
--     precedente il claim riparte da 1 e timbra oggi, senza dipendere dal
--     reset. Così nemmeno un reset in ritardo o in corsa con un claim può
--     "perdonare" gli invii di oggi.
-- Il cron (send-messages) ha già una guardia lato app equivalente al punto 1
-- (timbra oggi le righe con 0 invii): resta innocua anche dopo questa migration.

create or replace function public.reset_daily_counters()
returns integer
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.user_instances
       set messages_sent_today = 0,
           upsell_sent_today   = false,
           last_daily_reset_at = (now() at time zone 'Europe/Rome')::date
     where last_daily_reset_at is null
        or last_daily_reset_at < (now() at time zone 'Europe/Rome')::date
    returning 1
  )
  select coalesce(count(*), 0)::integer from updated;
$$;

revoke execute on function public.reset_daily_counters() from public;
revoke execute on function public.reset_daily_counters() from anon;
revoke execute on function public.reset_daily_counters() from authenticated;

-- Stessa firma e stesso contratto (nuovo conteggio, NULL = oltre il limite).
-- Riga di un giorno precedente: il contatore di ieri non conta, si parte da 1.
create or replace function public.claim_daily_quota(p_phone text, p_limit integer)
returns integer
language sql
as $$
  update public.user_instances
     set messages_sent_today = case
           when last_daily_reset_at is null
             or last_daily_reset_at < (now() at time zone 'Europe/Rome')::date
           then 1
           else messages_sent_today + 1
         end,
         upsell_sent_today = case
           when last_daily_reset_at is null
             or last_daily_reset_at < (now() at time zone 'Europe/Rome')::date
           then false
           else upsell_sent_today
         end,
         last_daily_reset_at = (now() at time zone 'Europe/Rome')::date
   where phone_number = p_phone
     and p_limit > 0
     and (
       last_daily_reset_at is null
       or last_daily_reset_at < (now() at time zone 'Europe/Rome')::date
       or messages_sent_today < p_limit
     )
  returning messages_sent_today;
$$;

revoke execute on function public.claim_daily_quota(text, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
