# RUNBOOK — Riattivazione billing post-beta (`BILLING_ENABLED`)

> Scritto il 2026-07-07, **prima** del lancio della beta gratuita, come prerequisito del flip di ritorno.
> Decisioni approvate: piano beta 50 msg/g + 300 contatti · `subscription_plan` nel payload = piano EFFETTIVO (+ `raw_plan`) · riaccensione = **strategia (a)** grandfather via backfill `trial_ends_at` staggered.
> **Non riaccendere il billing senza eseguire questo runbook passo-passo.** Il flip "nudo" (togliere la env e basta) produce: downgrade di massa + raffica WhatsApp "trial scaduto — €4,99" a tutta la coorte, starvation della coda cron, messaggi pausati per sempre.

## 0. Contratto del flag

- **Beta ON**: `BILLING_ENABLED=false` su Vercel + redeploy. Qualsiasi altro valore (o env assente) = billing attivo (idioma opt-out, come `MONITORING_ALERTS_ENABLED`).
- **Riattivazione**: **rimuovere** `BILLING_ENABLED` (e `BETA_END_DATE`) da Vercel + redeploy production.
- Durante la beta il DB **non muta mai** per il billing: i piani raw restano `trial`/`free` (il piano sintetico `beta` esiste solo a runtime; il CHECK constraint su `subscription_plan` lo rigetta fisicamente). Il blocco cron di downgrade trial→free è gate-ato sul flag: al flip riprende da solo a lavorare sull'arretrato — è esattamente ciò che questo runbook incanala.

## 1. Perché esiste questo runbook (cosa succederebbe senza)

Rischi verificati sul codice il 2026-07-07 (review avversariale, evidence in `app/api/cron/send-messages/route.ts`, `app/api/payment/webhook/route.ts`, `app/lib/cron-utils.ts`):

1. **CRITICAL — loop downgrade unbounded**: il primo run del cron seleziona TUTTI i trial scaduti accumulati in mesi di beta, per ciascuno fa UPDATE + WhatsApp di upsell; la lambda (Hobby, 10s) muore a metà loop e il send loop non parte: messaggi fermi per tutti, per run interi.
2. **CRITICAL — head-of-line blocking**: i messaggi oltre-quota restano `pending` con lo stesso `scheduled_at` e rioccupano stabilmente la finestra `limit(25)` del cron ordinata per data: 2-3 ex-beta con backlog grosso affamano la consegna di tutti gli altri per settimane.
3. **HIGH — pause-trap**: i messaggi finiti `paused` con "Trial scaduto" non vengono mai più letti dal cron (che drena solo `pending`); l'unico unpause automatico è il checkout Stripe.
4. **HIGH — consegne stantie**: code costruite a ritmo beta (50/g, MAX_PENDING 350) drenate a 3/g free consegnano contenuti time-sensitive con giorni/settimane di ritardo ai clienti reali dell'utente.
5. **HIGH — unpause di massa al primo pagamento**: `checkout.session.completed` riattiva TUTTI i `paused` dell'utente senza filtro d'età.

## 2. Prerequisiti di codice — verificare PRIMA del flip

Introdotti nelle PR beta (luglio 2026). Verifica con i grep indicati (i numeri di riga driftano, i simboli no):

- [ ] **Bound + notifica soppressa sul loop downgrade** — la SELECT dei trial scaduti ha un `.limit(...)` e la notifica WhatsApp è dietro gate/one-shot: `grep -n "expired_trials\|limit(" app/api/cron/send-messages/route.ts | head`
- [ ] **Reschedule su daily-limit** — il ramo quota esaurita ri-schedula il messaggio (non lo lascia `pending` a occupare la finestra): `grep -n "rescheduleTomorrow\|quota" app/api/cron/send-messages/route.ts | head`
- [ ] **Unpause filtrato nel webhook Stripe** — l'UPDATE `paused→pending` su checkout filtra per `error_message LIKE 'Trial scaduto%'` e per recency: `grep -n "paused" app/api/payment/webhook/route.ts`
- [ ] **Clamp ricorrenze** — `reconcileRecurringChain`/`nextOccurrence` non genera occorrenze nel passato (fast-forward a now): `grep -n "nextOccurrence" app/lib/recurrence.ts app/api/cron/send-messages/route.ts`
- [ ] **historyDays non nasconde gli in-flight** — il filtro storico di GET /api/messages si applica solo agli stati terminali: `grep -n "historyStart" app/api/messages/route.ts`
- [ ] **Test verdi**: `npm test` (in particolare `billing.test.ts`, `cron-utils.test.ts`, `plans.test.ts`).

Se una casella non è spuntabile, **fermarsi**: implementare prima, flippare poi.

## 3. T-14 giorni — preavviso alla coorte

