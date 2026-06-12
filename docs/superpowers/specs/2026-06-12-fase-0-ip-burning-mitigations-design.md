# Fase 0 — Mitigazioni IP burning Baileys

**Date:** 2026-06-12
**Status:** Draft, pending GrillMe + Codex review

## Contesto

Il droplet DigitalOcean che ospita Evolution v2.3.7 (Baileys) ha l'IP/ASN "bruciato" da Meta: i nuovi pairing falliscono sistematicamente con `CONNECTION_UPDATE state=close code=401 loggedOut`. Sessioni già autenticate sopravvivono. Il problema è strutturale — un singolo IP che processa molti pairing nuovi in poco tempo è interpretato come bot-farm. Il lancio (burst di iscrizioni) sarebbe il momento peggiore.

Il monitoring lato app rileva già il pattern (`checkPairingBlackout` in `app/lib/monitoring.ts:252-284` → `CRITICAL` quando ≥5 `pairing_started` / 0 `pairing_completed` su 24h; `checkInstanceFlapping` flagga code 403). Manca tutto il livello di **mitigazione operativa**: rate limit a monte, fallback umano, esperimenti su pinning, copertura legale.

Fase 0 chiude la finestra immediata: sblocca i primi 5–20 paganti senza spendere un euro di infra e senza ulteriore esposizione legale, mentre Fase 2 (multi-droplet routing) e Fase 3 (premium pool) restano in backlog per dopo PMF.

## Goal

Implementare cinque mitigazioni indipendenti ma coordinate:

1. **Rate limit `/api/auth/init`** a 3 pairing/IP/24h con risposta `429` strutturata.
2. **Form "richiedi attivazione"** in coda quando il quota IP è saturo, con persistenza + notifica admin.
3. **Runbook concierge** documentato per onboarding manuale dal IP residenziale del founder.
4. **Esperimento controllato** di pinning WhatsApp Web client version su istanza Evolution staging separata.
5. **Disclaimer ToS** che dichiara esplicitamente best-effort delivery e dipendenza da Meta.

## Non-goals

