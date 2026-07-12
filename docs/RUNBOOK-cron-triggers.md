# RUNBOOK — Cron trigger stack di `/api/cron/send-messages`

> Scopo: elencare i trigger che invocano il cron d'invio, come ispezionarne la salute, e i comandi (da NON eseguire qui) per la riduzione della concorrenza.
> Progetto Supabase: `inheoexhtuyjtfotbzyw`.

## I 4 trigger

| # | Trigger | Cadenza | Auth | Stato (11-lug-2026) |
|---|---------|---------|------|---------------------|
| 0 | **pg_cron `send-messages-cron`** (Supabase, `net.http_get`) | `* * * * *` (1440/g) | `?secret=<CRON_SECRET>` in chiaro nel comando | **PRIMARIO REALE** — 84.806 run dal 13-mag-2026, **0 fallimenti** |
| 1 | cron-job.org pinger | @60s | `?secret=$CRON_SECRET` | **Inactive dal 12-giu-2026** (non più vivo) |
| 2 | `instrumentation.ts` self-cron | @60s | interno (Node runtime) | attivo, per-lambda-warm (×N istanze) |
| 3 | `vercel.json` daily | `0 0 * * *` | Vercel cron | safety-net / catch-all |

**Stack @60s vivo oggi = pg_cron (0) + self-cron (2).** L'atomic lock in
`app/api/cron/send-messages/route.ts` (`UPDATE ... WHERE status='pending'`)
impedisce il doppio invio, ma ogni fire ri-esegue tutto il preamble (reset RPC
quote, scan full-table ricorrenze, cleanup) → carico preamble moltiplicato.

## Ispezione salute (SQL, read-only)

```sql
-- Elenco job pg_cron
select jobid, schedule, jobname, active from cron.job;

-- Salute del job (sostituisci <jobid>, oggi = 3)
select
  count(*) total,
  count(*) filter (where status = 'failed') failed,
  max(start_time) last_run
from cron.job_run_details
where jobid = <jobid>;

-- Ultime 24h (per il gate di Task 43-bis)
select
  count(*) runs,
  count(*) filter (where status = 'failed') failed,
  min(start_time), max(start_time)
from cron.job_run_details
where jobid = 3 and start_time > now() - interval '24 hours';
```
Atteso in salute: `runs ≈ 1440`, `failed = 0`.

Verifica lato app: gaps in `audit_events` WHERE `event_type='message_sent'`
segnalano un trigger giù.

## Modifica / spegnimento (Task 43-bis — NON eseguire qui)

> ⚠️ **NON spegnere nulla finché Task 44 (rotazione `CRON_SECRET` su tutti i
> trigger) non è completata E verificata 24h** (`failed = 0` nelle ultime 24h).
> L'ordine imposto evita un blackout invii se la rotazione va storta.

```sql
-- Spegnere il pg_cron (solo dopo Task 44 verificata):
--   select cron.unschedule('send-messages-cron');

-- Riaccendere:
--   select cron.schedule(
--     'send-messages-cron',
--     '* * * * *',
--     $$ select net.http_get('https://<host>/api/cron/send-messages?secret=<CRON_SECRET>') $$
--   );
```
Il gate del self-cron (layer 2) avviene lato codice in `instrumentation.ts`
(avvolgere il blocco `setInterval` in un flag riattivabile) — anch'esso in Task 43-bis.
