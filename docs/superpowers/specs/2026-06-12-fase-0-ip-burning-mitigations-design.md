# Fase 0 — Mitigazioni IP burning Baileys (v3)

**Date:** 2026-06-12
**Status:** Draft v3 (post Codex audit). Pending grill residuale + Andrea OK → writing-plans.
**Supersedes:** v2 (3 CRITICAL fix applicati: rate_limit_state atomico, fail-mode 3-case, hash phone_e164; 6 IMPORTANT fix applicati). Pool default cresciuto a 2 egress (IPRoyal + Webshare).

## Contesto

Droplet DigitalOcean (161.35.212.68, Frankfurt) ospita Evolution v2.3.7 (Baileys). I nuovi pairing falliscono sistematicamente con `CONNECTION_UPDATE state=close code=401 loggedOut`. Sessioni autenticate sopravvivono. Issue umbrella ufficiale: [EvolutionAPI/evolution-api#2437](https://github.com/EvolutionAPI/evolution-api/issues/2437).

**Diagnosi**: il problema è **ASN-level**, non IP-level (caso Hostinger feb 2026 = intero ASN bloccato). Cambiare IP dentro DO ha probabilità bassa di funzionare. Proxy sullo stesso VPS = inutile (egress identico). La cura è egress fuori dall'ASN bruciato per il pairing.

Il monitoring lato app rileva già il pattern (`checkPairingBlackout` in `app/lib/monitoring.ts:252-284` → `CRITICAL` quando ≥5 `pairing_started` / 0 `pairing_completed` su 24h; `checkInstanceFlapping` flagga code 403). Manca: (a) egress diversificato per pairing, (b) discriminatore "1 egress vs tutti", (c) freeze rule per ondata protocollare, (d) throttle onboarding atomico, (e) fallback umano, (f) copertura legale.

**Due modalità di guasto** da tenere distinte:

| Modalità | Sintomo | Cura |
|---|---|---|
| **Reputation-kill** (oggi) | Pairing nuovo → 401; sessioni vecchie ok | Egress pulito per pairing (proxy o nodo nuovo) |
| **Network-block** (potenziale) | Tutto morto, anche sessioni esistenti | Migrazione di nodo — proxy non basta (Baileys non instrada media via proxy) |

Fase 0 cura la prima e prepara il runbook per la seconda.

## Goal

Sei item indipendenti ma coordinati:

1. **Pairing throttle** — rate limit `/api/auth/init` per IP e per phone-hash, contatori **atomici** via `rate_limit_state` esistente + form attivazione/waitlist.
2. **Pairing-only egress proxy (A1)** — pool **default 2 egress** (IPRoyal FRA + Webshare MIL/altro), per-istanza nel payload `instance/create`. Sblocca ORA e diventa mattone della scala.
3. **Test diagnostico 48h** — "pair-via-proxy → remove proxy → observe": decide architettura Fase 1 (pairing-only egress vs sticky pool). **Pre-requisito**: sintassi `/proxy/set/{instance}` verificata su doc Evolution v2.
4. **Runbook duplo** — concierge pairing manuale + dump/restore sessioni Evolution Postgres (assicurazione network-block). Dry-run §4 verifica Docker mounts + crittografia post-restore.
5. **Disclaimer ToS** — best-effort delivery, no SLA, dipendenza da Meta.
6. **Watchdog per-egress + freeze rule** — discriminatore "1 egress fail → quarantena+ruota" vs "tutti fail → freeze pairing". Quarantine idempotente. Watchdog legacy disambiguato.

## Non-goals

- Multi-droplet routing automatico per messaggi steady-state (Fase 1, decisione da §3).
- Provider managed Whapi/Wassenger/WASenderAPI (Strategic Trap per Personal €4.99 — vedi 06-11 §3 B6).
- **Pinning `CONFIG_SESSION_PHONE_VERSION`** (esplicitamente nella lista "NON FARE" del brainstorm 06-11 §4 — ha causato ban).
- Proxy env GLOBALE su Evolution (06-11 §4: instraderebbe sessioni esistenti sane).
- **Canary pairing sintetici** (consumano reputation vera).
- Residential ROTATING proxy.
- Captcha sul form attivazione (defer fino primo abuso).
- Endpoint admin UI per `activation_requests` (SQL manuale + daily-report alert per Fase 0).
- Modifica watchdog `flapping` o `pairing_blackout` globale (esteso, non riscritto).

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────┐
│ /connect (page.tsx)                                              │
│   Step 1: phone → POST /api/auth/init                            │
│     ├─ 200: pairing code → Step 2 (existing)                     │
│     ├─ 429: quota_exceeded → Step 1b activation request form     │
│     ├─ 500: misconfiguration → fatal error, Sentry, no form      │
│     └─ 503: pairing_frozen → Step 1b activation request form     │
└──────────────────────────────────────────────────────────────────┘
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ /api/auth/init (modified)                                        │
│   1. validatePhone                                               │
│   2. NEW: extractSourceIp(req)                                   │
│   3. NEW: hashPhone8(phone)  (SHA-256 8-char, riusa scrubber)   │
│   4. NEW: enforcePairingRateLimit({ip, phone_hash}) via          │
│           rate_limit_state RPC atomico                           │
│      └─ if blocked → 429 quota_exceeded                          │
│   5. NEW: getEgressForPairing()                                  │
│      ├─ PROXY_ENABLED=false → null (legacy, no proxy fields)     │
│      ├─ PROXY_ENABLED=true + pool=[] → throw MisconfigError      │
│      ├─ PROXY_ENABLED=true + all quarantined → throw FrozenError │
│      └─ else: pick first available                               │
│      Caller wraps:                                               │
│        MisconfigError → 500 + Sentry capture (user not at fault) │
│        FrozenError → 503 pairing_frozen + form path              │
│   6. Existing Evolution /instance/create WITH proxy fields       │
│      (only if egress != null)                                    │
│   7. logAuditEvent('pairing_started', {                          │
│        instance_name, source_ip, egress_id, phone_hash           │
│      })  -- NO plaintext phone_e164                              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Watchdog (app/lib/monitoring.ts modifications)                   │
│   checkPairingBlackout: split in 2                               │
│     (a) per-egress: rows WHERE egress_id IS NOT NULL              │
│         For each egress_id, count started/completed last 24h     │
│         started>=5 && completed==0 → quarantineEgress(id)        │
│     (b) legacy global: rows WHERE egress_id IS NULL              │
│         Existing behavior preserved per backwards compat.        │
│         Auto-disable quando proxy ENABLED da N giorni (vedi §6). │
│   NEW: checkAllEgressDown                                        │
│     If 100% of pool quarantined and pool.length > 0 →            │
│       CRITICAL "pairing_freeze_active"                           │
│       /api/auth/init returns 503 for new attempts                │
│   Existing instance_flapping check stays untouched               │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1 — Pairing throttle (rate limit atomico + waitlist)

### Goal
Smorzare il segnale "burst di pairing da singolo IP/numero" prima che tocchi Evolution. Anche con proxy attivo (§2), il throttle protegge la reputation degli egress (warm-up lento) e disinnesca il burst da lancio identificato in 06-11.

### Decisione architetturale — **fix CRITICAL C1 + C3**

**Atomico via `rate_limit_state` esistente, NON query `count()` su `audit_events`.**

Esiste già `supabase/migrations/20260526_rate_limit_state.sql` con tabella `rate_limit_state(key, minute_count, minute_reset, daily_count, daily_reset, blocked, block_reason, ...)` + RPC `increment_rate_limit_state(key, ...)` che fa UPSERT atomico (`insert ... on conflict ... do update set count = count+1`). Già usata in `app/lib/rate-limit.ts`. Il mio spec v2 ignorava questa infrastruttura — v3 la usa.

**Keys e finestre:**

| Dimensione | Key format | Window | Cap default | Env var |
|---|---|---|---|---|
| Per IP | `pairing_ip:<source_ip>` | 24h (daily slot RPC) | 3 | `PAIRING_RATE_LIMIT_PER_DAY` |
| Per phone | `pairing_phone:<phone_hash_8>` | 1h (minute slot scaled) | 3 | `PAIRING_RATE_LIMIT_PER_PHONE_PER_HOUR` |

**phone_hash_8**: SHA-256 truncated 8 char, riusa funzione già documentata nel commento `20260527_audit_events.sql:7-9` (*"never log contact_number in cleartext (use SHA-256 8-char hash for dedup)"*) e usata in `scrubPiiForLog` (`app/lib/log-scrubber.ts:45`). **Zero PII plaintext in audit_events o rate_limit_state.**

### Helper `app/lib/rate-limit-pairing.ts` (NEW)

```typescript
export async function enforcePairingRateLimit(input: {
  sourceIp: string;
  phoneHash: string;
}): Promise<{ ok: true } | { ok: false; reason: 'ip_quota' | 'phone_quota' }>;
```

Internamente: chiama RPC `increment_rate_limit_state` due volte (key IP, key phone) — entrambe in una transazione se possibile, altrimenti sequenziale (la natura UPSERT atomic della RPC garantisce no-race anche con 2 chiamate seriali).

Se `blocked=true` su una delle due → ritorna `{ok:false, reason}`.

### Verifica RPC esistente

Pre-implementazione: rileggere RPC `increment_rate_limit_state` in `20260526_rate_limit_state.sql` per verificare che la firma supporti due finestre temporali indipendenti (minute_reset + daily_reset). Se firma è "1 minute + 1 daily" abbiamo già due slot:
- IP usa `daily_*` con cap 3
- Phone usa `minute_*` con un trucco: settiamo `minute_reset = NOW() + 1h` e cap minute=3, usando il "minute slot" come "hour slot" semanticamente.

Se non basta: aggiungere RPC variante `increment_rate_limit_state_pairing(key, hour_window, hour_cap)` come migration piggyback `20260612_rate_limit_pairing_rpc.sql`. **Decisione finale in implementazione**, non blocco lo spec.

### Identificazione IP
Vercel: `request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()`. Fallback `x-real-ip`. Ultimo fallback: stringa `'unknown'` loggata Sentry warning.

NAT caveat (Wi-Fi pubblico, hotspot 4G condiviso, coworking) **accettato pre-launch**. Documentato esplicitamente: cap 3/IP/24h può penalizzare 2-3 utenti dietro stesso NAT che provano nello stesso giorno. Mitigazione: se segnale empirico mostra falsi positivi, scegli combo `pairing_ip+phone_prefix_hash` come key, oppure alza cap a 5.

### Comportamento API

**Quando OK**: comportamento attuale invariato.

**Quando blocked (IP o phone)**: HTTP 429 con body:
```json
{
  "error": "pairing_quota_exceeded",
  "reason": "ip_quota",
  "message": "Hai già provato il pairing più volte oggi. Richiedi attivazione manuale.",
  "next_steps": { "form_path": "/connect?step=activation-request" },
  "retry_after_hours": 24
}
```

Frontend `/connect/page.tsx` intercetta 429 → Step 1b form.

### Bypass

| Scenario | Meccanismo |
|---|---|
| Andrea/admin test | Header `x-pairing-bypass: $OPS_SECRET` |
| IP residenziale concierge | Env `PAIRING_RATE_LIMIT_BYPASS_IPS` (comma-sep CIDR) |
| Rollback emergenza | Env `PAIRING_RATE_LIMIT_ENABLED=false` |

### Activation request form

Form per overflow (429 IP/phone, 503 freeze §6). Endpoint `POST /api/auth/request-activation`.

#### Schema `activation_requests` (NEW)

```sql
CREATE TABLE activation_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash      TEXT NOT NULL,             -- SHA-256 8-char, NO plaintext
  phone_e164_enc  TEXT,                       -- optional: encrypted plaintext per outreach
  display_name    TEXT,
  note            TEXT,
  source_ip       TEXT,
  user_agent      TEXT,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','contacted','onboarded','rejected','spam')),
  contacted_at    TIMESTAMPTZ,
  notes_admin     TEXT,
  trigger_reason  TEXT CHECK (trigger_reason IN ('rate_limit_ip','rate_limit_phone','pairing_freeze','direct')),
  CONSTRAINT name_len CHECK (display_name IS NULL OR char_length(display_name) <= 100),
  CONSTRAINT note_len CHECK (note IS NULL OR char_length(note) <= 500)
);
CREATE INDEX idx_activation_requests_status ON activation_requests(status, requested_at);
CREATE INDEX idx_activation_requests_phone_hash ON activation_requests(phone_hash);
ALTER TABLE activation_requests ENABLE ROW LEVEL SECURITY;
-- default DENY, only service-role
```

**Phone storage**:
- `phone_hash` (NOT NULL): SHA-256 8-char, usato per dedup + lookup.
- `phone_e164_enc` (NULLABLE): plaintext criptato simmetricamente con env `ACTIVATION_PHONE_ENC_KEY` se Andrea vuole contattare l'utente (fallback su display_name + manual outreach se vuoto). Decisione di policy: lo plaintext è ricuperabile solo da Andrea con key. **Alternativa**: salva plaintext senza cifratura — bocciata, è la stessa policy che Sprint 6 ha chiuso.

#### Endpoint behavior

1. `validatePhone(phone)`.
2. Compute `phone_hash = sha256_8(phone)`.
3. (Opzionale) Encrypt: `phone_e164_enc = aes256_encrypt(phone, ACTIVATION_PHONE_ENC_KEY)`. Se key non settata → null.
4. Sanitize: `display_name.trim().slice(0,100)`, `note.trim().slice(0,500)`.
5. Anti-spam atomico: chiama `enforcePairingRateLimit({sourceIp, phoneHash})` con stessa logica (riusa rate_limit_state, key separate `activation_ip:<ip>` cap 1/hour). Se blocked → 429.
6. Anti-duplicate: `count activation_requests WHERE phone_hash=$1 AND status IN ('pending','contacted') AND requested_at > NOW() - INTERVAL '7 days'` → ≥1 → 200 `{ok:true, status:'already_pending'}` (silent).
7. INSERT row con `trigger_reason` passato dal client.
8. Fire-and-forget POST `ACTIVATION_NOTIFY_WEBHOOK_URL` (3s timeout, errore Sentry, NON blocca response).
9. Audit `activation_requested` con payload `{phone_hash, source_ip, trigger_reason}`.
10. Return 200.

### Daily-report extension — **fix IMPORTANT I5**

`/api/cron/daily-report` (esistente 06:00 UTC) aggiunge step finale:
```sql
SELECT count(*)::int FROM activation_requests
WHERE status='pending' AND requested_at > NOW() - INTERVAL '24 hours';
```

Se count > 0 → include nel report + Sentry capture severity=warning con tag `pending_activations=<count>`. Garanzia: anche se `ACTIVATION_NOTIFY_WEBHOOK_URL` è down (Telegram/email), Andrea riceve il segnale entro 24h via report cronizzato. Nessuna richiesta persa silenziosamente.

### Test
- Unit: `enforcePairingRateLimit` IP block, phone block, both pass, bypass header.
- Unit: `hashPhone8` deterministico, output 8-char.
- Unit: activation form validate/sanitize/anti-spam/anti-duplicate.
- Integration: POST `/api/auth/init` 4× same IP → 3+1×429.
- Integration: POST `/api/auth/init` 4× same phone in 1h → 3+1×429.
- Integration: bypass header → 200.
- Integration: POST activation con trigger_reason=rate_limit_ip → row + webhook (mocked).
- Integration: daily-report count pending → log emesso.
- E2E (opzionale): 429 → form → submit → conferma.

---

## 2 — Pairing-only egress proxy (A1)

### Goal
Sblocca pairing OGGI disaccoppiando il choke point (handshake Noise WhatsApp Web) dall'IP del droplet. Il proxy serve UNICAMENTE per `/instance/create`. Steady-state delle sessioni resta diretto sul droplet (no dipendenza uptime proxy h24, no concentrazione socket WhatsApp, no rumore routing media).

Singola mitigazione **più alto valore/euro** secondo brainstorm 06-11 §2 (ranked A1). Evolution v2 supporta proxy per-istanza nel payload `instance/create`: `proxyHost/proxyPort/proxyProtocol/proxyUsername/proxyPassword`.

### Decisione architetturale
**Proxy per-istanza nel payload**, NON env globale `PROXY_HOST` Evolution (06-11 §4 explicit "NO globale").

### Pool size — **fix IMPORTANT I2 + confirmation Andrea 2026-06-12**

**Default Fase 0: 2 egress**. Niente più SPOF in open question — è un'azione del rollout Sprint 1.

Provider candidati:

| Egress ID | Provider | Location/ASN | Costo |
|---|---|---|---|
| `ipr-fra-01` | IPRoyal static residential | Frankfurt ISP-grade | ~$2/mo |
| `web-mil-01` | Webshare static residential | Milano (o altra EU ISP-grade) | ~$2.50/mo |

Totale **~€4.50/mese**. Coverage ASN diverso (provider diversi → upstream ISP diversi).

**Critical check pre-acquisto**: verificare in dashboard provider che siano **static residential** (IP fisso, ISP residenziale upstream), NON "rotating residential" (IP cambia) né "datacenter mascherato". Test: `whois <IP>` deve mostrare ISP residenziale, non hosting provider.

### Schema env

Pattern enumerativo discoverable:
```
PAIRING_PROXY_ENABLED=true
PAIRING_EGRESS_POOL=ipr-fra-01,web-mil-01

# egress 1
PAIRING_EGRESS_IPR_FRA_01_HOST=proxy.iproyal.com
PAIRING_EGRESS_IPR_FRA_01_PORT=12321
PAIRING_EGRESS_IPR_FRA_01_PROTOCOL=http
PAIRING_EGRESS_IPR_FRA_01_USERNAME=username
PAIRING_EGRESS_IPR_FRA_01_PASSWORD=password
PAIRING_EGRESS_IPR_FRA_01_LABEL=IPRoyal FRA static

# egress 2
PAIRING_EGRESS_WEB_MIL_01_HOST=p.webshare.io
PAIRING_EGRESS_WEB_MIL_01_PORT=80
PAIRING_EGRESS_WEB_MIL_01_PROTOCOL=http
PAIRING_EGRESS_WEB_MIL_01_USERNAME=username
PAIRING_EGRESS_WEB_MIL_01_PASSWORD=password
PAIRING_EGRESS_WEB_MIL_01_LABEL=Webshare MIL static
```

**Alternativa considerata**: `PAIRING_EGRESS_POOL_JSON='[{...},{...}]'`. Bocciata per Fase 0 (pool=2 leggibile). Open question per Fase 1 quando pool sale a 4+.

### Helper `app/lib/egress-pool.ts` (NEW)

```typescript
type Egress = {
  id: string;
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  username?: string;
  password?: string;
  label?: string;
};

class MisconfigError extends Error {}      // proxy enabled but pool invalid
class FrozenError extends Error {}         // pool valid but all quarantined

export function loadEgressFromEnv(): Egress[];
export async function getEgressForPairing(): Promise<Egress | null>;
  // null → proxy disabled, legacy mode
  // throws MisconfigError → pool empty/malformed but enabled
  // throws FrozenError → pool valid but 100% quarantined
export async function quarantineEgress(id: string, reason: string, ttlHours?: number): Promise<void>;
export async function isEgressQuarantined(id: string): Promise<boolean>;
export async function unquarantineEgress(id: string): Promise<void>;
```

### Egress quarantine state — via `audit_events`

Nuovo `event_type='egress_quarantine'` con payload `{egress_id, reason, until: ISO8601}`. Query:

```sql
SELECT (payload->>'until')::timestamptz AS until
FROM audit_events
WHERE event_type IN ('egress_quarantine','egress_unquarantine')
  AND payload->>'egress_id' = $1
ORDER BY created_at DESC LIMIT 1;
```

`is_quarantined = (last event is 'egress_quarantine' AND until > NOW())`.

### Integration in `/api/auth/init` — **fix CRITICAL C2 (3 case fail mode)**

```typescript
let egress: Egress | null;
try {
  egress = await getEgressForPairing();
} catch (e) {
  if (e instanceof MisconfigError) {
    // pool empty/malformed but PROXY_ENABLED=true: bug del sysadmin, non dell'utente
    Sentry.captureException(e, { tags: { kind: 'pairing_misconfig' } });
    return NextResponse.json({
      error: 'server_misconfiguration',
      message: 'Errore di configurazione. Stiamo verificando.',
    }, { status: 500 });
  }
  if (e instanceof FrozenError) {
    return NextResponse.json({
      error: 'pairing_frozen',
      message: 'Sistema momentaneamente in sovraccarico. Ti contattiamo via WhatsApp.',
      next_steps: { form_path: '/connect?step=activation-request' }
    }, { status: 503 });
  }
  throw e;
}

const createBody: any = {
  instanceName, number, qrcode: true,
  integration: 'WHATSAPP-BAILEYS',
  syncFullHistory: false,
  alwaysOnline: true,
};

if (egress) {
  createBody.proxyHost = egress.host;
  createBody.proxyPort = egress.port;
  createBody.proxyProtocol = egress.protocol;
  if (egress.username) createBody.proxyUsername = egress.username;
  if (egress.password) createBody.proxyPassword = egress.password;
}
// then existing POST /instance/create
```

Audit `pairing_started` payload include `egress_id` (`null` se `PROXY_ENABLED=false`).

### Rollback chiarito — **fix CRITICAL C2**

| Stato | Comportamento |
|---|---|
| `PROXY_ENABLED=false` | **Legacy**: no proxy fields, `egress_id=null`, watchdog legacy globale attivo |
| `PROXY_ENABLED=true` + pool valido + almeno 1 available | **Normale**: proxy fields da egress selezionato |
| `PROXY_ENABLED=true` + pool valido + tutti quarantined | **503 frozen** (utente vede form) |
| `PROXY_ENABLED=true` + pool vuoto o malformed | **500 misconfig** (Sentry alert, utente NON vede form — non è colpa sua) |

### Test
- Unit: `loadEgressFromEnv` parse + handles missing/malformed (port NaN, protocol invalid).
- Unit: `getEgressForPairing` ritorna null se disabled; throws MisconfigError se enabled+pool=[]; throws FrozenError se enabled+all quarantined; ritorna egress se 1+ available.
- Unit: `quarantineEgress` + `isEgressQuarantined` round-trip.
- Integration: POST `/api/auth/init` con 2 egress disponibili → mock Evolution riceve proxy fields del primo.
- Integration: 1 egress quarantined → seleziona il secondo.
- Integration: pool vuoto + enabled → 500 (no form path).
- Integration: tutti quarantined → 503 (con form path).
- **Smoke manuale**: 1 pairing reale con IPRoyal → state=open; 1 con Webshare → state=open.

---

## 3 — Test diagnostico 48h "pair-via-proxy → remove → observe"

### Goal
Determinare sperimentalmente l'architettura giusta per Fase 1:

- **Esito A** (target): sessioni paired via proxy sopravvivono al ritorno su IP droplet diretto → adotta **pairing-only egress**. 1-2 IP bastano. Proxy NON è dipendenza uptime.
- **Esito B**: sessione muore quando il proxy viene rimosso → adotta **proxy sticky pool**. Pool dimensionato.

### Pre-requisito #1 — **fix IMPORTANT I1**
**Verifica sintassi `/proxy/set/{instance}` PRIMA di implementare §3.**

L'esperimento §3 fallisce silenziosamente se la chiamata "remove proxy" è malformata (Evolution ignora body invalido, proxy resta attivo, l'esperimento misura la cosa sbagliata = esito sempre A falso).

