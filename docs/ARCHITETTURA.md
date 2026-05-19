> ⚠️ **DOCUMENTO DEPRECATO** — 4 Aprile 2026 (snapshot v7.0.0).
>
> Descrive il **vecchio paradigma user-facing** in cui il flusso primario era "L'utente scrive nella chat Note a se stesso → l'AI parsifica → il cron invia". Dopo la decisione del 2026-05-17 ("flusso primario dashboard, self-chat hidden"), il flusso utente canonico è ora `dashboard → ContactPickerModal → ScheduleModal → POST /api/messages`. Il parser self-chat resta **solo backend** in `app/api/webhook/route.ts` ed è classificato come easter egg, mai menzionato in UI o marketing.
>
> Altre incongruenze rispetto allo stato corrente:
> - Lista le pagine `/signup` e `/tutorial` come folder vive — entrambe eliminate nel batch UX cleanup 2026-05-19.
> - Schema DB v7.0 referenzia `whatsapp_instances`, `source_vcard`, `message_logs`, `system_status` — il codice live usa `user_instances` e ha migrato a un set di tabelle diverso (vedi `supabase/migrations/`).
> - Tier system descritto senza Professional €9,99 (introdotto 2026-05-17).
>
> **Stato attuale** in:
> - [`../CLAUDE.md`](../CLAUDE.md) — stato sintetico aggiornato
> - `AndreaVault/decisions.md` — log decisioni canoniche
> - `supabase/migrations/` — source of truth per lo schema DB live
>
> Conservato come riferimento storico architetturale (stack tecnico, flussi cron, regole anti-ban) ma **non come descrizione del prodotto attuale**.

---

# WhatsLater — Architettura Tecnica Completa

> Documento aggiornato al 4 Aprile 2026 — versione 7.0.0

WhatsLater (SchedWhats) e un SaaS per la programmazione automatica di messaggi WhatsApp tramite linguaggio naturale in italiano. L'utente scrive "Invia a Marco domani alle 15: Ricordati la riunione!" nella chat Note a se stesso, l'AI parsifica data/ora/destinatario/messaggio, e un cron job lo invia al momento giusto.

---

## 1. STACK TECNICO

| Tecnologia | Versione | Ruolo | Perche |
|---|---|---|---|
| **Next.js** | 14.2.15 | Framework fullstack (App Router) | SSR + API routes + cron in un unico deploy. Vercel-native. |
| **React** | 18.3.1 | UI | Standard de facto per componenti reattivi |
| **TypeScript** | ES2020 | Type safety | Previene bug a compile time, migliora DX |
| **Tailwind CSS** | 3.4.9 | Styling | Utility-first, veloce per iterare sul design |
| **Supabase** | SSR 0.4.0 / JS 2.45.0 | Database + Auth | PostgreSQL managed con RLS, auth email/password, real-time subscriptions |
| **Evolution API** | v2 | WhatsApp integration | Bridge WhatsApp via Baileys (multi-device). Self-hosted su droplet. |
| **Groq** | API | AI primaria (date parsing) | Veloce e gratuito per parsing NLP italiano |
| **OpenAI** | 4.55.0 | AI fallback | Fallback se Groq non disponibile |
| **Stripe** | 14.5.0 | Pagamenti | Checkout hosted + Customer Portal + webhook per subscription lifecycle |
| **Resend** | API | Email fallback alerting | Email transazionali gratuite (no SDK, raw fetch) |
| **Vercel** | — | Hosting + cron | Deploy automatico da Git, cron integrato, scaling serverless |
| **DigitalOcean** | Droplet 2GB/1vCPU | Evolution API hosting | $16/mese, Coolify per gestire container Docker |
| **Coolify** | — | Container orchestrator | Gestisce il container Evolution API sul droplet |
| **Jest** | 30.3.0 | Unit/integration test | Preset ts-jest, 88+ test |
| **Playwright** | 1.58.2 | E2E test | Test browser su Chromium contro produzione |
| **Zod** | 3.23.8 | Schema validation | Validazione request body type-safe |
| **date-fns** | 3.6.0 | Date manipulation | Leggero, immutabile, tree-shakable |
| **vcf** | 2.1.2 | vCard parsing | Estrae numeri di telefono dai contatti condivisi |

---

## 2. STRUTTURA CARTELLE

