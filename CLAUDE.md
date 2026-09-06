# WhatsLater (SchedWhats) — Project Context

> **Come è organizzato questo file** (riordinato il 26 ago 2026): qui restano solo le
> regole e i fatti che servono SEMPRE. La cronaca delle sessioni passate vive in
> `docs/storia/` e va letta solo quando serve — vedi l'indice in fondo. Nulla è stato
> cancellato: solo spostato.

## Stato attuale — 26 agosto 2026

**Beta gratuita attiva** (`BILLING_ENABLED=false`), 4 utenti reali + 2 numeri di test
ricollegati il 23 ago (incluso il primo numero FISSO del prodotto, 081…5377).
`main` @ `968c5f8`. Suite: ~1.100 test verdi, 14 rossi pre-esistenti e noti
(3 suite integration flaky — vedi `plan.md` backlog #1).

**Ultime feature in produzione**: variabili `{nome}` risolte all'invio · redesign
modale con chip data rapide e CTA che ripete l'orario in parole · snooze one-tap
(+1h / stasera / domani) · **Google Calendar sync ATTIVO** (evento con numero di
telefono → promemoria WhatsApp automatico; smoke test superato con conferma umana
il 24 ago) · pairing riparato (il codice a schermo si aggiorna da solo quando
Evolution lo rigenera, banner di stato, freno anti doppio-tap).

## Vincoli attivi (decisioni prese, NON riaprire senza motivo)

- **Stripe live mode SCARTATA** (17 mag): i primi 5 paganti passano da bonifico/PayPal
  manuale, per evitare il blocco KYC. Si riapre dopo 3-5 paganti reali.
- **Channels/Newsletter NON supportati**: Baileys li gestirebbe, Evolution API v2 non
  espone l'endpoint REST. Workaround ICP-D: usare i gruppi `@g.us`. Rivalutare con
  Evolution v3 o un fork custom.
- **`MESSAGING_HISTORY_SET` non emesso da Evolution** → il nome della rubrica utente
  non è accessibile (DA-RIVEDERE).
- **Cluster D Make.com** rimandato: dipende da un sistema di API key che non esiste.
- **Mai cold WhatsApp** verso numeri mai contattati: è il trigger di ban n.1
  documentato (radar 25 ago). Vale per il prodotto e per il marketing.
- **Riattivazione billing SOLO via runbook** `docs/RUNBOOK-riattivazione-billing.md`,
  mai col flip nudo della env.

## Cosa c'è in lista (non ancora fatto)

**Intel che guida le priorità**: WhatsApp sta costruendo lo scheduling nativo
(avvistato nelle beta iOS, non ancora attivo nemmeno per i beta tester → orizzonte
trimestri). Limiti del nativo: minimo 10 minuti, **massimo 2 settimane**, **zero
ricorrenze**, coda solo per-chat. Decisione di posizionamento: WhatsLater non è
"programma messaggi" ma **sistema di promemoria clienti** — ricorrenze, orizzonte
illimitato, coda centralizzata, rubrica. Il lancio nativo educherà il mercato: la
SEO va seminata prima.

**5 pattern tecnici mappati** (dettagli con file:riga in `AndreaVault/decisions.md`,
22 ago):
1. **custody ack** — `status='sent'` oggi significa "scritto sul socket locale", non
   "WhatsApp l'ha accettato": il webhook butta via SERVER_ACK(2) e ERROR(0). Serve
   colonna `server_ack_at` + ERROR→`failed_after_send` + sweep di riconciliazione.
   *(È anche il differenziatore di vendita: tutti i concorrenti falliscono qui.)*
2. **Evolution 5xx post-relay** oggi va nel retry generico → rischio doppio invio;
   va trattato come indeterminato, come i timeout.
3. **echo-guard basato sul contenuto** in `webhook/route.ts:1237` (cerca stringhe come
   `[Nome]`) = anti-pattern → sopprimere per identità del messaggio.
4. **3 `.slice()` UTF-16 nudi** in `messages/route.ts` → `truncateAtGrapheme`.
5. **4xx permanenti** bruciano 3 retry → fail-fast + notifica immediata.

**Roadmap prodotto** (in ordine): ricorrenza annuale (compleanni) → note per contatto →
statistiche per l'utente → broadcast multi-destinatario → badge coda nel ContactPicker.

**Task aperti**: vedi `plan.md` (Task 61-64: attivazione residua, landing con pattern
WA Reminders, guida SEO Calendly, anti-scollegamento/OTP self-service).

### Prodotto
- ICP **D primario** (allenatori, parroci, scout, istruttori, scuola guida) + **B secondario** (site manager, facility manager). Segmento A (parrucchieri/dentisti/estetiste) escluso dal lancio, DA-RIVEDERE post 50 utenti reali. Segmento C limitato a pipeline calda (follow-up clienti già in trattativa); cold lead generation esclusa per vincolo WhatsApp.
- **Flusso primario**: dashboard → `ContactPickerModal` → `ScheduleModal` → `POST /api/messages`. Il bottone "Nuovo contatto" dentro ContactPicker copre i numeri non in rubrica.
- **Self-chat parser** ancora attivo in `app/api/webhook/route.ts` ma **mai esposto in UI user-facing** (decisione "self-chat hidden, easter egg" 2026-05-17).
- **Principio silenzioso**: il prodotto notifica i clienti dell'utente, mai l'utente stesso. Niente badge rossi, niente push, niente email di conferma routine. Eccezioni esplicite: billing/lifecycle (trial expiry, upsell all'80% del cap, blocco per fail rate eccessivo).


### Stack tecnico
- **Frontend**: Next.js 14.2.35 (App Router) + React 18.3.1 + TypeScript 5.5 + Tailwind CSS + PWA via `@ducanh2912/next-pwa` ^10.2 (dev-dep, registrato manualmente via `app/components/ServiceWorkerRegistrar.tsx`)
- **Backend**: Next.js API routes + cron multilayer. `/api/cron/send-messages` ha 3 trigger (vedi sezione Monitoring sotto). `/api/cron/daily-report` Vercel cron 06:00 UTC (include prune `audit_events` >90gg dallo Sprint 4). `/api/cron/cleanup-media` Vercel cron domenica 03:00 UTC (Sprint 4).
- **DB**: Supabase (Postgres) — source of truth è `supabase/migrations/`, `schema.sql` è snapshot v7 legacy
- **Client Supabase service-role**: SOLO via `app/lib/supabase-admin.ts` (`getSupabaseAdmin()` lancia se manca la config, `getSupabaseAdminOrNull()` per i chiamanti best-effort). Mai `createClient` inline nelle route e mai fallback sulla anon key — prima erano 36 copie in 7 varianti, 5 col fallback anon. Le 4 eccezioni documentate stanno nel commento in testa al file.
- **WhatsApp**: Evolution API v2 self-hosted su **Hetzner `157.90.251.241`** (immagine patchata `whatslater/evo-patched:v2.3.7-p2` su Coolify, Baileys multi-istanza)
- **LLM**: Groq (Llama) come parser primario nel webhook self-chat; OpenAI come secondario/fallback
- **Payments**: Stripe SDK ^14.5 (sandbox mode — live SCARTATA, vedi Stato deploy)
- **Test**: Jest 30 (unit/integration) + Playwright (e2e, suite separata da `npm test:e2e`)
- **Deploy**: Vercel (serverless + crons schedulati in `vercel.json`); Evolution API su nodo **Hetzner** separato (Coolify). Cutover da DigitalOcean completato (~2026-06-18); **decommission DO COMPLETATO il 2026-07-05** (Fase 6 runbook ESEGUITA: droplet `161.35.212.68` distrutto, nessun orfano, token revocato, env `DO_*` rimosse da Vercel). DigitalOcean fuori dallo stack.


### Tier system
- **Trial** — 7 giorni dal connect (limiti = Personal)
- **Free** — 3 msg/giorno, 5 contatti max (default post-trial)
- **Personal €4,99/mese** — 20 msg/giorno, 50 contatti
- **Professional €9,99/mese** — 35 msg/giorno, 200 contatti (introdotto 2026-05-17, commit 2cd6b80)
- **Business €19,99/mese** — 50+ msg/giorno, contatti illimitati


### Auth (post-C1, ancora valido)
- Cookie HTTP-only `sw_session` HMAC-SHA256 (env `AUTH_COOKIE_SECRET`, generato con `openssl rand -hex 64`)
- Sessione emessa al `CONNECTION_UPDATE state=open` via `/api/auth/check`
- Tabella `pending_auth_sessions` per coordinazione browser↔webhook
- Multi-device richiede re-pair (limitazione v1, OTP self-chat in v1.5)
- Implementazione usa Web Crypto API (compatibile Edge runtime + Node)


### Auth note
Auth è **solo** HMAC cookie phone-first (`sw_session`, vedi sezione Auth sotto). NON usiamo Supabase Auth — gli orphan `app/login/page.tsx` + `lib/supabase/{client,server}.ts` + `components/{Button,Input}.tsx` + `lib/utils.ts` + `lib/openai/parser.ts` sono stati eliminati nello Sprint 3 cleanup (audit-2026-05-25 issue #2). `Button.tsx` è stato mantenuto perché usato da `ContactPickerModal`; il suo import `cn` è stato migrato a `app/lib/cn.ts`.

### Monitoring (cron trigger stack `/api/cron/send-messages`)
Quattro layer concorrenti (tre @60s + una safety-net giornaliera), atomic lock previene doppio fire sullo stesso messaggio. **Runbook di ispezione: `docs/RUNBOOK-cron-triggers.md`.**
0. **pg_cron `send-messages-cron` @60s (`* * * * *`)** — **TRIGGER PRIMARIO REALE**: job Supabase interno che chiama `net.http_get('…/api/cron/send-messages?secret=<CRON_SECRET>')`. **Verificato in prod: 84.806 run dal 13-mag-2026, 0 fallimenti (al 11-lug-2026) = 1440 invocazioni/giorno.** Non era documentato prima di Task 43. ⚠️ `CRON_SECRET` in chiaro nel comando pg_cron → da ruotare e spostare in header (Task 44).
1. **cron-job.org pinger @60s** — pinger esterno storico, auth via `?secret=$CRON_SECRET`. ⚠️ **Inactive dal 12-giu-2026** (verificato) — non più un trigger vivo.
2. **instrumentation.ts self-cron @60s** — Next.js register(), Node-runtime-only, fallback per-lambda-warm (×N istanze) durante warmup.
3. **vercel.json `0 0 * * *`** — daily safety net per cleanup task / catch-all.

**Stack @60s VIVO oggi = pg_cron + self-cron** (cron-job.org spento). L'atomic lock in `app/api/cron/send-messages/route.ts` (status pending → processing → sent con `UPDATE ... WHERE status='pending'`) garantisce che un singolo messaggio venga claimed da un solo trigger anche se sparano simultaneamente — ma ogni fire ri-esegue tutto il preamble (reset RPC quote, scan full-table ricorrenze, cleanup) → carico preamble moltiplicato ogni minuto. La riduzione della tripla concorrenza è pianificata (Task 43-bis, BLOCCATA-DA Task 44/rotazione secret — NON ancora fatta). Verifica salute: gaps in `audit_events` WHERE `event_type='message_sent'` segnalano trigger giù.


### Crons collaterali (Sprint 4 + Sprint 6)
- **`/api/cron/cleanup-media`** domenica 03:00 UTC — batch 100 row/run (cap Vercel Hobby 10s), seleziona terminal-state (`sent|cancelled|failed`) con `media_url IS NOT NULL` e `created_at < NOW() - 30d`, rimuove file da Storage bucket `message-media`, poi nullifica colonne `media_*`. Storage error abort-prima-di-UPDATE (retry safe). Audit log `event_type='media_cleanup'`.
- **`/api/cron/cleanup-webhook-logs`** domenica 04:00 UTC (Sprint 6) — `DELETE FROM webhook_logs WHERE ts < NOW() - 30d` con `count: 'exact'`. Audit log `event_type='webhook_logs_prune'` con `removed_count + retention_days`. Noop response quando count=0 (no audit spam). Complementa lo scrubber `dbLog` che blocca nuove PII alla scrittura.
- **`/api/cron/daily-report`** 06:00 UTC — esistente, ora step finale: `pruneOldAuditEvents()` cancella `audit_events` con `created_at < NOW() - 90d`. Best-effort (fallisce silenzioso senza abortire report). Payload risposta include `audit_pruned: N`.


### Error monitoring (Sentry, Sprint 4)
@sentry/nextjs ^10.54 wired su server + edge + client runtime via `instrumentation.ts` + `instrumentation-client.ts` + `sentry.{server,edge}.config.ts`. Init gated on `SENTRY_DSN` env var → no-op silenzioso quando unset (local dev + pre-onboarding state). PII scrubber in `app/lib/sentry-pii.ts` (regex per WhatsApp JID, E.164 phone, email) applicato a `beforeSend` e `beforeBreadcrumb` su tutti i runtime. `withSentryConfig` in `next.config.js` con `tunnelRoute: '/monitoring'` per evitare ad-blocker. Source map upload opzionale gated on `SENTRY_AUTH_TOKEN`. Test endpoint `/api/test/sentry?secret=$CRON_SECRET` ritorna JSON diagnostico con campi `dsn_set`, `sentry_initialized`, `event_id`, `flushed` (usa `captureException` + `flush(2000)` esplicito perché serverless lambda freeze prima del transport flush con throw non gestito).


### Test suite
- 555+ test unit/integration verdi (`npm test`) — baseline post-Sprint 5 PWA, +9 dalla PR #18 (manifest shape 4 + InstallPrompt gating 5). Storico: 480 post-Sprint 2 → 509 post-Sprint 3 → 523 post-Sprint 4 (CLAUDE.md riportava 526 ma il vero baseline pre-Sprint-6 era 523) → 546 post-Sprint 6 → 555+ post-Sprint 5 PWA. Numero esatto da contare con un `npm test` fresco dopo i merge di Sprint 7.5 ops.
- 7 suite e2e Playwright (`__tests__/e2e/*.spec.ts`) — al momento jest le scoopa per errore di config (issue pre-esistente, non bloccante per release)

## Documenti canonici per AI sessions

- **Questo file** (`CLAUDE.md`) — regole vive, stato, vincoli, cosa c'è in lista
- **`AndreaVault/decisions.md`** — log decisioni append-only (source of truth)
- **`plan.md`** — task ranked con comandi esatti
- **`docs/storia/`** — la cronaca dettagliata, da leggere SOLO quando serve:
  - `2026-06-giugno.md` — pairing fix Baileys, hardening Round 6, cap contatti
  - `2026-07-luglio.md` — decommission DigitalOcean, beta gratis, hardening pre-scala
  - `2026-08-agosto.md` — intel nativo, audit competitor, fix pairing "terno al lotto"
  - `deploy-log.md` — elenco completo di feature e sprint messi in produzione
- `BUSINESS_PLAN.md`, `LAUNCH_PLAN.md`, `docs/ARCHITETTURA.md` sono **DEPRECATI**
  (pre-pivot ICP A, vecchio flusso self-chat-primary): riferimento storico, non stato corrente.