Procedura verifica (~30 min):
1. Leggi [doc.evolution-api.com/v2/api-reference/instance-controller/set-proxy](https://doc.evolution-api.com/v2) — endpoint e body schema.
2. Se doc ambigua: clona `EvolutionAPI/evolution-api` v2.3.7 tag, leggi `src/api/instance/instance.service.ts` per metodo `setProxy`.
3. Esegui call manuale su istanza test, verifica via `GET /proxy/find/{instance}` che proxy sia OFF.
4. Documenta sintassi esatta nello spec implementation prima di scrivere il codice del test §3.

Possibili sintassi (da verificare):
- `POST /proxy/set/{instance}` body `{"enabled": false}`
- `POST /proxy/set/{instance}` body `{"proxy": {"enabled": false}}`
- `DELETE /proxy/set/{instance}` (no body)

### Pre-requisito #2
§2 (A1) implementato e funzionante in prod con almeno 2 egress attivi.

### Procedura

**Giorno 0 (setup)**:
1. Tabella temporanea (drop post-esperimento):
```sql
CREATE TABLE pairing_diagnostic_test (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name     TEXT NOT NULL,
  paired_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paired_via_egress TEXT NOT NULL,
  proxy_removed_at  TIMESTAMPTZ,
  last_check_at     TIMESTAMPTZ,
  last_state        TEXT,
  last_disconnect_code INTEGER,
  outcome           TEXT CHECK (outcome IN ('pending','survived_48h','died_during_48h','inconclusive')),
  notes             TEXT
);
```

**Giorno 1 (pair-via-proxy)**:
2. 2-3 beta tester ICP D, numeri **nuovi** (non già paired). Distribuiti su 2 egress (almeno 1 per ciascuno) per diversificare il segnale.
3. Pairing via `/api/auth/init` (proxy attivo). Verifica `state=open` via `/api/ops/evolution/instances`.
4. INSERT in `pairing_diagnostic_test` con `paired_via_egress`.

**Giorno 1 (proxy removal)**:
5. Chiama Evolution **con sintassi verificata in Pre-req #1** per ogni istanza. Set `proxy_removed_at`.
6. Triggera reconnect (Evolution auto-retry, oppure `/instance/connectionState/{name}` poll manuale).

**Giorno 1-3 (osservazione 48h)**:
7. Script monitor poll `/instance/connectionState/{name}` ogni 6h.
8. Update `last_check_at`, `last_state`, `last_disconnect_code`.
9. Stato stabile `open` per 48h → `outcome='survived_48h'`.
10. State `close`/`disconnected` code 401 → `outcome='died_during_48h'`.

### Decisione gate

| Esito | Conclusione | Action Fase 1 |
|---|---|---|
| 100% `survived_48h` | Esito A | Adotta "pairing-only egress" |
| 50%+ `died_during_48h` con 401 | Esito B | Adotta "sticky pool" |
| Misto/inconclusive | Inconclusivo | Ripeti con 5+ numeri |

### Bias caveat — **annotare in ADR (NICE-TO-HAVE Codex)**
Beta tester contattati direttamente NON rappresentano comportamento Meta verso iscritti spontanei al lancio. Sample size 2-3 è statisticamente debole. ADR annoti questo trade-off; non bloccante per la decisione architetturale Fase 1.

### Output
ADR in `AndreaVault/decisions.md` con esito + sample size + bias caveat + decisione architettura Fase 1.

### Cleanup
DROP TABLE `pairing_diagnostic_test` (SQL diretto, no migration).

### Effort
30 min verifica `/proxy/set` syntax + 2-3h setup + 48h osservazione + 1h sintesi.

---

## 4 — Runbook duplo: concierge + dump/restore sessioni

### Goal
Due runbook in `docs/runbook/` (directory NEW):
- **`concierge-pairing.md`**: fallback umano se §2 A1 fallisce per utente specifico.
- **`session-restore.md`**: disaster recovery network-block scenario (B3 prep).

### `concierge-pairing.md`

#### Quando usarlo (priorità ridotta vs v1)
1. §2 A1 fallisce per utente specifico (raro con proxy attivo).
2. Watchdog `pairing_blackout` critical per egress assegnato a un utente specifico.
3. Coda `activation_requests` con `status='pending'` post-onboarding deal.

#### Pre-requisiti
- Laptop Andrea + Docker.
- Hotspot 4G residenziale.
- `curl ifconfig.me` confronta range ISP fisso.
- SSH droplet + ops endpoint.

#### Pre-flight check — **fix IMPORTANT I4**

PRIMA della procedura (eseguire una volta, validare assunzione):
```bash
ssh root@161.35.212.68 \
  "docker inspect evolution | jq '.[].Mounts[] | select(.Destination | startswith(\"/evolution\"))'"
```

Output atteso: bind mount (`Type: "bind"`) con `Source: /path/su/host` e `Destination: /evolution`. Se invece `Type: "volume"` (named volume Docker), il path host non è accessibile direttamente — devi usare `docker cp` per estrarre, non `tar` host-side.

**Se volume named**: adatta Step 6-7 a:
```bash
docker cp evolution:/evolution/instances/SchedWhats-{phone} ./session-{phone}/
tar czf ./session-{phone}.tar.gz ./session-{phone}/
scp ./session-{phone}.tar.gz root@<NODO_B>:/tmp/
ssh root@<NODO_B> "docker cp - evolution:/evolution/instances/ < /tmp/session-{phone}.tar.gz"
```

Documenta esito pre-flight nel runbook (bind vs volume) per evitare ambiguità futura.

#### Procedura (~20 min/utente, con egress A1 proxy)

```bash
# Step 1 - Setup Evolution locale (laptop tethering 4G residenziale)
docker run -d --name evo-concierge -p 8080:8080 \
  -e AUTHENTICATION_API_KEY=$LOCAL_KEY \
  evoapicloud/evolution-api:v2.3.7

# Step 2 - Crea istanza con proxy A1 (NON IP residenziale diretto)
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: $LOCAL_KEY" -H "Content-Type: application/json" \
  -d '{
    "instanceName":"SchedWhats-{phone}",
    "number":"{phone}",
    "qrcode":true,
    "integration":"WHATSAPP-BAILEYS",
    "syncFullHistory":false,
    "alwaysOnline":true,
    "proxyHost":"proxy.iproyal.com",
    "proxyPort":12321,
    "proxyProtocol":"http",
    "proxyUsername":"...",
    "proxyPassword":"..."
  }'

# Step 3 - Pairing code
curl -X GET "http://localhost:8080/instance/connect/SchedWhats-{phone}?number={phone}" \
  -H "apikey: $LOCAL_KEY"

# Step 4 - Chiama utente, comunica code (WhatsApp → Impostazioni → Dispositivi)

# Step 5 - Poll state=open (timeout 5min)
while true; do
  STATE=$(curl -s http://localhost:8080/instance/connectionState/SchedWhats-{phone} \
    -H "apikey: $LOCAL_KEY" | jq -r '.instance.state')
  echo "$STATE"
  [[ "$STATE" == "open" ]] && break
  sleep 5
done

# Step 6 - Estrai session files (adatta a bind vs volume — pre-flight)
# Se bind: tar host-side. Se volume: docker cp + tar.
docker exec evo-concierge tar -czf /tmp/session.tar.gz \
  /evolution/instances/SchedWhats-{phone}
docker cp evo-concierge:/tmp/session.tar.gz ./session-{phone}.tar.gz

# Step 7 - Upload droplet + restart (vedi pre-flight per bind vs volume)
scp session-{phone}.tar.gz root@161.35.212.68:/tmp/
ssh root@161.35.212.68 \
  "cd / && tar -xzf /tmp/session-{phone}.tar.gz \
   && chown -R 1000:1000 /evolution/instances/SchedWhats-{phone}"
# Restart container via Coolify webhook

# Step 8 - Verifica + DB update
curl "https://whatslaterpush.vercel.app/api/ops/evolution/instances?secret=$OPS_SECRET" \
  | jq '.[] | select(.instanceName=="SchedWhats-{phone}")'
# Update DB:
UPDATE activation_requests SET status='onboarded', contacted_at=NOW()
  WHERE phone_hash=sha256_8('{phone}') AND status='pending';
INSERT INTO user_instances (phone_number, instance_name, connection_status)
  VALUES ('{phone}', 'SchedWhats-{phone}', 'open');
```

#### Caveat
- Concierge via proxy A1 (NON IP residenziale diretto): evita "session salta IP residential → IPRoyal" sospetto.
- Cap 5 pairing/giorno (preserva reputation egress).
- `session-*.tar.gz` cifrati 7 giorni → `shred`.
- Se pre-flight rivela Docker named volume: aggiorna Step 6-7.

### `session-restore.md` (NEW)

#### Quando
Network-block droplet: sessioni esistenti DOWN (non solo nuovi pairing). Caso Hostinger feb 2026.

#### Pre-requisiti (DEVONO esistere PRIMA dell'incident)
- Nodo B ready altro ASN (Hetzner CX22 in DC diverso, ~€4/mese se h24, oppure ON-DEMAND).
- Coolify multi-server config con nodo B linkato.
- Stesso Evolution v2.3.7 image.
- DNS A record per `EVOLUTION_API_URL` con TTL basso (60s).

#### Procedura (~20 min stimati, da CRONOMETRARE primo run)

```bash
# Step 1 - Dump Postgres Evolution dal droplet attuale
ssh root@161.35.212.68 \
  "docker exec evolution-postgres pg_dump -U evolution evolution | gzip > /tmp/evo-dump.sql.gz"
scp root@161.35.212.68:/tmp/evo-dump.sql.gz ./

# Step 2 - Provision nodo B (se non già up)
# Hetzner Cloud Console: spin CX22, attach Coolify multi-server

# Step 3 - Restore Postgres su nodo B
scp ./evo-dump.sql.gz root@$NODO_B:/tmp/
ssh root@$NODO_B \
  "gunzip /tmp/evo-dump.sql.gz \
   && docker exec -i evolution-postgres psql -U evolution evolution < /tmp/evo-dump.sql"

# Step 4 - Restart Evolution container nodo B

# Step 5 - DNS swap EVOLUTION_API_URL
# Vercel env update + redeploy via /api/ops/coolify/redeploy

# Step 6 - Verify istanze E CRITTOGRAFIA (NICE-TO-HAVE Codex)
curl https://evolution-b.<dominio>/instance/fetchInstances -H "apikey: $EVO_KEY" \
  | jq '.[].state'
# Tutte devono mostrare state=open

# CRITICAL VERIFY (non basta state=open!): inviare 1 messaggio reale per ogni
# istanza restored e verificare che WhatsApp lo accetti (response 200, message_id).
# state=open può essere superficiale se session crittografia è corrotta —
# Baileys riconnette ma il primo encrypt fallisce silenziosamente.
for instance in $(get_restored_instances); do
  curl -X POST https://evolution-b.<dominio>/message/sendText/$instance \
    -H "apikey: $EVO_KEY" -d '{"number":"$ANDREA_TEST_NUMBER","text":"restore-verify"}'
done

# Step 7 - Monitor 1h
# Watchdog pairing_blackout + flapping nodo B. Sentry alert.
```

#### Critical caveat — DRY RUN PRE-LANCIO
**DEVE essere cronometrato e validato una volta PRIMA del lancio**. Senza, "20 min stimati" è fiction.

Costo dry-run: ~€1-2 (1h Hetzner CX22). Output: timing reale + lista fix + **conferma esplicita che crittografia session sopravvive al restore** (verifica via test send messaggio reale, non solo state=open).

### Test
Nessun automated. Validation = primo concierge reale + dry-run session-restore pre-lancio.

---

## 5 — Disclaimer ToS fragilità delivery

### Goal
Mette per iscritto: best-effort, no SLA, dipendenza Meta. Riduce esposizione legale.

### Modifiche a `app/terms/page.tsx`
Aggiunge "Service-Level e Limitazioni Tecniche" prima di "Limitazione di Responsabilità". Bump "Ultimo aggiornamento: 12 giugno 2026".

Contenuto invariato da v2 (sezione N — vedi spec v2 per testo completo; copio sotto per leggibilità).

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
   consegnati. Variabili fuori dal nostro controllo possono causare perdita o ritardo.

c) **Dipendenza da Meta.** Il Servizio può essere sospeso, degradato o terminato per cause
   esterne. In caso di interruzione strutturale e permanente, il Servizio cessa con
   preavviso minimo di 14 giorni; la quota residua del periodo prepagato in corso viene
   rimborsata pro-rata.