```
whatslaterpush/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # Landing page (marketing)
│   ├── layout.tsx                # Root layout (Inter + Space Grotesk fonts)
│   ├── globals.css               # Tailwind + animazioni custom + design tokens
│   ├── dashboard/
│   │   └── page.tsx              # Dashboard utente (connessione + coda messaggi)
│   ├── login/
│   │   └── page.tsx              # Login (Supabase email/password)
│   ├── signup/
│   │   └── page.tsx              # Registrazione + conferma email
│   ├── tutorial/
│   │   └── page.tsx              # Onboarding interattivo a step
│   ├── admin/
│   │   └── page.tsx              # Admin dashboard (metriche, AI chat, alerting)
│   ├── privacy/
│   │   └── page.tsx              # Privacy Policy (GDPR, italiano)
│   ├── terms/
│   │   └── page.tsx              # Terms of Service (italiano)
│   ├── monitoring/
│   │   └── page.tsx              # Dashboard monitoring (status checks)
│   ├── api/
│   │   ├── connect/route.ts      # Gestione connessione WhatsApp (~400 righe)
│   │   ├── webhook/route.ts      # Webhook Evolution API (~1200 righe)
│   │   ├── cron/send-messages/route.ts  # Cron invio messaggi (~600 righe)
│   │   ├── messages/route.ts     # CRUD messaggi schedulati
│   │   ├── health/route.ts       # Health check sistema
│   │   ├── payment/
│   │   │   ├── create-checkout/route.ts  # Crea sessione Stripe Checkout
│   │   │   ├── portal/route.ts           # Stripe Customer Portal
│   │   │   └── webhook/route.ts          # Webhook Stripe
│   │   ├── admin/
│   │   │   ├── chat/route.ts     # AI chatbot admin
│   │   │   └── data/route.ts     # Metriche business + Stripe
│   │   ├── monitoring/
│   │   │   └── health-check/route.ts  # Health check con alerting
│   │   └── debug-logs/route.ts   # Log webhook per debug
│   ├── components/               # Componenti pagina (marketing)
│   │   ├── Navbar.tsx            # Header fisso con nav links
│   │   ├── HeroSection.tsx       # Hero con mockup WhatsApp animato
│   │   ├── StatsBar.tsx          # Barra statistiche ("2 minuti per iniziare")
│   │   ├── HowItWorksSection.tsx # 3 step con animazione scroll
│   │   ├── PricingSection.tsx    # Tabella prezzi + integrazione Stripe
│   │   ├── FAQSection.tsx        # Accordion FAQ (5 domande)
│   │   └── Footer.tsx            # Footer con link legali
│   └── lib/                      # Logica business
│       ├── cron-utils.ts         # Funzioni pure per validazione invio (shouldSendMessage, rescheduleTomorrow)
│       ├── plans.ts              # Tier system: getPlanLimits(plan) → {dailyLimit, maxContacts, ...}
│       ├── phone.ts              # Normalizzazione numeri italiani (0039→39, 3xx→393xx)
│       ├── webhook-utils.ts      # Parsing date italiano, timezone Roma, estrazione destinatario
│       ├── monitoring.ts         # 6 health check + alert cascade WhatsApp→Email→DB
│       └── cn.ts                 # clsx + tailwind-merge
├── components/                   # Componenti UI riusabili
│   ├── Button.tsx                # Varianti: primary/secondary/outline/ghost/danger + sizes
│   ├── Input.tsx                 # Input con styling custom
│   ├── ConnectCard.tsx           # Card connessione WhatsApp (QR/pairing code/connected)
│   ├── QueueList.tsx             # Lista messaggi schedulati con badge status
│   └── StatusBadge.tsx           # Badge colorato per stato (pending/sent/failed/...)
├── lib/
│   ├── evolution/
│   │   └── client.ts            # EvolutionClient singleton (create, send, delete, webhook)
│   └── supabase/
│       ├── client.ts            # Browser client (@supabase/ssr)
│       └── server.ts            # Server client + service role admin client
├── types/
│   ├── supabase.ts              # Tipi auto-generati da schema DB
│   └── index.ts                 # Tipi custom (EvolutionInstance, ConnectResponse, etc.)
├── supabase/
│   └── schema.sql               # Schema completo PostgreSQL + RLS + trigger
├── __tests__/
│   ├── cron-utils.test.ts       # 19+ test per logica invio
│   ├── cron.integration.test.ts # Test integrazione cron
│   ├── webhook-utils.test.ts    # Test parsing date italiano
│   ├── webhook.integration.test.ts  # Test webhook processing
│   ├── phone.test.ts            # Test normalizzazione telefono
│   ├── plans.test.ts            # Test tier system
│   ├── monitoring.test.ts       # Test health check
│   ├── helpers/                  # Mock e utility test
│   └── e2e/                     # Playwright
│       ├── auth.spec.ts         # Login/signup flow
│       ├── dashboard.spec.ts    # Dashboard UI
│       ├── landing.spec.ts      # Landing page
│       ├── pricing-checkout.spec.ts  # Pricing + Stripe
│       └── admin.spec.ts        # Admin dashboard
├── stress-test/
│   ├── run.ts                   # Script stress test Evolution API
│   └── results/                 # Output CSV/JSON test
├── docs/
│   ├── ARCHITETTURA.md          # Questo file
│   └── superpowers/
│       ├── specs/               # Design spec
│       └── plans/               # Implementation plan
├── public/                      # Asset statici
├── Dockerfile                   # Multi-stage build (node:18-alpine → standalone)
├── vercel.json                  # Cron: /api/cron/send-messages ogni giorno a mezzanotte UTC
├── next.config.js               # output: standalone, vcf server-external
├── tailwind.config.ts           # Tema WhatsApp (colori, ombre, animazioni)
├── jest.config.js               # ts-jest, alias @/
├── playwright.config.ts         # Chromium, baseURL produzione
├── middleware.ts                 # Auth middleware (attualmente disabilitato)
└── package.json                 # v7.0.0
```

---

## 3. API ROUTES

### POST `/api/connect`

Endpoint unificato per la gestione della connessione WhatsApp. Il parametro `action` nel body determina l'operazione.

#### action: `getCodeAndPairing`
- **Scopo:** Inizializza connessione WhatsApp generando QR code + pairing code
- **Body:** `{ "action": "getCodeAndPairing", "phone": "393509898408" }`
- **Response:** `{ "instanceName": "SchedWhats-393509898408", "qrCode": "base64...", "pairingCode": "XXXX-YYYY" }`
- **Logica:**
  1. Valida e normalizza numero con `validatePhone()`
  2. Genera nome istanza: `SchedWhats-{cleanPhone}`
  3. Pulisce record duplicati in `user_instances`
  4. Force-delete di istanze esistenti con stesso nome
  5. Chiama Evolution API `/instance/create` con configurazione webhook
  6. Tentativi multipli per QR/pairing code con fallback
  7. Configura webhook subito dopo creazione
  8. Upsert utente in DB con piano trial (scadenza 7 giorni)

#### action: `status` / `getStatus`
- **Scopo:** Controlla stato connessione WhatsApp
- **Body:** `{ "action": "status", "instanceName": "SchedWhats-393509898408" }`
- **Response:** `{ "status": "open|connecting|close", "owner": "393509898408"|null }`
- **Logica:** Interroga Evolution API, mappa stati (`open/connected` → `open`, `close/disconnected` → `close`), persiste in DB

