# WhatsLater (SchedWhats) — Project Context

## STATO ATTUALE (aggiornato 20 Maggio 2026)

### Prodotto
- ICP **D primario** (allenatori, parroci, scout, istruttori, scuola guida) + **B secondario** (site manager, facility manager). Segmento A (parrucchieri/dentisti/estetiste) escluso dal lancio, DA-RIVEDERE post 50 utenti reali. Segmento C limitato a pipeline calda (follow-up clienti già in trattativa); cold lead generation esclusa per vincolo WhatsApp.
- **Flusso primario**: dashboard → `ContactPickerModal` → `ScheduleModal` → `POST /api/messages`. Il bottone "Nuovo contatto" dentro ContactPicker copre i numeri non in rubrica.
- **Self-chat parser** ancora attivo in `app/api/webhook/route.ts` ma **mai esposto in UI user-facing** (decisione "self-chat hidden, easter egg" 2026-05-17).
- **Principio silenzioso**: il prodotto notifica i clienti dell'utente, mai l'utente stesso. Niente badge rossi, niente push, niente email di conferma routine. Eccezioni esplicite: billing/lifecycle (trial expiry, upsell all'80% del cap, blocco per fail rate eccessivo).

### Stack tecnico
- **Frontend**: Next.js 14.2.15 (App Router) + React 18.3.1 + TypeScript 5.5 + Tailwind CSS
- **Backend**: Next.js API routes + cron schedulati. `/api/cron/send-messages` triggherato ogni 5 min da pinger esterno cron-job.org (auth via `CRON_SECRET`); Vercel cron `0 0 * * *` come fallback giornaliero. `/api/cron/daily-report` Vercel cron 06:00 UTC.
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
- ✅ Webhook gating self-chat-only, gruppi/broadcast bloccati, atomic lock cron, timeout 8s Evolution, `WEBHOOK_SECRET` obbligatorio
- ⚠️ **Stripe live mode SCARTATA** (2026-05-17): primi 5 paganti via bonifico/PayPal manuale per evitare blocco KYC. Si riapre dopo 3-5 paganti reali.
- ⚠️ `MESSAGING_HISTORY_SET` non emesso da Evolution → name rubrica utente non accessibile (DA-RIVEDERE)

### Auth (post-C1, ancora valido)
- Cookie HTTP-only `sw_session` HMAC-SHA256 (env `AUTH_COOKIE_SECRET`, generato con `openssl rand -hex 64`)
- Sessione emessa al `CONNECTION_UPDATE state=open` via `/api/auth/check`
- Tabella `pending_auth_sessions` per coordinazione browser↔webhook
- Multi-device richiede re-pair (limitazione v1, OTP self-chat in v1.5)
- Implementazione usa Web Crypto API (compatibile Edge runtime + Node)

### Test suite
- 319 test unit/integration verdi (`npm test`)
- 7 suite e2e Playwright (`__tests__/e2e/*.spec.ts`) — al momento jest le scoopa per errore di config (issue pre-esistente, non bloccante per release)

## Documenti canonici per AI sessions

- **Questo file** (`CLAUDE.md`) — stato sintetico aggiornato
- **`AndreaVault/decisions.md`** — log decisioni append-only (source of truth)
- `BUSINESS_PLAN.md`, `LAUNCH_PLAN.md`, `docs/ARCHITETTURA.md` sono marcati **DEPRECATI**: descrivono il pre-pivot ICP A e il vecchio flusso self-chat-primary. Conservati come riferimento storico, non come stato corrente.