1. Settare su Vercel `BETA_END_DATE=YYYY-MM-DD` + redeploy → la dashboard mostra il banner "La beta gratuita termina il …" (implementato in PR-4; nessun deploy di codice necessario).
2. **Niente WhatsApp broadcast di preavviso** (principio silenzioso; il banner in-app è l'eccezione billing/lifecycle prevista). Eventuale eccezione: solo su decisione esplicita di Andrea.
3. Aggiornare ToS se il pricing al rientro differisce da quello pubblicato.

## 4. T-1 giorno — censimento (SQL read-only su Supabase)

```sql
-- 4.1 Distribuzione piani e trial
SELECT subscription_plan, count(*), min(trial_ends_at), max(trial_ends_at),
       count(*) FILTER (WHERE trial_ends_at IS NULL) AS null_trials
FROM user_instances GROUP BY 1;

-- 4.2 Chi è stato flippato a 'free' da eventi Stripe sandbox durante la beta
SELECT event_type, count(*) FROM audit_events
WHERE event_type = 'tier_changed' AND created_at > '<DATA_INIZIO_BETA>' GROUP BY 1;

-- 4.3 Code oltre il futuro MAX_PENDING free/trial (21 / 140)
SELECT instance_phone, count(*) AS pending FROM scheduled_messages
WHERE status = 'pending' GROUP BY 1 HAVING count(*) > 140 ORDER BY 2 DESC;

-- 4.4 Utenti sopra il cap contatti trial (50 attivi / 90gg) — dal codice: finestra contact-window.ts
SELECT instance_phone, count(DISTINCT recipient_number) AS attivi FROM scheduled_messages
WHERE status NOT IN ('cancelled')
  AND (status NOT IN ('sent','failed') OR COALESCE(sent_at, scheduled_at) > now() - interval '90 days')
GROUP BY 1 HAVING count(DISTINCT recipient_number) > 50 ORDER BY 2 DESC;

-- 4.5 Messaggi paused residui
SELECT count(*), min(scheduled_at) FROM scheduled_messages
WHERE status='paused' AND error_message LIKE 'Trial scaduto%';
```

Annotare i numeri nel log di sessione. Se 4.3/4.4 restituiscono utenti "pesanti", contattarli individualmente prima del flip (sono i candidati Personal/Business).

## 5. T-0 (03:00 Europe/Rome) — sequenza del flip

**Ordine tassativo: prima il DB, poi la env.** Così nessun utente attraversa lo stato "billing ON + trial scaduto da mesi".

```sql
-- 5.1 GRANDFATHER (strategia a): trial fresco 30gg, staggered su 2 settimane,
-- a TUTTA la coorte beta non pagante (trial scaduti/null E free non paganti).
UPDATE user_instances
SET subscription_plan = 'trial',
    trial_ends_at = now() + interval '30 days' + (floor(random()*14))::int * interval '1 day'
WHERE subscription_plan IN ('trial','free')
  AND (trial_ends_at IS NULL OR trial_ends_at < now())
  AND stripe_customer_id IS NULL;         -- mai toccare chi ha una storia di pagamento
-- Chi ha stripe_customer_id ma piano 'free' (cancellati sandbox in beta): valutare
-- caso per caso col censimento 4.2 — di norma stessi 30gg via UPDATE mirato per phone.

-- 5.2 Sblocco paused 'Trial scaduto' (difensivo — il grosso è già stato sanato al lancio beta):
--   recenti → pending; stantii (programmati da >48h) → cancelled, MAI consegnati in ritardo.
UPDATE scheduled_messages
SET status='cancelled', error_message='Scaduto durante la beta — non inviato (runbook §5.2)'
WHERE status='paused' AND error_message LIKE 'Trial scaduto%' AND scheduled_at < now() - interval '48 hours';

UPDATE scheduled_messages
SET status='pending', error_message=NULL, send_attempted_at=NULL
WHERE status='paused' AND error_message LIKE 'Trial scaduto%';
```

3. **Vercel**: rimuovere `BILLING_ENABLED` e `BETA_END_DATE` → redeploy production → verificare su un utente di test che `GET /api/messages` risponda col piano raw (non più `beta`).
4. **Monitoraggio primi 60 minuti**: log del cron (`vercel logs` / Sentry), `audit_events` (nessuna ondata `instance_disconnect`), Torre di controllo, e:
   ```sql
   SELECT count(*) FROM user_instances WHERE subscription_plan='trial' AND trial_ends_at < now(); -- deve tendere a 0 e restarci
   SELECT count(*) FROM scheduled_messages WHERE status='paused' AND error_message LIKE 'Trial scaduto%'; -- deve restare 0
   ```

## 6. T+0 … T+45 giorni — l'onda di downgrade

- I trial regalati scadono **scaglionati** tra il giorno 30 e il 44: il downgrade cron (bounded, notifica moderata) lavora poche unità al giorno — niente stampede by design.
- Il TrialBanner mostra il countdown 30gg in variante dismissible: è il preavviso naturale.
- **Upsell 80%**: su free la soglia è 2 msg/giorno → ping quotidiano percepito come spam sugli ex-beta. Tenere l'upsell gate-ato per la coorte (o cooldown settimanale) per i primi 30gg post-downgrade — decisione da prendere a T+25 guardando i numeri.
- **Metriche distorte note**: `churned_trials` del daily-report non vede il churn del flip (trial_ends_at retrodatati/spostati); MRR include residui sandbox. Annotare la data del flip come discontinuità.

## 7. Rollback

In qualsiasi momento: ri-settare `BILLING_ENABLED=false` + redeploy → si torna in modalità beta (idempotente, i dati non sono stati distrutti). Il grandfather 5.1 resta innocuo sotto beta (i limiti tornano quelli del piano sintetico). Non serve annullare gli UPDATE.

## Appendice A — Ops di lancio beta (T-beta, promemoria)

Eseguite al lancio, stesso ordine: (1) backfill paused 'Trial scaduto%' → pending (stessa coppia di query di §5.2 — è il backlog #4 di CLAUDE.md); (2) cancellare da Stripe sandbox le subscription residue dei customer esistenti (censimento: `SELECT phone_number FROM user_instances WHERE stripe_customer_id IS NOT NULL`); (3) settare `BILLING_ENABLED=false` su Vercel + redeploy; (4) smoke test: nuovo messaggio da utente free → parte entro il minuto, contatore dashboard "limite 50", niente PricingSection.