d) **Responsabilità sull'account WhatsApp.** L'utilizzo del Servizio comporta rischio che
   Meta classifichi l'account come automatizzato e applichi limitazioni. Il Servizio è
   disegnato per minimizzare il rischio (rate limiting, distribuzione temporale, no
   broadcast), ma non lo elimina. Non siamo responsabili per blocchi WhatsApp derivanti
   dall'utilizzo.

e) **Esclusione casi d'uso vietati.** Confermi che non userai il Servizio per: messaggi
   commerciali a destinatari non consenzienti, marketing massivo, cold outreach, o
   attività in violazione delle WhatsApp Business Terms o GDPR/ePrivacy. La violazione
   è giusta causa di risoluzione del Servizio senza rimborso.
```

### Test
Visual: `npm run dev` → `/terms` → verifica sezione + numerazione + grep "Service-Level".

### Rollout
Pre-launch (0 paganti), nessuna notifica. Banner "Termini aggiornati" deferred.

---

## 6 — Watchdog per-egress + freeze rule

### Goal
Discriminatore:

| Scenario | Azione | Frontend |
|---|---|---|
| 1 egress fallisce | Quarantena + ruota al prossimo del pool | Trasparente per utente |
| TUTTI egress falliscono insieme | Freeze totale — niente retry | 503 + form attivazione |

### Modifiche `app/lib/monitoring.ts`

#### `checkPairingBlackout` — split in 2 — **fix IMPORTANT I6**

**(a) Per-egress check** (NEW, gated `PAIRING_PROXY_ENABLED=true`):

```sql
SELECT DISTINCT payload->>'egress_id' AS egress_id
FROM audit_events
WHERE event_type IN ('pairing_started','pairing_completed')
  AND payload->>'egress_id' IS NOT NULL
  AND created_at > NOW() - INTERVAL '24 hours';