- Multi-droplet routing, failover automatico tra IP, `server_url` column (rimandato a Fase 2).
- Integrazione provider managed tipo Whapi/Wassenger (Strategic Trap per tier €4.99, fuori Fase 0).
- Captcha sul form di attivazione (defer fino a primo abuso reale).
- Telegram bot per notifica admin (riusa audit fix #8 Sprint 7 backlog, qui solo webhook generico).
- Modifiche al tier pricing (decisione strategica separata).
- Modifica del watchdog `pairing_blackout` o `flapping` (già operativi, non toccare).

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│                       /connect (page.tsx)                          │
│                                                                    │
│   Step 1: phone input → POST /api/auth/init                       │
│      ├─ 200 OK: pairing code → Step 2 (existing flow)             │
│      └─ 429 quota_exceeded: → Step 1b (NEW activation form)       │
│                                                                    │
│   Step 1b: POST /api/auth/request-activation                      │
│      └─ 200 → confirmation screen "ti contattiamo entro 24h"      │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      /api/auth/init (modified)                     │
│                                                                    │
│   1. validatePhone                                                 │
│   2. NEW: extractSourceIp(req)                                    │
│   3. NEW: checkPairingRateLimit(source_ip)                        │
│      ├─ count audit_events WHERE event_type='pairing_started'     │
│      │   AND payload->>'source_ip' = $1                           │
│      │   AND created_at > NOW() - INTERVAL '24h'                  │
│      └─ if count >= PAIRING_RATE_LIMIT_PER_DAY → return 429        │
│   4. existing Evolution instance/create flow                       │
│   5. logAuditEvent('pairing_started', {instance_name, source_ip}) │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│              /api/auth/request-activation (NEW)                    │
│                                                                    │
│   1. validatePhone, sanitize name/note                            │
│   2. anti-spam: count submissions WHERE source_ip=$1               │
│      AND requested_at > NOW() - INTERVAL '1h' → if >=1, return 429│
│   3. INSERT INTO activation_requests (...)                        │
│   4. fire-and-forget POST ACTIVATION_NOTIFY_WEBHOOK_URL           │
│   5. return 200 {ok: true}                                        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1 — Rate limit `/api/auth/init` (3 pairing/IP/24h)

### Goal
Smorzare il segnale "burst di pairing da singolo IP" che Meta interpreta come bot-farm. Non ferma il ban se l'IP è già bruciato, ma evita di peggiorarlo e dà tempo al watchdog di alzare l'alert prima della saturazione.

### Decisione architetturale
**Counter via `audit_events` esistente, NON nuova tabella.**

Il watchdog `pairing_blackout` legge già `audit_events WHERE event_type IN ('pairing_started','pairing_completed')`. Aggiungere `source_ip` al payload di `pairing_started` permette di riusare quella stessa tabella come counter. Vantaggi: zero nuova schema, zero nuovo indice (solo GIN/btree esistente), single source of truth per i pattern di pairing.

**Alternativa considerata**: tabella `pairing_attempts` dedicata. Scartata perché duplica dati con `audit_events` e introduce un'altra tabella da prunare.

**Alternativa considerata**: Redis/Vercel KV. Scartata perché ne servirebbe l'installazione, e siamo nel range "qualche query/giorno", non rate-limit ad alto throughput.

### Identificazione IP
Vercel: `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()`. Fallback su `request.headers.get('x-real-ip')`. Ultimo fallback: stringa `'unknown'` (loggata in Sentry come warning — se vediamo `'unknown'` significa che siamo dietro proxy non previsto).

**Caveat noto**: utenti dietro NAT (es. Wi-Fi pubblico, hotspot 4G) condividono IP. Pre-launch a 0 paganti, accettabile. Se diventa un blocker reale, fallback Fase 1.5 = combinare IP+phone-prefix come chiave.

### Schema audit_events
Nessuna migration. `audit_events.payload` è già `JSONB`. Estensione informale:

**Prima**: `{ instance_name }`
**Dopo**: `{ instance_name, source_ip }`

Query rate limit:
```sql
SELECT count(*)::int FROM audit_events
WHERE event_type = 'pairing_started'
  AND payload->>'source_ip' = $1
  AND created_at > NOW() - INTERVAL '24 hours';
```

Performance: low cardinality (decine di righe/giorno pre-launch), JSON ->> filter su event_type + created_at è instantaneo con index esistente su `(event_type, created_at)`. **Verificare in implementazione**: query `\d audit_events` su Supabase Studio. Se index mancante, aggiungere `CREATE INDEX CONCURRENTLY idx_audit_events_type_created ON audit_events(event_type, created_at)` come piggyback Fase 0 (migration separata `20260612_audit_events_index.sql`). Se presente, no action.

### Comportamento API

**Quando counter < CAP**: comportamento attuale invariato (Evolution `instance/create`, ritorna `{sessionId, pairingCode}`, emette `pairing_started`).

**Quando counter >= CAP**: ritorna HTTP `429` con body:
```json
{
  "error": "pairing_quota_exceeded",
  "message": "Limite giornaliero pairing raggiunto. Richiedi attivazione manuale.",
  "next_steps": {
    "form_path": "/connect?step=activation-request"
  },
  "retry_after_hours": 24
}
```

Frontend `/connect/page.tsx` intercetta 429 → swap a Step 1b form invece di Step 2 pairing code.

### Bypass

| Scenario | Bypass meccanismo |
|---|---|
| Andrea / admin testing | Header `x-pairing-bypass: $OPS_SECRET` |
| IP residenziale founder (concierge mode) | Env var `PAIRING_RATE_LIMIT_BYPASS_IPS` (comma-sep CIDR list) |
| Tutti gli IP (rollback emergenza) | Env var `PAIRING_RATE_LIMIT_ENABLED=false` |

### Concurrency / race
Check + write non sono atomici. Race window: 2 request da stesso IP in <100ms passano entrambe il check, generano 2 `pairing_started`. Worst case (4-5 simultanei) = piccolo overshoot del CAP. Accettato: la mitigazione è statistica, non bancaria. Nessun lock distribuito.

### Test
- Unit: `checkPairingRateLimit` returns 429 quando counter >= CAP, 200 quando counter < CAP, 200 quando bypass header presente.
- Unit: extractSourceIp gestisce `x-forwarded-for` multi-IP, fallback, missing headers.
- Integration: POST `/api/auth/init` 4 volte con stesso IP fittizio → 3 successi + 1 429 con body strutturato.
- Integration: 429 + retry con `x-pairing-bypass=$OPS_SECRET` → 200.

---

## 2 — Form "richiedi attivazione" (overflow queue)

### Goal
Quando un utente colpisce il rate limit (o quando il watchdog `pairing_blackout` è in stato critical), offrire un percorso umano: form di richiesta → notifica Andrea → contatto manuale entro 24h via WhatsApp/email.

### Schema `activation_requests` (NEW)

```sql
CREATE TABLE activation_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164      TEXT NOT NULL,
  display_name    TEXT,
  note            TEXT,
  source_ip       TEXT,
  user_agent      TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','contacted','onboarded','rejected','spam')),
  contacted_at    TIMESTAMPTZ,
  notes_admin     TEXT,
  CONSTRAINT name_len CHECK (display_name IS NULL OR char_length(display_name) <= 100),
  CONSTRAINT note_len CHECK (note IS NULL OR char_length(note) <= 500)
);

CREATE INDEX idx_activation_requests_status ON activation_requests(status, requested_at);
CREATE INDEX idx_activation_requests_phone ON activation_requests(phone_e164);
```

RLS: `ENABLE` con default `DENY`. Solo service-role può read/write (no anon access — consistente con hardening RLS post-Sprint 5).

Retention: nessuna cron retention iniziale (volume basso). Quando arriva il volume, prune row con `status IN ('rejected','spam','onboarded')` e `requested_at < NOW() - 90d`.

### Endpoint `POST /api/auth/request-activation` (NEW)

Body:
```json
{
  "phone": "+393331234567",
  "display_name": "Mario Rossi",
  "note": "Allenatore U12 — squadra di Bergamo"
}
```

Logica:
1. `validatePhone(phone)` (riusa `lib/phone.ts`).
2. Sanitize: `display_name.trim().slice(0, 100)`, `note.trim().slice(0, 500)`.
3. Anti-spam form-level: `count activation_requests WHERE source_ip = $1 AND requested_at > NOW() - INTERVAL '1 hour'` → se ≥1, ritorna 429 `{error: 'too_many_requests', message: 'Hai già inviato una richiesta nell\'ultima ora.'}`.
4. Anti-duplicate: `count activation_requests WHERE phone_e164 = $1 AND status IN ('pending','contacted') AND requested_at > NOW() - INTERVAL '7 days'` → se ≥1, ritorna 200 con `{ok: true, status: 'already_pending'}` (silenzioso, no error).
5. `INSERT INTO activation_requests (...)`.
6. Fire-and-forget POST a `ACTIVATION_NOTIFY_WEBHOOK_URL` env var (se settato) con payload `{phone, display_name, note, requested_at, id}`. Timeout 3s. Errore loggato in Sentry, NON blocca la response.
7. Audit event `activation_requested` (payload: `{phone_hash, source_ip}` — phone HASHED via `scrubPiiForLog` esistente per coerenza GDPR).
8. Return 200 `{ok: true, message: 'Richiesta ricevuta. Ti contattiamo entro 24h.'}`.

### Flow UI in `/connect/page.tsx`

Nuovo state intermedio `activation-request` fra Step 1 e Step 2:

- Trigger: `/api/auth/init` ritorna 429.
- Form: phone (pre-popolato da Step 1, read-only), display_name (richiesto), note (opzionale, placeholder "Es. allenatore U12 a Bergamo").
- Submit: POST `/api/auth/request-activation`.
- Success: schermata di conferma con CTA "Torna alla home" + email di follow-up (se mai implementato — per ora solo testo).
- Error 429 anti-spam: messaggio inline "Hai già richiesto. Andrea ti contatta presto."

UI follow-up del WhatsApp-native style esistente (vedi `2026-05-18-whatsapp-schedule-modal-design.md`): dark theme, accent verde, full-screen mobile.

### Notifica admin
- Env var `ACTIVATION_NOTIFY_WEBHOOK_URL` opzionale. Se settata → POST JSON. Se NO → fallback: solo audit event, Andrea legge da query SQL manuale (`SELECT * FROM activation_requests WHERE status='pending' ORDER BY requested_at`).
- Webhook payload: `{type: 'activation_requested', phone, display_name, note, source_ip, requested_at, id}`. Compatibile con qualunque endpoint (Telegram bot, Discord, Make.com, ntfy.sh, email-via-Resend).
- **Decisione delegata**: lo specifico target webhook (Telegram?) è scelta di config, non parte dello spec.

### Test
- Unit: validate happy-path, max-length truncation, anti-spam ritorna 429 entro 1h.
- Unit: anti-duplicate ritorna 200 `already_pending` per phone già in queue.
- Integration: POST → riga creata + audit event + webhook fire (mockato).
- Integration: webhook timeout 3s non fa fallire l'endpoint.
- E2E: utente colpisce 429 su `/api/auth/init` → vede form → submit → vede conferma.

---

## 3 — Runbook concierge onboarding manuale

### Goal
Procedura ripetibile per Andrea: pairing manuale da connessione residenziale (IP "pulito" lato Meta), poi trasferimento file di sessione Baileys al droplet. La sessione, una volta autenticata, regge il salto IP perché WhatsApp riconosce il device-key non l'IP corrente.

### Output
Documento `docs/runbook/concierge-pairing.md` (la directory `docs/runbook/` non esiste ancora, viene creata in questa fase). Pure markdown, niente codice nuovo — è documentazione operativa.

### Struttura del runbook

```
# Concierge pairing manuale

## Quando usarlo
- Utente in coda activation_requests con status=pending
- Watchdog pairing_blackout in stato critical
- Test pairing per esperimenti (Fase 0 §4)

## Pre-requisiti
- Laptop Andrea con Docker installato
- Connessione 4G hotspot da phone Andrea (NO Wi-Fi datacenter / VPS / sede co-working)
- Verificare IP residenziale: curl ifconfig.me → confronta con range fisso ISP
- Accesso SSH al droplet 161.35.212.68
- Phone dell'utente raggiungibile (WhatsApp call o chat)

## Procedura (8 step, ~20 minuti)

### Step 1 — Setup Evolution locale
docker run -d --name evo-concierge \
  -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=$LOCAL_KEY \
  evoapicloud/evolution-api:v2.3.7

### Step 2 — Crea istanza locale con il numero dell'utente
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $LOCAL_KEY" -H "Content-Type: application/json" \
  -d '{
    "instanceName":"SchedWhats-{phone}",
    "number":"{phone}",
    "qrcode":true,
    "integration":"WHATSAPP-BAILEYS",
    "syncFullHistory":false,
    "alwaysOnline":true
  }'

### Step 3 — Richiedi pairing code
curl -X GET "http://localhost:8080/instance/connect/SchedWhats-{phone}?number={phone}" \
  -H "apikey: $LOCAL_KEY"

### Step 4 — Trasmetti codice all'utente
Chiama l'utente, comunica il pairing code, guidalo nel:
WhatsApp → Impostazioni → Dispositivi collegati → Collega un dispositivo → con telefono.

### Step 5 — Attendi state=open
Polling locale ogni 5s su:
curl http://localhost:8080/instance/connectionState/SchedWhats-{phone} \
  -H "apikey: $LOCAL_KEY"
Aspetta state="open". Timeout 5 min.

### Step 6 — Stop istanza locale + estrai session files
docker exec evo-concierge tar -czf /tmp/session.tar.gz /evolution/instances/SchedWhats-{phone}
docker cp evo-concierge:/tmp/session.tar.gz ./session-{phone}.tar.gz

### Step 7 — Upload al droplet + restart Evolution
scp session-{phone}.tar.gz root@161.35.212.68:/tmp/
ssh root@161.35.212.68 'cd / && tar -xzf /tmp/session-{phone}.tar.gz \
  && chown -R 1000:1000 /evolution/instances/SchedWhats-{phone}'
# Coolify webhook restart container OR ssh sudo systemctl restart evolution

### Step 8 — Verifica + crea user_instances + segna activation_request
curl https://whatslaterpush.vercel.app/api/ops/evolution/instances?secret=$OPS_SECRET
# verifica che SchedWhats-{phone} appaia con state=open

# update DB:
UPDATE activation_requests SET status='onboarded', contacted_at=NOW()
  WHERE phone_e164='{phone}' AND status='pending';
INSERT INTO user_instances (phone_number, instance_name, connection_status)
  VALUES ('{phone}', 'SchedWhats-{phone}', 'open');
# emette pairing_completed audit event a mano se serve coerenza watchdog

## Caveat e troubleshooting
- Se Step 5 NON arriva mai a state=open: anche il TUO IP residenziale è bruciato
  (rare, ma se l'utente è in una zona con cattivi pattern recenti). Fallback:
  rimanda al backlog Fase 2.
- Se Step 7 fallisce post-restart con stesso 401 loggedOut: session file
  corrotti o version mismatch Evolution. Verifica versione Evolution droplet =
  versione locale (v2.3.7 entrambe).
- Concierge usa la TUA reputation IP. Cap: massimo 5 pairing/giorno dal tuo IP
  per non bruciarlo. Sopra, distribuisci su giorni diversi.
- Conserva i session-*.tar.gz cifrati per 7 giorni come backup re-pair (poi
  shred).

## Quando NON usare il concierge
- Se utente è in tier free (non pagante). Concierge è solo per Personal+.
- Se hai >2 pairing già fatti oggi dal tuo IP residenziale.
- Se Phase 2 (multi-droplet) è disponibile: routing automatico è meglio.
```

### Sicurezza operativa
- `LOCAL_KEY` per Evolution Docker locale: generato monouso, non riusato.
- Session files contengono crediti Baileys: trattare come secret. `.gitignore` su pattern `session-*.tar.gz`.
- SSH key root@droplet: già esistente, no cambiamenti.

### Test
Non testabile automaticamente (procedura manuale). Validation = primo concierge eseguito su utente reale post-spec approvato, con cronologia annotata in `AndreaVault/decisions.md`.

---

## 4 — Esperimento Baileys version pin

### Goal
Verificare se cambiare la **WhatsApp Web client version** che Evolution impersona riduce il rate di ban sui nuovi pairing. È un **esperimento**, non un commit di feature: l'output è "pin sì / pin no / inconclusivo".

### Decisione architetturale
**Container Evolution separato (`evolution-staging`)**, non modifiche al container prod. Coolify supporta multi-container sullo stesso droplet (compatibilmente con RAM disponibile; misurare: droplet è a ~60% RAM dopo cleanup recente, headroom ~800MB sufficiente per un secondo Evolution lite).

**Alternativa considerata**: modificare prod e rollback se peggio. Scartata: rischio di rompere le sessioni attive degli utenti esistenti (anche poche, ma valgono).

### Cosa cambia
Due dimensioni di sperimentazione:

1. **WhatsApp Web client version** (impersonata in Noise handshake).
   - Env var Evolution v2 da identificare in implementation (probabili candidati: `CONFIG_SESSION_PHONE_VERSION`, `WA_VERSION`, o documentato in evolution-api/v2 docs).
   - Pin a 2-3 versioni candidate (es. ultima `2.3000.X`, una di 2-3 mesi fa, una più vecchia).

2. **Config Evolution / Baileys options** che potrebbero ridurre detection:
   - `markOnlineOnConnect: false` (riduce signal "sempre online" sospetto su personal).
   - `syncFullHistory: false` (già attivo prod).
   - `alwaysOnline: true` — **da rivalutare**: rendere `false` perché un personal sempre online è anomalo.
   - Browser fingerprint Baileys: nome device, OS, versione browser passati al handshake (Baileys defaults sono noti, Meta potrebbe profilarli).

### Setup staging

1. Crea applicazione Coolify `evolution-staging` su porta diversa (es. 8081 invece di 8080), DNS interno `evolution-staging.internal` o accesso solo via IP+porta.
2. Stesso volume Postgres separato (`evolution_staging_db`) o stesso DB con prefisso istanza diverso (es. `STG-SchedWhats-{phone}`).
3. Env vars staging differ da prod sulle dimensioni sotto esperimento.
4. Webhook URL → `/api/webhook?staging=true` (passa flag query param per distinguere eventi staging dagli eventi prod nei log).

### Metriche

Pairing test plan:
- 3 pairing test al giorno per 7 giorni (totale 21 pairing).
- Numeri test: usa numeri Twilio temporanei o accordi con 2-3 beta-tester ICP D disposti a fare re-pair.
- Per ogni tentativo registra: `staging_run_id`, `timestamp`, `wa_version_pinned`, `markOnlineOnConnect`, `outcome` (success/fail), `disconnect_code` (se fail).
- Tabella temporanea `pairing_experiments` (drop dopo esperimento):

```sql
CREATE TABLE pairing_experiments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          TEXT NOT NULL,
  phone           TEXT NOT NULL,
  wa_version      TEXT,
  always_online   BOOLEAN,
  mark_online     BOOLEAN,
  attempted_at    TIMESTAMPTZ DEFAULT NOW(),
  outcome         TEXT CHECK (outcome IN ('pending','success','fail_401','fail_403','fail_other')),
  disconnect_code INTEGER,
  disconnect_reason TEXT,
  notes           TEXT
);
```

### Decisione gate

Dopo 7 giorni:
- Se ≥2/3 pairing success su almeno una combo (vs baseline atteso ~0/3 su prod) → **promote**: sposta config staging → prod via env vars, dismetti container staging.
- Se 0–1/3 success su tutte le combo → **inconclusivo**: chiudi esperimento, NON modificare prod. Documenta findings in `AndreaVault/decisions.md` come DA-RIVEDERE.
- Se peggio del baseline → archivia config e considera Fase 2 prioritaria.

### Rollback / pulizia post-esperimento
- Stop e remove container `evolution-staging` da Coolify.
- DROP TABLE `pairing_experiments`.
- Migrazione no-op: lo stato prod non è stato toccato.

### Effort
2–3h setup + 7 giorni osservazione passiva + 1h analisi. **Non bloccante** per altri item Fase 0 — può essere parallelo.

### Test
- Smoke: container staging risponde su porta dedicata.
- Watchdog: assicurare che `pairing_blackout` NON conti gli `staging` eventi (filter su `payload->>'staging' != 'true'`), per non sporcare l'allarme prod.

---

## 5 — Disclaimer ToS fragilità delivery

### Goal
Mettere per iscritto che il servizio è best-effort, dipende da Meta, non garantisce delivery né uptime. Riduce esposizione legale in caso di incident (sospensione 24-72h, ban WhatsApp di un utente, modifica unilaterale API).

### Modifiche a `app/terms/page.tsx`

Aggiunta di nuova sezione "Service-Level e Limitazioni Tecniche" prima della sezione "Limitazione di Responsabilità" esistente. Aggiornamento `Ultimo aggiornamento: 12 giugno 2026`.

Contenuto (italiano, registro coerente con sezioni esistenti):

```
## N. Service-Level e Limitazioni Tecniche

Il Servizio si appoggia su API non ufficiali di WhatsApp (Meta Platforms Ireland Ltd.) per
inviare messaggi dal tuo numero personale. Questa scelta tecnica è la sola che consente di
preservare l'identità personale del mittente, ma comporta limitazioni e rischi che accetti
esplicitamente utilizzando il Servizio:

a) **Nessuna garanzia di uptime.** Il Servizio è fornito "as-is" e in modalità best-effort.
   Non garantiamo continuità del servizio, e non esistono SLA contrattuali. Interruzioni
   anche prolungate (fino a 72 ore o più in caso di incident upstream) sono possibili e non
   danno diritto a rimborsi parziali, salvo dove imposto dalla normativa applicabile.

b) **Nessuna garanzia di delivery.** Non garantiamo che i messaggi programmati vengano
   consegnati. Variabili fuori dal nostro controllo (stato del tuo account WhatsApp,
   modifiche unilaterali Meta delle policy o delle API, blocchi temporanei o permanenti
   imposti da Meta, indisponibilità della rete) possono causare perdita o ritardo dei
   messaggi.

c) **Dipendenza da Meta.** Il Servizio può essere sospeso, degradato o terminato in
   qualsiasi momento per cause esterne, incluse modifiche tecniche di Meta o decisioni
   commerciali della stessa. In caso di interruzione strutturale e permanente non
   risarcibile, il Servizio cessa con preavviso minimo di 14 giorni; la quota residua del
   periodo prepagato in corso viene rimborsata pro-rata.

d) **Responsabilità sull'account WhatsApp.** L'utilizzo del Servizio comporta il rischio
   teorico che Meta classifichi il tuo account come automatizzato e applichi limitazioni
   (riduzione capacità di invio) o sospensione. Il Servizio è disegnato per minimizzare
   questo rischio (rate limiting, distribuzione temporale, no broadcast), ma non lo
   elimina. Non siamo responsabili per blocchi o sospensioni del tuo account WhatsApp
   derivanti dall'utilizzo del Servizio.

e) **Esclusione casi d'uso vietati.** Confermi che non userai il Servizio per: messaggi
   commerciali a destinatari non consenzienti, attività di marketing massivo, contatti
   freddi (cold outreach), o qualsiasi attività in violazione delle WhatsApp Business
   Terms o della normativa europea (GDPR, ePrivacy). La violazione è giusta causa di
   risoluzione del Servizio senza rimborso.
```

### Decisione
Aggiungiamo come sezione numerata coerente con sequenza esistente (verificare numerazione corrente: `app/terms/page.tsx` ha sezioni 1-N — la nuova si infila prima della "Limitazione di Responsabilità" generale).

### Test
- Visual: dev server `npm run dev`, naviga `/terms`, verifica sezione nuova, numerazione, link Logo.
- Nessun unit test richiesto (contenuto statico).

### Roll-out
Pre-launch (0 paganti), nessuna notifica utenti esistenti necessaria. Banner "Termini aggiornati" deferred fino post-launch.

---

## Data model changes — riassunto

| Change | Type | Migration | Reason |
|---|---|---|---|
| `audit_events.payload.source_ip` (informal extension) | Schema-less | No migration | Rate limit counter §1 |
| `activation_requests` table | New | New migration `20260612_activation_requests.sql` | Overflow form §2 |
| `pairing_experiments` table | New temporary | Migration `20260612_pairing_experiments.sql` + future DROP | Esperimento §4 |
| Index su `audit_events(event_type, created_at)` | Verify | Optional migration if missing | §1 performance |

---

## Env vars nuove

| Name | Required | Default | Where used |
|---|---|---|---|
| `PAIRING_RATE_LIMIT_PER_DAY` | no | `3` | §1 rate limit cap |
| `PAIRING_RATE_LIMIT_ENABLED` | no | `true` | §1 kill switch rollback |
| `PAIRING_RATE_LIMIT_BYPASS_IPS` | no | (empty) | §1 bypass concierge IP |
| `ACTIVATION_NOTIFY_WEBHOOK_URL` | no | (empty) | §2 admin notify |
| `EVOLUTION_STAGING_URL` | no | (empty) | §4 staging container target |
| `EVOLUTION_STAGING_API_KEY` | no | (empty) | §4 staging auth |

`x-pairing-bypass` header riusa `$OPS_SECRET` esistente, no nuova var.

---

## Testing plan globale

### Unit (Jest)
- §1: `lib/rate-limit-pairing.ts` (nuovo) — happy path, cap hit, bypass header, bypass IP, missing forwarded-for fallback.
- §2: `lib/activation-request.ts` (nuovo) — validate, sanitize, anti-spam window, anti-duplicate.
- Riusa fixtures `audit_events` esistenti.

### Integration (Jest)
- §1: POST `/api/auth/init` 4× same IP → 3×200 + 1×429 con body strutturato.
- §1: 429 + bypass header `x-pairing-bypass=$OPS_SECRET` → 200.
- §2: POST `/api/auth/request-activation` happy path → 200 + row inserted + webhook called (mocked).
- §2: POST × 2 from same IP in <1h → 2nd ritorna 429.
- §2: POST con phone già pending → 200 `already_pending`.

### E2E (Playwright — opzionale, esistono già 7 spec)
- `/connect` flow: 429 trigger → form mostrato → submit → conferma.

### Manuale
- §3 concierge: primo run con 1 utente reale post-merge.
- §4 staging: 7 giorni osservazione passiva, log in `pairing_experiments`.
- §5 ToS: visual check `/terms` in dev + prod.

### Baseline test count
555+ Jest verdi prima del merge. Atteso post-Fase 0: ~570+ (15-20 nuovi test fra §1 e §2).

---

## Rollout plan

**Ordine di merge (singoli PR isolati su `main`):**

1. PR §5 — ToS update (zero rischio funzionale, deploy immediato, sblocca legal coverage).
2. PR §1 — Rate limit `/api/auth/init`. Code default in env table = `true`, ma su Vercel **set esplicitamente `PAIRING_RATE_LIMIT_ENABLED=false` per le prime 24h** post-deploy. Smoke: verifica che il counter conta giuste pairing_started, senza ancora bloccare nessuno. Poi flip a `true` (rimuovi env var dal dashboard Vercel, default code prende il sopravvento).
3. PR §2 — Activation request endpoint + UI overflow (depend §1).
4. PR §4 setup — Container `evolution-staging` su Coolify (no merge codice se non per fix watchdog filter `staging=true`).
5. PR §3 — `docs/runbook/concierge-pairing.md` (zero rischio).

Tempo totale stimato (founder solo): 6–10h codice + 7 giorni osservazione passiva §4.

### Smoke post-deploy
- §1: `curl POST /api/auth/init` con phone valido + smoke verifica 429 al 4° tentativo.
- §2: `curl POST /api/auth/request-activation` → verifica row in DB + webhook ricevuto.
- §4: `curl /api/ops/evolution/version` su staging porta dedicata → version pinned.

### Rollback
- §1: `PAIRING_RATE_LIMIT_ENABLED=false` → comportamento pre-fase 0.
- §2: feature flag `ACTIVATION_FORM_ENABLED=false` se serve nascondere UI (decisione: NON aggiungere ora, defer fino a primo abuso reale).
- §4: stop container Coolify staging, drop table `pairing_experiments`.
- §5: revert commit ToS.

---

## Decisioni unilaterali (con alternative)

| Decisione | Scelta | Alternative considerate | Motivo |
|---|---|---|---|
| Counter rate limit | Query `audit_events` JSONB | Tabella `pairing_attempts` dedicata; Redis | Riusa tabella esistente, no nuova migration |
| Window rate limit | Rolling 24h | Calendar day | Matches `pairing_blackout` watchdog window |
| Identificazione utente | IP da `x-forwarded-for` | IP+phone-prefix; device fingerprint | Pre-launch, IP è sufficient — NAT caveat accettato |
| Notifica admin §2 | Webhook generico env var | Hardcoded Telegram | Flessibilità, decisione canale separata |
| Esperimento §4 | Container staging separato | Modifica prod + rollback | Non rompe sessioni utenti esistenti |
| ToS §5 | Sezione nuova prima di "Limitazione Responsabilità" | Documento separato `/terms/service-level` | Coerenza con T&S monolitico esistente |
| Concierge §3 | Solo runbook, no automation | Endpoint admin "request pairing token" | Automation è prematura; runbook prima |
| Anti-spam form | Rate limit 1/IP/hour | hCaptcha | Defer captcha fino primo abuso |
| Retention `activation_requests` | Nessuna (manual prune) | Cron 90d retention | Volume basso pre-launch |

---

## Open questions per GrillMe / Codex

Domande che NON ho risolto unilaterally e che voglio passare allo step grill-me:

1. **Cap 3/giorno è il numero giusto?** Più basso (1-2) = più safe ma onboarding asfittico. Più alto (5-7) = più velocità ma più rischio segnale bot. Esiste un dato pubblico su soglie Meta?
2. **Concierge usa IP residenziale Andrea — quanto è davvero "sicuro"?** Se Andrea fa 5 pairing/giorno dal suo IP residenziale per 30 giorni, anche quello brucia? C'è precedente?
3. **`alwaysOnline: true` vs `false`** in config Evolution — quale segnale è meno sospetto per Meta su personal number?
4. **Esperimento §4: vale i 7 giorni di attesa?** Effort 2-3h + tempo passivo. Se trovo che pinning aiuta ma marginalmente, è valore o distrazione?
5. **Activation requests notification senza Telegram bot setup**: Andrea vede solo via SQL manuale finché non chiude Sprint 7 backlog #8. È accettabile o blocker?
6. **ToS §5 "rimborso pro-rata in caso di chiusura strutturale"** — quanto vincola legalmente? Devo togliere o lasciare come "best effort"?
7. **Numerazione sezione ToS**: ho scritto "sezione N", in fase di implementazione va guardato il file e infilato al numero giusto. È solo un dettaglio editoriale.
8. **Tutto §2 attiva anche quando `pairing_blackout=critical` (non solo quando 429 IP-personale)?** Cioè: se il watchdog è red, mostro il form a tutti, anche a chi non ha colpito il proprio cap? Decisione UX importante non chiarita.

---

## Esce dal scope di Fase 0 (lista lavori dichiarata fuori)

- Telegram bot per notifica admin (Sprint 7 backlog #8).
- Multi-droplet routing + failover (Fase 2).
- Pool IP premium per tier Business (Fase 3).
- Provider managed Whapi/Wassenger adapter (Strategic Trap, fuori).
- Captcha sul form attivazione.
- Adjustment pricing tier (€7.99 Personal) — decisione strategica separata.
- Modifica watchdog `pairing_blackout` o `instance_flapping` (già operativi).
- Endpoint admin per gestire `activation_requests` (Sprint successivo, per ora SQL manuale).

---

## Next steps (post approval)

1. Auto-grill brutal su questo spec (GrillMe).
2. Codex review per audit indipendente.
3. Andrea OK esplicito.
4. Invoke `writing-plans` skill per piano implementazione.
5. Codice **solo dopo** OK Andrea.