#### action: `getPhone`
- **Scopo:** Recupera numero proprietario (attende connessione)
- **Body:** `{ "action": "getPhone", "instanceName": "SchedWhats-393509898408" }`
- **Response:** `{ "phone": "393509898408" }`
- **Logica:** Retry fino a 10 volte (3s intervallo, timeout 30s). Estrae `ownerJid` da `/instance/fetchInstances`

#### action: `disconnect`
- **Scopo:** Disconnette istanza WhatsApp
- **Body:** `{ "action": "disconnect", "instanceName": "SchedWhats-393509898408" }`
- **Logica:** Logout + delete su Evolution API, aggiorna `connection_status: 'close'` in DB

#### action: `setWebhook`
- **Scopo:** Configura webhook per istanza
- **Body:** `{ "action": "setWebhook", "instanceName": "SchedWhats-393509898408" }`
- **Logica:** POST a Evolution API `/webhook/set/{name}`. Prova formato flat (v2.x), poi wrapped (v2.0). Eventi: `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`

#### action: `refreshWebhooks`
- **Scopo:** Ri-configura webhook su tutte le istanze attive (manutenzione)
- **Body:** `{ "action": "refreshWebhooks", "secret": "CRON_SECRET" }`
- **Auth:** Richiede `CRON_SECRET`

---

### POST `/api/webhook`

Riceve eventi da Evolution API. **1212 righe** di logica.

**Auth:** Header `x-webhook-secret` o `authorization` o `apikey` = `WEBHOOK_SECRET`

#### Evento: `CONNECTION_UPDATE`
- Aggiorna `user_instances.connection_status`
- Su prima connessione (`state: open`): invia disclaimer + messaggio di benvenuto
- Setta flag `welcome_sent`

#### Evento: `MESSAGES_UPSERT` (testo)
- **Solo self-chat:** processa solo messaggi `fromMe: true` nella propria chat
- **Deduplicazione:** cache in-memory (120s TTL) + constraint DB su `wa_message_id`
- **Pipeline:**
  1. Estrai contenuto e mittente
  2. Risolvi identita: match istanza + telefono con `user_instances`
  3. Parsing intent via AI (Groq primario, OpenAI fallback) OPPURE regex fallback
  4. Salva contesto in `scheduled_messages`
  5. Richiedi conferma utente

#### Evento: `MESSAGES_UPSERT` (vCard/contatto)
- Estrae telefono da vCard (supporta `waid=` e `TEL:`)
- Enforces limite contatti per piano (`pending_contacts`)
- Upsert contatto con owner phone
- Notifica utente del salvataggio

#### Comandi rapidi (senza AI)
| Comando | Azione |
|---|---|
| `ok`, `si`, `conferma` | Conferma messaggio pending |
| `no`, `annulla`, `cancella` | Cancella messaggio pending |
| `lista`, `pending` | Elenca messaggi schedulati |
| `annulla [num]` | Cancella per indice |
| `stato` | Stato connessione |
| `aiuto`, `help` | Mostra guida |

#### Stati di schedulazione
- `awaiting_time` — ha destinatario + messaggio, manca l'ora
- `awaiting_recipient` — ha messaggio + forse ora, manca destinatario
- `awaiting_confirm` — messaggio completo, attende conferma utente
- Auto-scadenza: stati "awaiting" piu vecchi di 1 ora cancellati automaticamente

#### AI System Prompt
L'AI riceve il messaggio dell'utente con contesto (contatti salvati, messaggi pending) e ritorna un JSON con action type: `schedule`, `ask_time`, `ask_recipient`, `confirm`, `cancel_confirm`, `modify`, `list`, `cancel`, `status`, `help`, `chat`.

---

### GET `/api/cron/send-messages`

Cron job per invio messaggi schedulati. Eseguito da Vercel cron (mezzanotte UTC) o trigger esterno.

**Auth:** Query param `secret` o header `x-vercel-cron: 1` = `CRON_SECRET`

**Response:**
```json
{
  "sent": 5, "failed": 2, "skipped": 1, "rateLimited": 0,
  "trialExpired": 1, "disconnected": 2, "timedOut": false,
  "duration": "4523ms", "timestamp": "2026-04-03T10:45:00Z"
}
```

**Sequenza operazioni:**
1. **Cleanup:** Cancella record `awaiting_*` piu vecchi di 1 ora
2. **Reset giornaliero:** `messages_sent_today = 0`, `upsell_sent_today = false`
3. **Trial expiry:** Downgrade `trial → free`, invia notifica
4. **Fetch messaggi:** Max 25 pending, ordinati per `scheduled_at`
5. **Batch di 5** con timeout guard (bail a 8s per rispettare limite Vercel 10s)
6. **Per ogni messaggio, valida:**
   - Trial scaduto → cancella
   - Istanza disconnessa → rischedula a domani
   - Limite giornaliero → rate limit (free: 3, personal: 20, business: 50)
   - Cool-down: max 3 msg allo stesso destinatario in 24h
   - Failure history: blocca se >=5 fallimenti in 24h
   - Rate limit per minuto: 15/utente, 18/istanza
7. **Atomic lock:** Aggiorna messaggio a `processing` prima di inviare (previene double-send)
8. **Invio:** POST Evolution API `/message/sendText/{instanceName}`
9. **Retry:** Fino a 3 tentativi con backoff esponenziale (5, 10, 15 minuti)
10. **Upsell:** A 80% del limite giornaliero, invia offerta upgrade (max 1/giorno)

---

### GET/DELETE `/api/messages`