```

Per ogni egress_id:
```sql
SELECT
  count(*) FILTER (WHERE event_type='pairing_started') AS started,
  count(*) FILTER (WHERE event_type='pairing_completed') AS completed
FROM audit_events
WHERE payload->>'egress_id' = $1
  AND created_at > NOW() - INTERVAL '24 hours';
```

- `started >= 5 AND completed == 0` → `quarantineEgress(id, 'blackout_24h', 24)` (idempotente, vedi sotto).

**(b) Legacy global check** (esistente, preservato per pre-A1 era):

Query analoga MA filtrata `WHERE payload->>'egress_id' IS NULL`. Cattura solo dati pre-A1 (history fino a `PAIRING_PROXY_ENABLED=true` go-live).

**Auto-disable legacy**: dopo 25h (1h margine oltre la finestra 24h) dal go-live di `PAIRING_PROXY_ENABLED=true`, il legacy check è statisticamente irrilevante (tutti i dati hanno `egress_id`). Tracking via env `PAIRING_PROXY_ENABLED_SINCE` (ISO timestamp): se `NOW() - PAIRING_PROXY_ENABLED_SINCE > 25h` → skip legacy check, emette audit `legacy_blackout_check_skipped` una sola volta. Garantisce nessun falso positivo nel periodo transition.

#### `quarantineEgress` idempotente — **fix IMPORTANT I3**

```typescript
export async function quarantineEgress(id: string, reason: string, ttlHours = 24) {
  // Read latest event for this egress
  const latest = await getLatestEgressStateEvent(id);
  
  // Skip if already quarantined and still active
  if (latest?.event_type === 'egress_quarantine' && 
      new Date(latest.payload.until) > new Date()) {
    return;  // idempotent: don't spam audit
  }
  
  const until = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  await logAuditEvent('egress_quarantine', { egress_id: id, reason, until });
}
```

Stesso pattern per `unquarantineEgress` (skip se già stato unquarantined recentemente).

#### NEW `checkAllEgressDown`

```typescript
export async function checkAllEgressDown() {
  const pool = loadEgressFromEnv();
  if (pool.length === 0) return { status: 'ok' };

  const quarantinedCount = (await Promise.all(
    pool.map(e => isEgressQuarantined(e.id))
  )).filter(Boolean).length;

  if (quarantinedCount === pool.length) {
    await logAuditEvent('pairing_freeze_activated', {
      pool_size: pool.length,
      triggered_at: new Date().toISOString()
    });
    return {
      status: 'critical', severity: 'critical',
      message: `Tutti gli ${pool.length} egress in quarantena. Pairing freeze attivato.`
    };
  }
  return { status: 'ok' };
}
```

#### Freeze enforcement
Naturale: `getEgressForPairing` throw FrozenError se tutti quarantined → `/api/auth/init` ritorna 503. Niente flag separato.

#### Manual override (ops endpoint NEW)
`POST /api/ops/egress/unquarantine?id=<egress_id>&secret=$OPS_SECRET`. Riusa `requireOpsSecret()` helper esistente.

#### Auto-unfreeze
TTL 24h sulla quarantena. Watchdog re-check ogni 60s (cron esistente).

### Decisione trigger 100% vs 80%
**100% per Fase 0** con pool=2: quarantenati 2/2 = critical. Quando pool sale a 4+ (Fase 1), valuteremo 80%.

### Test
- Unit: `checkPairingBlackout` per-egress isola correttamente.
- Unit: `quarantineEgress` idempotente — 2 chiamate consecutive → 1 audit only.
- Unit: `checkAllEgressDown` critical solo se pool.length > 0 e tutti quarantined.
- Unit: backwards compat — pairing_started senza `egress_id` non quarantena.
- Unit: legacy check auto-skip dopo 25h da `PAIRING_PROXY_ENABLED_SINCE`.
- Integration: trigger 5 pairing_started egress=A + 0 completed → audit `egress_quarantine`.
- Integration: tutti egress quarantined → `/api/auth/init` → 503.
- Integration: manual unquarantine → audit `egress_unquarantine` + getEgressForPairing → ritorna l'egress.

---

## Data model changes — riepilogo

| Change | Type | Migration | Reason |
|---|---|---|---|
| `audit_events.payload.{source_ip, egress_id, phone_hash}` | Schema-less | No | Watchdog per-egress §6, rate limit hashed §1 |
| `activation_requests` table | New | `20260612_activation_requests.sql` | Overflow form §1 |
| `pairing_diagnostic_test` table | New TEMP | SQL diretto, drop post-test | Esperimento §3 |
| `rate_limit_state` keys nuove (`pairing_ip:*`, `pairing_phone:*`, `activation_ip:*`) | Esteso | No schema change | §1 atomic counter |
| Possibile RPC `increment_rate_limit_state_pairing` | Optional new | `20260612_rate_limit_pairing_rpc.sql` se necessario | §1 supporto window hour |
| Index `audit_events(event_type, created_at)` | Verify-then-add | Opzionale `20260612_audit_events_index.sql` | §6 query performance |

---

## Env vars nuove

| Name | Required | Default | Where |
|---|---|---|---|
| `PAIRING_RATE_LIMIT_PER_DAY` | no | `3` | §1 cap per IP |
| `PAIRING_RATE_LIMIT_PER_PHONE_PER_HOUR` | no | `3` | §1 cap per phone |
| `PAIRING_RATE_LIMIT_ENABLED` | no | `true` | §1 kill switch |
| `PAIRING_RATE_LIMIT_BYPASS_IPS` | no | empty | §1 bypass |
| `ACTIVATION_PHONE_ENC_KEY` | no | empty | §1 optional encrypt plaintext phone for outreach |
| `ACTIVATION_NOTIFY_WEBHOOK_URL` | no | empty | §1 admin notify (fallback daily-report) |
| `PAIRING_PROXY_ENABLED` | no | `false` (start safe) | §2 master switch |
| `PAIRING_PROXY_ENABLED_SINCE` | yes if enabled | empty | §6 transition tracking |
| `PAIRING_EGRESS_POOL` | yes if proxy enabled | empty | §2 comma-sep IDs |
| `PAIRING_EGRESS_IPR_FRA_01_*` | per-egress | — | §2 (HOST/PORT/PROTOCOL/USERNAME/PASSWORD/LABEL) |
| `PAIRING_EGRESS_WEB_MIL_01_*` | per-egress | — | §2 (same) |

Header bypass `x-pairing-bypass` riusa `OPS_SECRET` esistente.

---

## Testing plan globale

### Unit
- §1: rate limit IP/phone via rate_limit_state, hash 8-char deterministico, activation validate/sanitize.
- §2: egress pool load, getEgressForPairing 4 branch (disabled/misconfig/frozen/ok), quarantine idempotente.
- §3: monitor poll logic.
- §6: per-egress check, all-down, legacy auto-skip post-25h.

### Integration
- §1: rate limit 4× IP → 3+1×429; 4× phone in 1h → 3+1×429; bypass → 200; daily-report count emette warning.
- §2: 2 egress disponibili → primo selezionato; pool vuoto + enabled → 500; all quarantined → 503.
- §6: trigger 5 started egress=A → audit egress_quarantine; chiamata duplicate → 1 audit only.

### E2E
- 429 → form → submit → conferma (Playwright).
- 503 → form → submit (Playwright).

### Manuale
- §2: smoke 2 pairing reali (1 per egress) → state=open ciascuno.
- §3: test diagnostico 48h con 2-3 beta tester distribuiti sui 2 egress.
- §4: dry-run `session-restore.md` con test send messaggio post-restore (verifica crittografia).
- §5: visual `/terms` post-deploy.

### Baseline
555+ Jest verdi. Atteso post-Fase 0 v3: ~590+ (35-40 nuovi test).

---

## Rollout plan

### Sprint 0 — Pre-implementation verifications (1-2h)
0. **Verifica sintassi `/proxy/set/{instance}`** su doc o source Evolution v2.3.7 (§3 pre-req #1).
0b. **Verifica Docker mount type** su droplet Evolution (`docker inspect | jq .[].Mounts`) (§4 pre-flight).
0c. **Verifica RPC `increment_rate_limit_state`** firma e window slot (§1 — decide se serve RPC variante hour).
0d. **Acquista 2 egress**: IPRoyal FRA + Webshare MIL (~€4.50/mo).

### Sprint 1 — Sblocco immediato (giorno 1, ~6-8h)
1. PR §5 ToS disclaimer (zero rischio funzionale).
2. PR §2 setup A1: implementa `egress-pool.ts` + integration in `auth/init` con 3-case fail mode. Deploy con `PAIRING_PROXY_ENABLED=false`.
3. **Flip env**: set `PAIRING_PROXY_ENABLED=true`, `PAIRING_EGRESS_POOL=ipr-fra-01,web-mil-01`, `PAIRING_PROXY_ENABLED_SINCE=<ISO timestamp>`. Smoke 2 pairing reali (1 per egress). **Se entrambi OK → SBLOCCATO**.

### Sprint 2 — Diagnosi + throttle (giorno 2-4, ~6-8h)
4. PR §3 test diagnostico: tabella temp + monitor script. 48h obs con 2-3 beta tester distribuiti sui 2 egress.
5. PR §1 throttle (rate_limit_state RPC) + form attivazione + daily-report extension. Deploy con `_ENABLED=false` 24h smoke, poi flip.

### Sprint 3 — Watchdog + runbook (settimana 1, ~6-8h)
6. PR §6 watchdog per-egress (idempotente) + freeze rule + ops `unquarantine` endpoint.
7. PR §4 docs: `concierge-pairing.md` + `session-restore.md`.
8. Dry-run session-restore su nodo Hetzner CX22 temporaneo (€1-2), cronometra, **verifica crittografia post-restore via send messaggio reale**, annota in `AndreaVault/decisions.md`.

**Effort totale**: ~20-26h codice (vs 18-24h v2 — +2h per fix critici) + 48h obs + 1 dry-run. Distribuibile su 1-2 settimane.

### Smoke post-deploy per item
- §1: 4× `/api/auth/init` → 3+1×429. Bypass header → 200. Daily-report run con activation pending → warning emesso.
- §2: log richiesta a Evolution include proxy fields. Pool 1 quarantined manual → seleziona secondo. Pool vuoto + enabled → 500.
- §3: tabella popolata, poll updates ogni 6h.
- §4: pre-flight Docker mounts documentato in runbook; dry-run completato + send test OK.
- §5: grep "Service-Level" in HTML `/terms`.
- §6: forza 2 quarantene → 503; quarantineEgress duplicata → 1 audit only.

### Rollback per item
- §1: `PAIRING_RATE_LIMIT_ENABLED=false`.
- §2: `PAIRING_PROXY_ENABLED=false`.
- §3: stop monitor, DROP TABLE.
- §4: docs only.
- §5: revert commit.
- §6: revert commit + manual unquarantine via ops endpoint per cleanup.

---

## Decisioni unilaterali (aggiornate v3)

| Decisione | Scelta | Alternative | Motivo |
|---|---|---|---|
| Counter rate limit | `rate_limit_state` RPC atomico | Query `audit_events` count; Redis | Codex C1 — atomicità + riuso infra esistente |
| Phone in storage | Hash SHA-256 8-char | Plaintext; encrypted | Codex C3 — coerenza policy Sprint 6 |
| Phone outreach storage | Encrypted in `phone_e164_enc` (optional) | Plaintext; hash-only | Andrea deve contattare l'utente; cifratura riconciliata con GDPR |
| Fail mode pool vuoto+enabled | 500 misconfig (Sentry) | 503 user-facing | Codex C2 — utente NON c'entra |
| Pool size Fase 0 | **2 egress** (IPRoyal + Webshare) | 1 egress; 3+ | Andrea conferma 2026-06-12; Codex I2; freeze rule ha valore reale |
| Quarantine idempotency | Read-latest-then-skip | Insert-always (audit spam) | Codex I3 |
| Watchdog legacy | Auto-disable post-25h via `PAIRING_PROXY_ENABLED_SINCE` | Coesiste permanente | Codex I6 — evita falsi positivi transition |
| `/proxy/set` syntax | Verify-before-implement | Assume + fix later | Codex I1 — esperimento §3 dipende |
| Docker mount pre-flight | Inspect-first | Assume bind mount | Codex I4 — runbook può fallire silenziosamente |
| Daily-report alert | Count pending activations | Webhook-only | Codex I5 — fallback se webhook down |
| Session restore verify | State=open + send test message | State=open only | Codex NICE-TO-HAVE — crittografia può rompersi silenziosa |
| Egress storage state | `audit_events` event types | New table `egress_state` | Coerenza pattern ledger |
| Egress env schema | Enumerative `_HOST/_PORT/...` | JSON single env | Pool=2 leggibile; rivedi a 4+ |
| Quarantine TTL | 24h auto-recovery | Permanente | Self-healing, ops override disponibile |
| Test diagnostico campione | 2-3 numeri reali ICP D, distribuiti su 2 egress | 5+ Twilio | Bias caveat in ADR |
| Concierge usa proxy A1 | Sì | IP residenziale diretto | Evita salto IP residenziale → IPRoyal sospetto |
| Notifica admin §1 | Webhook generico + daily-report fallback | Webhook only | Codex I5 |
| Anti-spam form | Rate limit 1/IP/hour via rate_limit_state | hCaptcha | Defer captcha |

---

## Open questions residue per grill

(Decisioni che non posso prendere unilateralmente. Andrea risponde, oppure annotiamo in ADR.)

1. **Beta tester §3**: hai 2-3 utenti ICP D contattabili oggi per il test diagnostico distribuito sui 2 egress?
2. **`alwaysOnline: true` vs `false`** nel payload create — Evolution config attuale è `true`, dopo §3 valuti revisitare?
3. **Webshare vs alternativa milano**: hai preferenza provider per secondo egress? (Webshare $2.50, alternative: ProxyEmpire ISP $5+, Bright Data ISP $15+.)
4. **Encryption phone_e164_enc**: vuoi attivarlo subito (env `ACTIVATION_PHONE_ENC_KEY` settata) o lasciare null e contattare via `display_name`? Decisione operativa.
5. **Cap 3/giorno/IP**: con proxy diversificato, sblocco 5-7 onboarding più veloce ma più burst signal. Conservative 3 o 5?
6. **`PAIRING_EGRESS_POOL_JSON`** vs enumerative: cosmetico. Decide ora o in Fase 1?

---

## Note operative (annotabili in ADR — Codex NICE-TO-HAVE)

- Cap 3/IP/24h con NAT caveat: coworking, hotspot 4G condiviso, palestra Wi-Fi → fino a 2-3 utenti dietro stesso NAT possono saturare il cap. Mitigation se segnale empirico: cap a 5 o key combo IP+phone-prefix.
- Test diagnostico §3 sample bias: beta tester selezionati ≠ iscritti spontanei al lancio. Decisione architettura Fase 1 su sample piccolo + bias selezione = approssimata, da rivisitare quando si raggiungono 10+ pairing reali post-launch.
- Schema env enumerative non scala oltre 4-5 egress (open question #6). Decisione differita a Fase 1 quando pool cresce.
- Session restore §4: dry-run DEVE verificare crittografia via send messaggio reale, non solo state=open superficiale.

---

## Fuori scope Fase 0

- Multi-droplet routing automatico messaggi steady-state (Fase 1).
- `server_url` column `user_instances` (Fase 1).
- Per-tier egress routing premium (Fase 3).
- Vendor managed adapter Whapi/WASenderAPI (Strategic Trap).
- Captcha attivazione.
- Pricing tier adjustment (decisione separata).
- Modifica watchdog `instance_flapping`.
- Canary pairing sintetici.
- WhatsApp Business API ufficiale.
- Telegram bot dedicato notifica admin (Sprint 7 backlog #8).
- Endpoint admin UI per `activation_requests` (SQL + daily-report Fase 0; UI Sprint successivo).

---

## Next steps

1. Andrea risponde alle open questions residue (grill Step B).
2. Andrea OK esplicito su spec v3.
3. Invoke `writing-plans` skill → piano implementazione step-by-step.
4. Codice **solo dopo** OK Andrea.

---

## Riferimenti

- `docs/2026-06-11-brainstorm-ip-reputation.md` — research di campo
- Codex audit 2026-06-12 — 3 CRITICAL + 6 IMPORTANT + 4 NICE-TO-HAVE (incorporated v3)
- `supabase/migrations/20260526_rate_limit_state.sql` — rate limit infra atomico esistente
- `supabase/migrations/20260527_audit_events.sql:7-9` — policy PII commento
- `app/lib/rate-limit.ts` — usage rate_limit_state esistente
- `app/lib/log-scrubber.ts:45` — `scrubPiiForLog` + SHA-256 8-char hash
- `app/lib/monitoring.ts:252-284` (`checkPairingBlackout`), `:202-242` (`checkInstanceFlapping`)
- `app/api/auth/init/route.ts` (target integration §2)
- `app/api/webhook/route.ts:384-451` (CONNECTION_UPDATE)
- `app/api/cron/daily-report/*` (extension §1 I5)
- [Evolution API v2 — Create Instance (proxy fields)](https://doc.evolution-api.com/v2/api-reference/instance-controller/create-instance-basic)
- [Evolution API v2 — Set Proxy](https://doc.evolution-api.com/v2) (verify Sprint 0 §3 pre-req)
- [issue EvolutionAPI#2437](https://github.com/EvolutionAPI/evolution-api/issues/2437)
