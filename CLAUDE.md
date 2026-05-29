# WhatsLater (SchedWhats) — Project Context

## STATO ATTUALE (aggiornato 28 Maggio 2026)

### Prodotto
- ICP **D primario** (allenatori, parroci, scout, istruttori, scuola guida) + **B secondario** (site manager, facility manager). Segmento A (parrucchieri/dentisti/estetiste) escluso dal lancio, DA-RIVEDERE post 50 utenti reali. Segmento C limitato a pipeline calda (follow-up clienti già in trattativa); cold lead generation esclusa per vincolo WhatsApp.
- **Flusso primario**: dashboard → `ContactPickerModal` → `ScheduleModal` → `POST /api/messages`. Il bottone "Nuovo contatto" dentro ContactPicker copre i numeri non in rubrica.
- **Self-chat parser** ancora attivo in `app/api/webhook/route.ts` ma **mai esposto in UI user-facing** (decisione "self-chat hidden, easter egg" 2026-05-17).
- **Principio silenzioso**: il prodotto notifica i clienti dell'utente, mai l'utente stesso. Niente badge rossi, niente push, niente email di conferma routine. Eccezioni esplicite: billing/lifecycle (trial expiry, upsell all'80% del cap, blocco per fail rate eccessivo).

### Stack tecnico
- **Frontend**: Next.js 14.2.15 (App Router) + React 18.3.1 + TypeScript 5.5 + Tailwind CSS
- **Backend**: Next.js API routes + cron multilayer. `/api/cron/send-messages` ha 3 trigger (vedi sezione Monitoring sotto). `/api/cron/daily-report` Vercel cron 06:00 UTC (include prune `audit_events` >90gg dallo Sprint 4). `/api/cron/cleanup-media` Vercel cron domenica 03:00 UTC (Sprint 4).
- **DB**: Supabase (Postgres) — source of truth è `supabase/migrations/`, `schema.sql` è snapshot v7 legacy
- **WhatsApp**: Evolution API v2 self-hosted su DigitalOcean droplet (Baileys multi-istanza)
- **LLM**: Groq (Llama) come parser primario nel webhook self-chat; OpenAI come secondario/fallback
- **Payments**: Stripe SDK ^14.5 (sandbox mode — live SCARTATA, vedi Stato deploy)
- **Test**: Jest 30 (unit/integration) + Playwright (e2e, suite separata da `npm test:e2e`)
- **Deploy**: Vercel (serverless + crons schedulati in `vercel.json`); Evolution API su droplet separato DO

### Tier system
- **Trial** — 7 giorni dal connect (limiti = Personal)
- **Free** — 3 msg/giorno, 5 contatti max (default post-trial)
- **Personal €4,99/mese** — 20 msg/giorno, 50 contatti
- **Professional €9,99/mese** — 35 msg/giorno, 200 contatti (introdotto 2026-05-17, commit 2cd6b80)
- **Business €19,99/mese** — 50+ msg/giorno, contatti illimitati

### Stato deploy
- ✅ ContactPicker WhatsApp-native + lazy photos + sezione Recenti + filtro semantico (`added_manually OR push_name`)
- ✅ ScheduleModal WhatsApp-native redesign + silent defaults ("Nessuna notifica · invio automatico")
- ✅ Strada A: Supabase contacts cache + RPC + admin stats (951 contatti cached con push_name)
- ✅ Stripe sandbox + Customer Portal + 3 tier checkout (Personal/Professional/Business)
- ✅ Privacy Policy + ToS live
- ✅ C1 — auth phone-first cookie HMAC (`AUTH_COOKIE_SECRET`), sessione 90gg sliding via `pending_auth_sessions`
- ✅ Batch UX cleanup pre-lancio 2026-05-19/20: `/signup` e `/tutorial` eliminati, Hero+FAQ+layout metadata ricodificati ICP D+B, scrub self-chat user-facing, hotfix HelpTooltip dashboard, FIX 1 QuickCaptureModal rimosso
- ✅ Webhook gating self-chat-only, gruppi/broadcast bloccati, atomic lock cron, timeout 8s Evolution, `WEBHOOK_SECRET` obbligatorio, HMAC signature `x-hub-signature-256` opzionale (gate-able con `EVOLUTION_SIGNATURE_REQUIRED=true`, Sprint 6)
- ✅ Sprint 4 polish operativo (2026-05-28, 5 commit): media cleanup cron 30gg domenica 03:00 UTC + audit_events 90gg retention via daily-report + `DEPRECATED_DEBUG_TOKEN` rimosso da debug-logs (6gg early vs deadline 2026-06-03, orphan grep clean) + Sentry @sentry/nextjs ^10.54 su 3 runtime con PII scrubber (JID/E.164/email) + hotfix `/api/test/sentry` con captureException esplicito + flush(2000) + diagnostica
- ✅ Sprint 6 GDPR + security (2026-05-29, 5 commit, basato su AI Council audit Gemini + Claude cross-check): (1) `maskPhoneForLLM` in `admin/chat` system prompt (no più phone E.164 verso Groq/OpenAI); (2) `scrubPiiForLog` su dbLog payloads + cron `cleanup-webhook-logs` domenica 04:00 UTC (30gg retention); (3) `MAX_PENDING = dailyLimit × 7` quota in POST `/api/messages` (429 queue_full); (4) feature flag `EVOLUTION_SIGNATURE_REQUIRED` per HMAC obbligatorio (default off, attivare quando Evolution Manager firma outgoing); (5) endpoint POST `/api/account/delete` GDPR right-to-be-forgotten (cascade 10 tabelle + Evolution disconnect best-effort + audit `account_deleted` con phone hash).
- ⚠️ **Sentry pending DSN onboarding**: codice wired, manca solo `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` su Vercel project settings. Verifica con `curl '/api/test/sentry?secret=$CRON_SECRET'` → response include `sentry_initialized`, `event_id`, `flushed`.
- ⚠️ **Cluster D Make.com SKIP**: dipende da API key system, deferred Sprint 5.
- ⚠️ **Stripe live mode SCARTATA** (2026-05-17): primi 5 paganti via bonifico/PayPal manuale per evitare blocco KYC. Si riapre dopo 3-5 paganti reali.
- ⚠️ `MESSAGING_HISTORY_SET` non emesso da Evolution → name rubrica utente non accessibile (DA-RIVEDERE)
- ⚠️ **Channels/Newsletter NON supportati** (Sprint 3 Cluster D investigation 2026-05-27): Baileys underlying library supporta `@newsletter` JID + sendMessage, ma Evolution API v2 attuale NON wrappa il REST endpoint. Defer in attesa di Evolution v3 o fork Evolution custom. ICP-D workaround: usare gruppi `@g.us` (già supportato). Riferimenti: doc.evolution-api.com/v2 + Baileys issues #549/#628.

### Auth (post-C1, ancora valido)
- Cookie HTTP-only `sw_session` HMAC-SHA256 (env `AUTH_COOKIE_SECRET`, generato con `openssl rand -hex 64`)
- Sessione emessa al `CONNECTION_UPDATE state=open` via `/api/auth/check`
- Tabella `pending_auth_sessions` per coordinazione browser↔webhook
- Multi-device richiede re-pair (limitazione v1, OTP self-chat in v1.5)
- Implementazione usa Web Crypto API (compatibile Edge runtime + Node)

### Monitoring (cron trigger stack `/api/cron/send-messages`)
Tre layer concorrenti, atomic lock previene doppio fire sullo stesso messaggio:
1. **cron-job.org pinger @60s** — primario esterno, auth via `?secret=$CRON_SECRET`
2. **instrumentation.ts self-cron @60s** — Next.js register(), Node-runtime-only, fallback se cron-job.org down o durante warmup lambda
3. **vercel.json `0 0 * * *`** — daily safety net per cleanup task / catch-all

L'atomic lock in `app/api/cron/send-messages/route.ts` (status pending → processing → sent con `UPDATE ... WHERE status='pending'`) garantisce che un singolo messaggio venga claimed da un solo trigger anche se i 3 sparano simultaneamente. Verifica salute: gaps in `audit_events` WHERE `event_type='message_sent'` segnalano trigger giù.

### Crons collaterali (Sprint 4 + Sprint 6)
- **`/api/cron/cleanup-media`** domenica 03:00 UTC — batch 100 row/run (cap Vercel Hobby 10s), seleziona terminal-state (`sent|cancelled|failed`) con `media_url IS NOT NULL` e `created_at < NOW() - 30d`, rimuove file da Storage bucket `message-media`, poi nullifica colonne `media_*`. Storage error abort-prima-di-UPDATE (retry safe). Audit log `event_type='media_cleanup'`.
- **`/api/cron/cleanup-webhook-logs`** domenica 04:00 UTC (Sprint 6) — `DELETE FROM webhook_logs WHERE ts < NOW() - 30d` con `count: 'exact'`. Audit log `event_type='webhook_logs_prune'` con `removed_count + retention_days`. Noop response quando count=0 (no audit spam). Complementa lo scrubber `dbLog` che blocca nuove PII alla scrittura.
- **`/api/cron/daily-report`** 06:00 UTC — esistente, ora step finale: `pruneOldAuditEvents()` cancella `audit_events` con `created_at < NOW() - 90d`. Best-effort (fallisce silenzioso senza abortire report). Payload risposta include `audit_pruned: N`.

### Error monitoring (Sentry, Sprint 4)
@sentry/nextjs ^10.54 wired su server + edge + client runtime via `instrumentation.ts` + `instrumentation-client.ts` + `sentry.{server,edge}.config.ts`. Init gated on `SENTRY_DSN` env var → no-op silenzioso quando unset (local dev + pre-onboarding state). PII scrubber in `app/lib/sentry-pii.ts` (regex per WhatsApp JID, E.164 phone, email) applicato a `beforeSend` e `beforeBreadcrumb` su tutti i runtime. `withSentryConfig` in `next.config.js` con `tunnelRoute: '/monitoring'` per evitare ad-blocker. Source map upload opzionale gated on `SENTRY_AUTH_TOKEN`. Test endpoint `/api/test/sentry?secret=$CRON_SECRET` ritorna JSON diagnostico con campi `dsn_set`, `sentry_initialized`, `event_id`, `flushed` (usa `captureException` + `flush(2000)` esplicito perché serverless lambda freeze prima del transport flush con throw non gestito).

### Test suite
- 546 test unit/integration verdi (`npm test`) — baseline post-Sprint 6 (GDPR maskPhoneForLLM 3 + log-scrubber 5 + cleanup-webhook-logs 4 + MAX_PENDING 3 + EVOLUTION_SIGNATURE_REQUIRED 2 + account-delete 6). Storico: 480 post-Sprint 2 → 509 post-Sprint 3 → 523 post-Sprint 4 (CLAUDE.md riportava 526 ma il vero baseline pre-Sprint-6 era 523) → 546 post-Sprint 6.
- 7 suite e2e Playwright (`__tests__/e2e/*.spec.ts`) — al momento jest le scoopa per errore di config (issue pre-esistente, non bloccante per release)

### Auth note
Auth è **solo** HMAC cookie phone-first (`sw_session`, vedi sezione Auth sotto). NON usiamo Supabase Auth — gli orphan `app/login/page.tsx` + `lib/supabase/{client,server}.ts` + `components/{Button,Input}.tsx` + `lib/utils.ts` + `lib/openai/parser.ts` sono stati eliminati nello Sprint 3 cleanup (audit-2026-05-25 issue #2). `Button.tsx` è stato mantenuto perché usato da `ContactPickerModal`; il suo import `cn` è stato migrato a `app/lib/cn.ts`.

## Documenti canonici per AI sessions

- **Questo file** (`CLAUDE.md`) — stato sintetico aggiornato
- **`AndreaVault/decisions.md`** — log decisioni append-only (source of truth)
- `BUSINESS_PLAN.md`, `LAUNCH_PLAN.md`, `docs/ARCHITETTURA.md` sono marcati **DEPRECATI**: descrivono il pre-pivot ICP A e il vecchio flusso self-chat-primary. Conservati come riferimento storico, non come stato corrente.