**GET** — Lista messaggi schedulati per un utente.
- **Query:** `?phone=393509898408`
- **Response:** `{ "messages": [...], "subscription_plan": "trial", "trial_ends_at": "..." }`
- **Logica:** Filtra storico per `historyDays` del piano

**DELETE** — Cancella un messaggio.
- **Body:** `{ "id": "msg-uuid", "phone": "393509898408" }`
- **Logica:** Verifica ownership (instance_phone == phone), aggiorna status a `cancelled`

---

### GET `/api/health`

Health check base. Nessuna autenticazione.

**Response:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "version": "7.0.0",
  "services": { "database": true, "evolution": true, "openai": true }
}
```

---

### POST `/api/payment/create-checkout`

Crea sessione Stripe Checkout.

- **Body:** `{ "phone": "393509898408", "plan": "personal|business" }`
- **Response:** `{ "url": "https://checkout.stripe.com/..." }`
- **Logica:** Mappa piano → price ID (`STRIPE_PRICE_PERSONAL`/`STRIPE_PRICE_BUSINESS`), trova/crea Stripe customer, crea sessione subscription

### POST `/api/payment/portal`

Crea sessione Stripe Billing Portal.

- **Body:** `{ "phone": "393509898408" }`
- **Response:** `{ "url": "https://billing.stripe.com/..." }`

### POST `/api/payment/webhook`

Webhook Stripe per eventi pagamento.

**Auth:** Verifica `stripe-signature` con `STRIPE_WEBHOOK_SECRET`

| Evento | Azione |
|---|---|
| `checkout.session.completed` | Aggiorna piano in DB, unpausa messaggi, notifica utente |
| `customer.subscription.deleted` | Downgrade a `free`, notifica utente |

---

### GET `/api/admin/data`

Metriche business e sistema.

**Auth:** Query param `secret` = `MONITORING_SECRET`

**Response:** Contiene: health checks, utenti per piano, MRR, trial in scadenza, trial churned, pagamenti Stripe recenti, subscription attive, revenue mensile, ultimi 20 alert

### POST `/api/admin/chat`

AI chatbot per admin. Domande in linguaggio naturale sullo stato del sistema.

**Auth:** `secret` = `MONITORING_SECRET`
- **Body:** `{ "secret": "...", "question": "Quanti utenti paganti ci sono?" }`
- **Logica:** Costruisce contesto con metriche + health check, chiama Groq/OpenAI, risponde in italiano

---

### GET `/api/monitoring/health-check`

Health check con alerting automatico (chiamato da cron-job.org ogni 15 minuti).

**Auth:** Query param `secret` = `MONITORING_SECRET`

**6 check:**
1. `evolution_api` — GET fetchInstances con timeout 8s → critical se fallisce
2. `cron_stalled` — Messaggi pending da >25h → critical
3. `webhook_inactive` — Nessun messaggio in 12h con istanze attive → warning
4. `supabase_down` — Query base fallisce → critical
5. `messages_stalled` — Messaggi in `processing` da >10min → critical
6. `failed_spike` — >10 falliti in 2h → critical, 6-10 → warning

**Alert cascade:** WhatsApp (al 393442582226) → Email (Resend a musicizthekey@gmail.com) → DB only

**Anti-spam:** Cooldown 1 ora per check. Recovery notification quando lo stato torna `ok`.

---

### GET `/api/debug-logs`

Log webhook per debug.

**Auth:** `secret` = `CRON_SECRET`
- **Query:** `?limit=30`
- **Response:** Array di log con timestamp, tag, data

---

## 4. DATABASE

PostgreSQL su Supabase con RLS abilitata su tutte le tabelle.

### Tabella: `user_instances`

Tabella principale utenti. Ogni riga = 1 utente con istanza WhatsApp.

| Colonna | Tipo | Default | Note |
|---|---|---|---|
| `id` | UUID | PK | |
| `instance_name` | TEXT | NOT NULL, UNIQUE | Es. `SchedWhats-393442582226` |
| `phone_number` | TEXT | | Numero normalizzato |
| `connection_status` | TEXT | `'unknown'` | `open`, `close`, `connecting`, `unknown` |
| `subscription_plan` | TEXT | `'trial'` | `trial`, `free`, `personal`, `business` |
| `trial_ends_at` | TIMESTAMPTZ | | 7 giorni dalla connessione |
| `stripe_customer_id` | TEXT | NULL | ID cliente Stripe |
| `messages_sent_today` | INTEGER | 0 | Reset giornaliero dal cron |
| `upsell_sent_today` | BOOLEAN | false | Max 1 upsell/giorno |
| `welcome_sent` | BOOLEAN | false | Disclaimer inviato |
| `last_connection_update` | TIMESTAMPTZ | | |
| `created_at` | TIMESTAMPTZ | NOW() | |
| `updated_at` | TIMESTAMPTZ | auto | Trigger `update_updated_at_column()` |

### Tabella: `pending_auth_sessions`

Sessioni temporanee di pairing che coordinano browser e webhook durante il login phone-first.

| Colonna | Tipo | Note |
|---|---|---|
| `id` | UUID | PK |
| `phone` | TEXT | Numero richiesto dall'utente |
| `status` | TEXT | `pending` → `authenticated` |
| `instance_name` | TEXT | Popolato dal webhook su success |
| `expires_at` | TIMESTAMPTZ | TTL 10 minuti |
| `created_at` | TIMESTAMPTZ | |

Riga creata da `POST /api/auth/init`. Aggiornata dal webhook `CONNECTION_UPDATE state=open`. Cancellata da `GET /api/auth/check` su success o dal cron come cleanup dopo 1h dalla scadenza.

### Tabella: `scheduled_messages`

Coda messaggi. Ogni riga = 1 messaggio schedulato.

| Colonna | Tipo | Default | Note |
|---|---|---|---|
| `id` | UUID | PK | |
| `user_id` | UUID | FK profiles.id | |
| `instance_id` | UUID | FK whatsapp_instances.id | Nullable |
| `instance_phone` | TEXT | | Telefono owner (per query contesto) |
| `recipient_number` | TEXT | NOT NULL | Destinatario |
| `recipient_name` | TEXT | NULL | Nome contatto |
| `source_vcard` | TEXT | NULL | Dati vCard |
| `caption` | TEXT | NOT NULL | Testo originale NLP |
| `parsed_message` | TEXT | NULL | Messaggio pulito dopo parsing |
| `scheduled_at` | TIMESTAMPTZ | NOT NULL | Quando inviare |
| `timezone` | TEXT | `'UTC'` | |
| `jitter_minutes` | INTEGER | 0 | Ritardo random anti-ban |
| `status` | TEXT | | `pending`, `processing`, `sent`, `failed`, `cancelled`, `paused`, `awaiting_confirm`, `awaiting_time`, `awaiting_recipient` |
| `sent_at` | TIMESTAMPTZ | NULL | |
| `retry_count` | INTEGER | 0 | |
| `max_retries` | INTEGER | 3 | |
| `wa_message_id` | TEXT | NULL | Per deduplicazione |
| `created_at` | TIMESTAMPTZ | NOW() | |
| `updated_at` | TIMESTAMPTZ | auto | |

**Indice ottimizzato:** `(status, scheduled_at) WHERE status = 'pending'`

### Tabella: `pending_contacts`

Rubrica contatti per ogni utente. Limiti per piano.

### Tabella: `profiles`

Profili utente collegati a Supabase Auth.

| Colonna | Tipo | Note |
|---|---|---|
| `id` | UUID | PK, FK auth.users.id ON DELETE CASCADE |
| `email` | TEXT | UNIQUE, NOT NULL |
| `full_name` | TEXT | |
| `phone_number` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### Tabella: `monitoring_checks`

Stato corrente di ogni health check (upsert ad ogni run).

| Colonna | Tipo |
|---|---|
| `check_name` | TEXT (PK) |
| `status` | TEXT (`ok`, `warning`, `critical`) |
| `message` | TEXT |
| `checked_at` | TIMESTAMPTZ |

### Tabella: `monitoring_alerts`

Storico alert inviati.

| Colonna | Tipo |
|---|---|
| `id` | UUID (PK) |
| `check_name` | TEXT |
| `status` | TEXT |
| `message` | TEXT |
| `channel` | TEXT (`whatsapp`, `email`, `db_only`) |
| `created_at` | TIMESTAMPTZ |

**Indice:** `(check_name, created_at DESC)` per query cooldown anti-spam

### Tabella: `webhook_logs`

Log debug per webhook processing.

### Tabella: `message_logs`

Audit trail operazioni messaggi.

| Colonna | Tipo |
|---|---|
| `id` | UUID |
| `message_id` | UUID FK scheduled_messages |
| `user_id` | UUID FK profiles |
| `log_type` | `created`, `parsed`, `scheduled`, `sent`, `failed`, `retry`, `cancelled` |
| `details` | JSONB |
| `error_message` | TEXT |

### Tabella: `system_status`

Singleton (id = 1) per stato globale sistema.

| Colonna | Tipo |
|---|---|
| `status` | `active`, `maintenance`, `degraded` |
| `message` | TEXT |

### RLS Policies

Tutte le tabelle hanno RLS abilitata. Ogni utente puo accedere solo ai propri dati (`auth.uid() = user_id`). `system_status` e leggibile da tutti, scrivibile solo con service role.

### Funzioni DB

- `update_updated_at_column()` — Trigger per auto-update timestamp
- `handle_new_user()` — Crea profilo su signup (trigger su auth.users)
- `get_pending_messages_to_send()` — 50 messaggi pending ordinati per scheduled_at
- `log_message_action(...)` — Inserisce audit log

---

## 5. FLUSSI PRINCIPALI

### 5.1 Pairing WhatsApp

```
Utente apre /connect (nuova pagina pairing-only)
  ↓
