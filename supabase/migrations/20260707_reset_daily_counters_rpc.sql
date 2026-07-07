-- Fix DEFINITIVO del reset giornaliero quote (bug prod 2026-07-07).
--
-- Il reset via PATCH REST (send-messages, riga ~100) falliva con 400 AD OGNI
-- TICK dal giorno del deploy e l'errore veniva ignorato in silenzio: i
-- contatori messages_sent_today non si azzeravano MAI (i last_daily_reset_at
-- visti in tabella arrivavano solo dal COALESCE di claim_daily_quota, non dal
-- reset). Risultato: il cap giornaliero diventava un cap A VITA — ogni utente
-- Free si fermava per sempre dopo 3 messaggi totali ("in coda, mai inviato").
--
-- Qui il reset diventa una funzione SQL: le colonne sono risolte da Postgres
-- dentro il corpo (stesso pattern di claim_daily_quota, che ha sempre
-- funzionato), fuori dalla portata di qualunque stranezza dello strato REST.
-- La data è calcolata QUI in Europe/Rome: unica fonte di verità, DST-safe,
-- coerente con claim_daily_quota.

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
     where (last_daily_reset_at is null
            or last_daily_reset_at < (now() at time zone 'Europe/Rome')::date)
       and (messages_sent_today > 0 or upsell_sent_today)
    returning 1
  )
  select coalesce(count(*), 0)::integer from updated;
$$;

-- Solo service-role (cron) e owner: coerente con l'hardening 20260603.
revoke execute on function public.reset_daily_counters() from public;
revoke execute on function public.reset_daily_counters() from anon;
revoke execute on function public.reset_daily_counters() from authenticated;

-- Ricarica lo schema cache di PostgREST (la funzione deve essere visibile
-- subito come /rpc/, e chiude anche l'ipotesi cache-stantia sul PATCH).
notify pgrst, 'reload schema';