POST /api/auth/init { phone: "393..." }
  ↓
Backend:
  1. Valida phone con validatePhone()
  2. INSERT pending_auth_sessions (sessionId UUID, phone, status='pending', expires_at=now+10min)
  3. Cleanup user_instances duplicati + upsert con trial 7gg
  4. Force-delete istanza Evolution esistente
  5. POST /instance/create su Evolution API (con qrcode:true, webhook config)
  6. setWebhook (con WEBHOOK_SECRET nei headers)
  7. Estrae qrCode + pairingCode da response
  8. Ritorna { sessionId, instanceName, qrCode, pairingCode }
  ↓
Browser mostra QR/pairing + inizia polling GET /api/auth/check?sessionId=... ogni 2s
  ↓
Utente scansiona QR con WhatsApp dal proprio telefono
  ↓
Evolution API → webhook CONNECTION_UPDATE { state: 'open', ownerJid: '393...' }
  ↓
Backend webhook handler:
  1. Update user_instances.connection_status='open'
  2. Invio messaggio benvenuto/disclaimer
  3. UPDATE pending_auth_sessions SET status='authenticated', instance_name
     WHERE phone=ownerPhone AND status='pending' AND expires_at>NOW
  ↓
Polling /api/auth/check legge la riga:
  - status='authenticated' → server firma cookie HMAC-SHA256, Set-Cookie HttpOnly+Secure+SameSite=Lax+90d, DELETE session row
  - risponde { authenticated: true, redirect: '/dashboard' }
  ↓
Browser redirect a /dashboard. Cookie presente, middleware lo verifica su tutte le request successive.
```

### 5.2 Scheduling Messaggi (con AI)

```
Utente scrive nella chat "Note a se stesso":
  "Invia a Marco domani alle 15: Ricordati la riunione!"
  ↓
Evolution API → webhook MESSAGES_UPSERT
  ↓
POST /api/webhook:
  1. Verifica WEBHOOK_SECRET
  2. Solo self-chat (fromMe: true, remoteJid = owner)
  3. Deduplicazione (cache in-memory + DB wa_message_id)
  4. Identifica utente (match instance_name + phone)
  5. Chiama Groq AI con system prompt italiano
     - Input: testo utente + contatti salvati + messaggi pending
     - Output: { action: "schedule", recipient: "Marco", message: "Ricordati la riunione!", datetime: "2026-04-05T15:00:00+02:00" }
  6. Se AI fallisce → fallback OpenAI → fallback regex
  7. Cerca "Marco" nei pending_contacts per numero
  8. Salva in scheduled_messages con status "awaiting_confirm"
  ↓
Bot risponde su WhatsApp:
  "Messaggio per Marco (393...):
   'Ricordati la riunione!'
   Schedulato: domani alle 15:00
   Rispondi OK per confermare o ANNULLA per cancellare"
  ↓
Utente risponde "ok"
  ↓
Webhook → fast-path command → status = "pending"
  ↓
Bot conferma: "Messaggio confermato! Sara inviato domani alle 15:00"
```

### 5.2.1 Quick Capture (numero inline + dashboard modal)

**Flusso primario — Marco WhatsApp self-chat:**

```
Marco scrive nella self-chat:
  "Invia a Mario Cementi 3331234567 oggi alle 17: preventivo?"
  ↓
Webhook handler:
  1. Auth + dedup + self-chat check (esistente)
  2. extractInlinePhoneAndName(text) → { phone:"393331234567", name:"Mario Cementi" }
  3. AI prompt esteso riceve phone+name come context + "[Sistema: numero inline rilevato]"
  4. AI ritorna { action:"schedule", recipient_number, recipient_name, datetime, confidence }
  5. autoSaveContact(name, number) → salva in pending_contacts (se sotto limite, no overwrite)
  6. shouldSkipConfirm(aiResult, contactWasKnown, originalText) decide:
     - contatto noto + ora HH:MM esplicita + confidence='high' → skip
     - altrimenti → awaiting_confirm
  7. Se skip: INSERT con status='pending', bot risponde "✅ Schedulato. UNDO entro 60s"
  8. Se NO skip: INSERT con status='awaiting_confirm', bot chiede "Rispondi OK"
```

**Flusso secondario — Dashboard modal + deep-link:**

```
Marco apre /dashboard (cookie C1 valido) → bottone "+ Nuovo follow-up"
  ↓
QuickCaptureModal apre con 4 campi (Nome, Numero, Data/ora, Messaggio) + 3 chip preset
  ↓
Submit:
  1. Valida client-side (numero, messaggio, data futura ≥1min)
  2. Genera frase naturale via formatDatePhrase: "Invia a Mario Cementi 393... oggi alle 17: ..."
  3. window.location.href = `https://wa.me/<userPhone>?text=<encoded>`
  ↓
WhatsApp si apre (mobile native o WhatsApp Web) con frase precompilata nella self-chat
  ↓
Marco fa "Invia" → pipeline webhook identica al flusso primario (sopra)
```

**UNDO command:**

```
Marco scrive "undo" / "u" / "annulla" / "cancella" entro 60s da una conferma "✅ Schedulato"
  ↓
Webhook fast-path (prima dell'AI):
  - Trova ultimo scheduled_messages WHERE instance_phone=ownerPhone AND status='pending' AND created_at>NOW-60s
  - UPDATE status='cancelled' (CAS guard: solo se status='pending') → previene race con cron che ha già preso il messaggio
  - Bot risponde "✅ Annullato" o "Niente da annullare" o "Troppo tardi: il messaggio è già in invio"

Anti-collision: "annulla 3" (con numero) cade nel comando lista esistente (non triggera UNDO).
```

**Helper coinvolti** (file: `app/lib/quick-capture-utils.ts`, `app/lib/webhook-utils.ts`, `components/QuickCaptureModal.tsx`):
- `formatDatePhrase(date) → "oggi alle HH:MM" | "domani alle HH:MM" | "il DD/MM alle HH:MM"`
- `containsAmbiguousTimeKeyword(text)` — detect vague time keywords ("tra un po'", "stasera", ecc.)
- `hasExplicitHHMM(text)` — detect explicit HH:MM
- `extractInlinePhoneAndName(text)` — estrae numero + nome inline dal messaggio

**Zero schema DB changes.** Riusa `scheduled_messages` (status pending|awaiting_confirm), `pending_contacts`, `user_instances`.
```

### 5.2.2 UX /connect (redesign 2026-04-22)

La pagina `/connect` è stata ridisegnata per brand continuity con la landing:

- **Sfondo teal gradient + pattern** (utility `.connect-bg` in `globals.css`) — stesso look della landing page
- **Navbar slim** con logo WhatsLater
- **Stepper 3-step** sempre visibile (`components/ConnectStepper.tsx`) che tiene l'utente orientato nelle 4 fasi (input → pairing → connecting → error)
- **Pairing phase** include QR 192px in cornice verde, pairing-code alternativo, 3 passi numerati per trovare "Dispositivi collegati" in WhatsApp, countdown "scade in 10 min"
- **Error phase** mostra lo step dove è fallito (stepper rosso) + copy empatico + bottone Riprova + link "Torna al sito"

Nessun cambiamento backend. Auth cookie HMAC (C1) e logica di polling/webhook rimangono identici.

Riferimenti visivi: `screenshots/connect-final.html` (mockup di riferimento) e `docs/superpowers/specs/2026-04-22-connect-page-redesign-design.md` (spec).

### 5.3 Invio Messaggi (Cron)

```
Vercel cron (mezzanotte UTC) → GET /api/cron/send-messages?secret=...
  ↓
1. Cleanup: cancella awaiting_* > 1 ora
2. Reset contatori giornalieri
3. Downgrade trial scaduti → free
4. Fetch 25 messaggi pending con scheduled_at <= now
5. Per ogni messaggio (batch di 5):
   a. Valida: istanza connessa? trial attivo? limite giornaliero?
   b. Atomic lock: UPDATE status = 'processing' WHERE status = 'pending'
   c. Cool-down: max 3 msg allo stesso destinatario in 24h
   d. POST Evolution API /message/sendText/{instanceName}
      Body: { number: "393...@s.whatsapp.net", text: "...", options: { delay: 1200, presence: "composing" } }
   e. Successo → status = 'sent', incrementa messages_sent_today
   f. Fallimento → retry con backoff (5/10/15 min) oppure status = 'failed'
   g. A 80% limite → upsell WhatsApp (max 1/giorno)
6. Timeout guard: bail a 8s per rispettare limite Vercel 10s
```

### 5.4 Pagamenti Stripe

```
Utente clicca "Passa a Personal" in dashboard
  ↓
POST /api/payment/create-checkout { phone: "393...", plan: "personal" }
  ↓
Backend: trova/crea Stripe customer, crea Checkout Session (subscription)
  ↓
Redirect → Stripe Checkout hosted
  ↓
Utente paga → Stripe webhook checkout.session.completed
  ↓
POST /api/payment/webhook:
  1. Verifica signature Stripe
  2. Estrai phone e plan dai metadata
  3. UPDATE user_instances SET subscription_plan = 'personal'
  4. UPDATE stripe_customer_id
  5. Unpausa messaggi paused → pending
  6. Notifica utente via WhatsApp
  ↓
Cancellazione: Stripe Portal → customer.subscription.deleted → downgrade a 'free'
```

### 5.5 Monitoring

```
cron-job.org ogni 15 minuti → GET /api/monitoring/health-check?secret=...
  ↓
Esegue 6 check (ogni check isolato con try/catch):
  1. evolution_api → fetch con timeout 8s
  2. cron_stalled → messaggi pending da >25h
  3. webhook_inactive → nessun messaggio in 12h
  4. supabase_down → query DB base
  5. messages_stalled → messaggi stuck in processing
  6. failed_spike → >10 fallimenti in 2h
  ↓
Per ogni check non-ok:
  1. Controlla cooldown (1h anti-spam)
  2. Tenta WhatsApp al 393442582226
  3. Se fallisce → email Resend a musicizthekey@gmail.com
  4. Se fallisce → log solo DB
  ↓
Per ogni check tornato ok (recovery):
  Invia notifica "Risolto"
```

---

## 6. VARIABILI D'AMBIENTE

### Supabase
| Var | Obbligatoria | Note |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Si | URL pubblico Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Si | Chiave anon pubblica |
| `SUPABASE_SERVICE_ROLE_KEY` | Si (prod) | Chiave admin per operazioni server-side |

### Evolution API
| Var | Obbligatoria | Note |
|---|---|---|
| `EVOLUTION_API_URL` | Si | URL Evolution API sul droplet |
| `EVOLUTION_API_KEY` | Si | API key di autenticazione |

### AI
| Var | Obbligatoria | Note |
|---|---|---|
| `GROQ_API_KEY` | Si | AI primaria per parsing date (gratuita) |
| `OPENAI_API_KEY` | Fallback | Usata solo se Groq non disponibile |

### Stripe
| Var | Obbligatoria | Note |
|---|---|---|
| `STRIPE_SECRET_KEY` | Si | Chiave segreta Stripe |
| `STRIPE_WEBHOOK_SECRET` | Si | Per verifica signature webhook |
| `STRIPE_PRICE_PERSONAL` | Si | Price ID piano Personal (€4,99/mese) |
| `STRIPE_PRICE_BUSINESS` | Si | Price ID piano Business (€19,99/mese) |

### Sicurezza
| Var | Obbligatoria | Note |
|---|---|---|
| `WEBHOOK_SECRET` | Si | Valida richieste da Evolution API |
| `CRON_SECRET` | Si | Protegge cron job + debug logs |
| `MONITORING_SECRET` | Si | Protegge admin + monitoring endpoints |
| `AUTH_COOKIE_SECRET` | Si | HMAC secret per firma cookie sessione (64 byte hex). App fallisce hard al boot se assente |

### Notifiche
| Var | Obbligatoria | Note |
|---|---|---|
| `RESEND_API_KEY` | Si | Email fallback per alert (no SDK, raw fetch) |

### Applicazione
| Var | Obbligatoria | Note |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | No | Default: `https://whatslaterpush.vercel.app` |
| `SYSTEM_STATUS` | No | `active` (default), `maintenance`, `degraded` |

---

## 7. DEPLOYMENT

### Architettura di deployment

```
                        ┌──────────────┐
                        │   Browser    │
                        └──────┬───────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
              ┌─────▼─────┐        ┌─────▼─────┐
              │  Vercel    │        │  Vercel    │
              │  Frontend  │        │  API       │
              │  (SSR)     │        │  Routes    │
              └─────┬──────┘        └──┬──┬──┬──┘
                    │                  │  │  │
          ┌────────┴──┐    ┌──────────┘  │  └──────────┐
          │           │    │             │              │
    ┌─────▼─────┐ ┌───▼────▼──┐  ┌──────▼─────┐  ┌────▼────┐
    │ Supabase  │ │ Evolution │  │   Stripe   │  │  Groq   │
    │ (DB+Auth) │ │ API       │  │ (Payments) │  │ (AI)    │
    │ Cloud     │ │ Droplet   │  │ Cloud      │  │ Cloud   │
    └───────────┘ │ DO 2GB    │  └────────────┘  └─────────┘
                  │ 1 vCPU    │
                  │ Coolify   │
                  └───────────┘
```

### Vercel (Frontend + API + Cron)

- **URL:** `https://whatslaterpush.vercel.app`
- **Deploy:** Automatico da Git push
- **Build:** `next build` con `output: standalone`
- **Cron:** `/api/cron/send-messages` ogni giorno a mezzanotte UTC
- **Env vars:** Configurate in Vercel dashboard
- **Scaling:** Serverless automatico (non e un collo di bottiglia)

### DigitalOcean Droplet (Evolution API)

- **IP:** `161.35.212.68`
- **Spec:** 2GB RAM, 1 vCPU, $16/mese
- **OS:** Linux (gestito da Coolify)
- **Coolify:** Container orchestrator, gestisce Docker
- **Container:** `api-pkso00o0ccoc8ccgos8ks4cw` (Evolution API)
- **URL:** `http://evo-pkso00o0ccoc8ccgos8ks4cw.161.35.212.68.sslip.io`
- **Capacita:** ~30 istanze WhatsApp simultanee (stress test 3 Aprile 2026)
- **SSH:** `ssh root@161.35.212.68`
- **Nessun Redis/MongoDB** — solo Evolution API + overhead Coolify

### Supabase (Database)

- **Tipo:** PostgreSQL managed (cloud)
- **Auth:** Email/password con conferma email
- **RLS:** Abilitata su tutte le tabelle
- **Generazione tipi:** `npx supabase gen types typescript`

### Trigger esterni

- **cron-job.org:** Health check ogni 15 minuti → GET `/api/monitoring/health-check?secret=...`
- **Vercel cron:** Invio messaggi ogni giorno a mezzanotte UTC

---

## 8. INTEGRAZIONI ESTERNE

### Evolution API v2 (WhatsApp)

Client HTTP diretto (nessun SDK npm). Singleton in `lib/evolution/client.ts`.

| Endpoint Evolution API | Metodo | Uso in WhatsLater |
|---|---|---|
| `/instance/create` | POST | Crea nuova istanza WhatsApp |
| `/instance/connect/{name}` | GET/POST | QR code o pairing code |
| `/instance/pairingCode/{name}` | POST | Pairing code alternativo |
| `/instance/connectionState/{name}` | GET | Stato connessione |
| `/instance/fetchInstances` | GET | Lista istanze + ownerJid |
| `/instance/logout/{name}` | DELETE | Logout |
| `/instance/delete/{name}` | DELETE | Elimina istanza |
| `/message/sendText/{name}` | POST | Invia messaggio testo |
| `/webhook/set/{name}` | POST | Configura webhook |
| `/webhook/find/{name}` | GET | Verifica config webhook |

**Autenticazione:** Header `apikey: EVOLUTION_API_KEY`
**Timeout:** 8s (configurato nel client)
**Webhook eventi:** `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED`

### Groq (AI primaria)

- **Uso:** Parsing linguaggio naturale italiano → data/ora/destinatario/messaggio
- **Modello:** Configurato via `GROQ_API_KEY`
- **Endpoint:** API standard compatibile OpenAI
- **Costo:** Gratuito (tier free)
- **Fallback:** Se Groq non risponde → OpenAI → regex

### Stripe

| Funzionalita | Endpoint Stripe | File WhatsLater |
|---|---|---|
| Checkout subscription | Checkout Sessions | `/api/payment/create-checkout` |
| Customer Portal | Billing Portal | `/api/payment/portal` |
| Webhook | Events | `/api/payment/webhook` |

**Piani:**
- Personal: €4,99/mese (price ID in `STRIPE_PRICE_PERSONAL`)
- Business: €19,99/mese (price ID in `STRIPE_PRICE_BUSINESS`)

**Flussi:** Checkout → subscription.created → user upgrade / subscription.deleted → user downgrade

### Resend (Email)

- **Uso:** Fallback alerting quando WhatsApp non e raggiungibile
- **Da:** `onboarding@resend.dev` (default Resend, no dominio custom)
- **A:** `musicizthekey@gmail.com`
- **Integrazione:** Raw fetch (`POST https://api.resend.com/emails`), nessun SDK
- **Costo:** Tier gratuito

---

## Appendice: Limiti per Piano

| | Trial | Free | Personal | Business |
|---|---|---|---|---|
| **Prezzo** | Gratis (7gg) | Gratis | €4,99/mese | €19,99/mese |
| **Messaggi/giorno** | 20 | 3 | 20 | 50 |
| **Contatti** | 50 | 5 | 50 | Illimitati |
| **Retry** | 3 | 1 | 3 | 3 |
| **Storico** | 30 giorni | 7 giorni | 30 giorni | 90 giorni |
| **Cool-down** | 3/dest/24h | 3/dest/24h | 3/dest/24h | 3/dest/24h |
| **Rate limit** | 15/min | 15/min | 15/min | 15/min |

---

## Appendice: Design System

| Token | Valore | Uso |
|---|---|---|
| Primary | `#25D366` | WhatsApp green — azioni, CTA |
| Primary hover | `#1DA851` | Hover states |
| Accent | `#075E54` | Header, footer, dark teal |
| Teal | `#128C7E` | Link, hover secondari |
| Text primary | `#111B21` | Testo principale |
| Text secondary | `#667781` | Testo secondario, placeholder |
| Chat bg | `#ECE5DD` | Sfondo chat WhatsApp |
| Message bg | `#DCF8C6` | Bolla messaggio inviato |
| Border | `#E9EDEF` | Bordi soft |
| Shadow soft | `0 8px 30px rgba(0,0,0,0.04)` | Card |
| Font body | Inter | Testo |
| Font heading | Space Grotesk | Titoli |
| Border radius | `rounded-2xl` / `rounded-3xl` | Card, input |
