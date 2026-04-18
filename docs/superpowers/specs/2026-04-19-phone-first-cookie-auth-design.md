# C1 — Auth Phone-First con Cookie Firmato

> **Spec data**: 2026-04-19
> **Codename interno**: C1 (riferimento CLAUDE.md "autenticazione dashboard")
> **Versione**: v1
> **Prerequisito di**: Quick Capture (feature successiva, fuori scope qui)

---

## 1. Sommario

Sostituire la "session" attuale basata su `localStorage` non firmato con una **sessione cookie HTTP-only firmata HMAC**, emessa nel momento in cui Evolution API conferma via webhook (`CONNECTION_UPDATE state=open`) che lo scan del QR/pairing-code è riuscito.

Il modello phone-first viene **mantenuto integralmente**: zero email, zero password, nessuno step aggiuntivo per l'utente. La differenza è invisibile lato UX e crittograficamente forte lato server.

---

## 2. Contesto e motivazione

### 2.1 Stato attuale

La dashboard oggi "autentica" l'utente leggendo da `localStorage` browser-side tre valori (`sw_phone`, `sw_instance`, `sw_expiry`). L'endpoint `/api/messages` "valida" verificando solo che esista una riga in `user_instances` con quel `phone_number`. Il middleware Next.js è disabilitato (passthrough totale).

### 2.2 Buco di sicurezza concreto

Per un utente **già onboarded** (la cui istanza WhatsApp è stata pairata almeno una volta, quindi `user_instances` esiste), un attaccante può accedere alla dashboard semplicemente conoscendo il numero di telefono — nessuna prova di possesso del dispositivo richiesta:

1. Apre `https://whatslaterpush.vercel.app/dashboard` in incognito
2. Da DevTools setta `localStorage.sw_phone = "393..."`, `sw_instance = "SchedWhats-393..."` (derivabile dal numero), `sw_expiry = "9999999999999"`
3. Ricarica → la dashboard chiama `/api/messages?phone=393...` → server ritorna tutti i messaggi schedulati della vittima

L'attaccante ottiene:
- Lettura totale: contenuto messaggi, destinatari (numeri di terzi), orari, storico
- Scrittura: cancellazione messaggi pending (`DELETE /api/messages`)
- DoS: disconnessione/re-pairing istanza WhatsApp (`POST /api/connect { action: "disconnect" | "getCodeAndPairing", phone }`)
- (Da verificare separatamente) Possibile abuso di `/api/payment/*`

Implicazioni:
- **Privacy GDPR-rilevante** (contenuto messaggi può essere sensibile)
- **Targeted abuse plausibile** (ex partner, competitor, stalker — barra d'ingresso = sapere il numero)
- **DoS gratuito** ripetibile

### 2.3 Stato utenti reali (verificato 2026-04-19)

| Metrica | Valore |
|---|---|
| `user_instances` totali | 3 |
| Connesse | 1 |
| Paganti | 0 |
| Trial | 0 |
| Free | 3 (test interni) |
| `auth.users` Supabase | 1 |
| Messaggi inviati ultimi 7gg | 0 |

→ Scenario "🟢 verde": momento più economico per fixare prima del lancio pubblico. Zero migration utenti rilevante.

### 2.4 Perché phone-first invece di email/password (Supabase Auth)

Decisione esplicita del prodotto: il flusso phone-first esistente ("inserisci numero → scan QR → dentro") è **simpler e si allinea al target Marco-in-cantiere**. Forzare signup email aggiungerebbe 2-3 step prima del primo valore visibile, contro la filosofia del prodotto.

**Insight architetturale chiave**: lo scan del QR/pairing-code WhatsApp **è già una prova crittograficamente forte di possesso del numero**. Oggi quella prova viene "buttata via" subito dopo l'esecuzione. Tutto il fix consiste nel **convertirla in una sessione server-validata** (cookie firmato) invece di sostituirla con un valore non firmato (localStorage).

---

## 3. Scope

### 3.1 In scope (v1)

- Cookie HTTP-only firmato HMAC come unica sessione dashboard
- Endpoint `/api/auth/*` per init/check/me/logout
- Tabella `pending_auth_sessions` per coordinazione browser ↔ webhook
- Middleware Next.js attivo che valida cookie sui path protetti
- Refactor `/api/messages`, `/api/connect`, `/api/payment/*` per leggere phone dal cookie
- Refactor dashboard page (rimozione localStorage)
- Estrazione del flusso "inserisci telefono + QR" in nuova pagina `/connect`
- Test unit + integration + E2E

### 3.2 Out of scope (v1.5+)

- **OTP via WhatsApp self-chat** per re-auth e multi-device. Limitazione accettata: utente che apre dashboard da nuovo device deve ri-pairare il QR. Documentata.
- **Eliminazione di Supabase Auth orfano** (`/login`, `/signup`, `lib/supabase/server.ts`, tabella `profiles`). Lasciati dormienti per opzionalità futura.
- **Quick Capture** — feature distinta, costruita sopra C1 in fase successiva.
- **Rate limiting su `/api/auth/init`** (anti-enumeration). Da valutare quando ci saranno utenti reali.

---

## 4. Architettura

### 4.1 Flusso primo accesso (utente nuovo o re-auth dopo cookie scaduto)

```
1. Browser apre /connect (nuova pagina)
2. Utente inserisce telefono "393..."
3. POST /api/auth/init { phone }
   ↓ Server:
   - Valida e normalizza phone (lib/phone.ts esistente)
   - INSERT pending_auth_sessions { id: UUID, phone, status: 'pending', expires_at: now+10min }
   - Esegue logica esistente equivalente all'azione getCodeAndPairing di /api/connect
     (Evolution API instance create + webhook config + upsert user_instances)
   - Risponde { sessionId, qrCode, pairingCode }
4. Browser mostra QR/pairing + inizia polling GET /api/auth/check?sessionId=<id> ogni 2s
5. Utente scansiona QR con WhatsApp sul telefono 393...
6. Evolution API → POST /api/webhook { CONNECTION_UPDATE, state:'open', ownerJid:'393...' }
   ↓ Handler webhook (NUOVO blocco aggiunto):
   - Logica esistente invariata (update connection_status, invio welcome)
   - NUOVO: UPDATE pending_auth_sessions
            SET status='authenticated', instance_name=<name>
            WHERE phone = ownerJid AND status='pending'
              AND expires_at > NOW()
            ORDER BY created_at DESC
            LIMIT 1  (gestisce tab multipli)
7. Polling /api/auth/check legge la riga (filtro: id = sessionId AND expires_at > NOW()):
   - status='authenticated' → server firma cookie HMAC, Set-Cookie header, DELETE session row
   - status='pending' → risponde { authenticated: false } (browser continua a pollare)
   - riga assente o expires_at passato → 410 Gone (browser ferma polling, mostra errore "QR scaduto, riprova")
   - risponde { authenticated: true, redirect: '/dashboard' } sul success
8. Browser redirect a /dashboard
```

### 4.2 Flusso accessi successivi

```
1. Browser apre /dashboard
2. Middleware verifica cookie sw_session:
   - Decodifica payload + verifica firma HMAC
   - Verifica exp non passato
   - Se iat > 7gg fa: ri-firma con nuovo iat (sliding window)
3. Request passa. Dashboard chiama /api/auth/me → ritorna { phone, instanceName } dal cookie
4. /api/messages, /api/connect, /api/payment/* leggono phone dal cookie (mai più body/query)
```

### 4.3 Flusso cookie scaduto / mancante / manomesso

```
Middleware → cookie assente o firma invalida o exp passato:
  - Se request è API → 401 JSON
  - Se request è page → redirect 302 a /
Utente clicca "Connetti WhatsApp" sulla landing → /connect → re-pair QR → nuovo cookie
```

### 4.4 Flusso multi-device (LIMITAZIONE NOTA v1)

```
Utente ha già pairato WhatsApp dal telefono. Apre dashboard dal portatile:
- Portatile non ha cookie → middleware redirect a /
- Va su /connect, inserisce stesso phone
- /api/auth/init → l'attuale logica getCodeAndPairing FORZA disconnessione istanza esistente
  e genera nuovo QR (comportamento già esistente)
- Utente deve scannerizzare QR di nuovo dal telefono
- Telefono perde brevemente WhatsApp connesso a SchedWhats, lo riprende dopo scan
```

In v1 questa è una limitazione accettata. La pagina `/connect` mostrerà un avviso esplicito quando rileva che il numero ha già un'istanza connessa: *"Connettere da un secondo dispositivo richiederà di ri-scannerizzare il QR. WhatsApp resterà disconnesso per ~30 secondi durante il pairing."*

In v1.5: OTP via WhatsApp self-chat per evitare il re-pairing.

---

## 5. Cookie firmato — formato e regole

### 5.1 Formato

```
Nome cookie:    sw_session
Valore:         <base64url(payload_json)>.<base64url(hmac_sha256(payload_json, AUTH_COOKIE_SECRET))>
Payload JSON:   { "phone": "393331234567", "instanceName": "SchedWhats-393331234567", "iat": 1745000000, "exp": 1752776000 }
Attributi:      HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000  (90 giorni)
```

### 5.2 Implementazione `app/lib/auth-cookie.ts`

Funzioni esposte:
- `signCookie(payload: { phone: string; instanceName: string }): string` — emette il valore cookie con `iat=now`, `exp=now+90gg`
- `verifyCookie(raw: string | undefined): { phone: string; instanceName: string; iat: number; exp: number } | null` — ritorna `null` se firma invalida o exp passato
- `shouldRefresh(payload): boolean` — true se `iat < now - 7gg`

Implementazione: `crypto.createHmac('sha256', secret)` di Node — zero dipendenze esterne. Confronto firma con `crypto.timingSafeEqual` per evitare timing attack.

### 5.3 Env var nuovo

```
AUTH_COOKIE_SECRET=<64 byte hex random>
```

Generabile con `openssl rand -hex 64`. Va aggiunto su Vercel produzione + locale `.env.local` + documentato in ARCHITETTURA.md.

Comportamento se assente: l'app **fallisce hard al boot** (lancia errore). Nessun fallback insicuro.

---

## 6. Schema DB — modifica

### 6.1 Nuova tabella

```sql
-- Migration: supabase/migrations/<timestamp>_pending_auth_sessions.sql

CREATE TABLE pending_auth_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'authenticated'
  instance_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT pending_auth_sessions_status_check CHECK (status IN ('pending', 'authenticated'))
);

CREATE INDEX idx_pending_auth_sessions_phone_status ON pending_auth_sessions (phone, status);
CREATE INDEX idx_pending_auth_sessions_expires ON pending_auth_sessions (expires_at);

-- RLS: la tabella è gestita solo da service role (no policies utente).
ALTER TABLE pending_auth_sessions ENABLE ROW LEVEL SECURITY;
-- Nessuna policy → solo service role legge/scrive.
```

### 6.2 Cleanup

Nel cron esistente (`/api/cron/send-messages`, all'inizio del cleanup block esistente):

```sql
DELETE FROM pending_auth_sessions WHERE expires_at < NOW() - INTERVAL '1 hour';
```

### 6.3 Niente altre modifiche di schema

Esplicitamente **non aggiungiamo `user_id` a `user_instances`**. Quella colonna serviva solo nel mondo Supabase Auth, che non usiamo. La chiave logica per identificare il proprietario di un'istanza resta `phone_number`, e il cookie firmato lo trasporta in modo non manomettibile.

---

## 7. File da creare

| File | Scopo | Dimensione stimata |
|---|---|---|
| `app/lib/auth-cookie.ts` | sign/verify HMAC + helper sliding refresh | ~80 righe |
| `app/api/auth/init/route.ts` | POST → crea pending session, invoca logica connect, ritorna QR + sessionId | ~120 righe |
| `app/api/auth/check/route.ts` | GET polling → setta cookie su success, cleanup row | ~80 righe |
| `app/api/auth/me/route.ts` | GET → ritorna `{ phone, instanceName }` dal cookie, 401 se assente | ~30 righe |
| `app/api/auth/logout/route.ts` | POST → Set-Cookie con Max-Age=0 | ~25 righe |
| `app/connect/page.tsx` | Nuova pagina: input telefono + QR display + polling check. Estratta dalla parte "connect" dell'attuale dashboard | ~250 righe |
| `supabase/migrations/<ts>_pending_auth_sessions.sql` | Migration tabella | ~25 righe |
| `__tests__/auth-cookie.test.ts` | Unit test sign/verify/tampering/expiry | ~120 righe |
| `__tests__/auth-flow.integration.test.ts` | Integration test init→webhook→check happy + edge | ~180 righe |

---

## 8. File da modificare

| File | Cosa cambia |
|---|---|
| `middleware.ts` | Sostituire passthrough con verifica cookie HMAC. Allowlist espliciti: `/`, `/connect`, `/login`, `/signup`, `/privacy`, `/terms`, `/api/auth/*`, `/api/webhook`, `/api/cron/*`, `/api/health`, `/api/admin/*`, `/api/monitoring/*`, asset Next. Sui path API protetti: 401 JSON. Sui path page protetti: redirect 302 a `/`. Sliding refresh se `iat > 7gg`. |
| `app/api/webhook/route.ts` | Nel handler `CONNECTION_UPDATE` (dopo aggiornamento `connection_status`), aggiungere blocco `UPDATE pending_auth_sessions SET status='authenticated' ...`. Resta sotto `WEBHOOK_SECRET`, nessuna riduzione di sicurezza esistente. |
| `app/api/messages/route.ts` | Rimuovere `?phone=` da GET, `phone` da body DELETE. Estrarre phone tramite `verifyCookie(req.cookies.get('sw_session')?.value)`. 401 se cookie assente/invalido. |
| `app/api/connect/route.ts` | Protezione cookie su tutte le azioni eccetto `setWebhook`/`refreshWebhooks` (già protette da `CRON_SECRET`). **Rimuovere** action `getCodeAndPairing` (la logica viene spostata dentro `/api/auth/init`). |
| `app/dashboard/page.tsx` | Rimuovere tutto il blocco localStorage (PHONE_KEY/INST_KEY/EXPIRY_KEY, getStored*, save*, clearPhone, validateSession). Sostituire con: chiamata a `/api/auth/me` su mount; redirect a `/connect` se 401; chiamate a `/api/messages` senza param. Logout button → POST `/api/auth/logout` → redirect `/`. |
| `app/api/payment/create-checkout/route.ts` | Estrarre phone dal cookie invece che da body. |
| `app/api/payment/portal/route.ts` | Stesso. |
| `app/api/cron/send-messages/route.ts` | Aggiungere DELETE cleanup di `pending_auth_sessions` scadute, nel block cleanup esistente. |
| `docs/ARCHITETTURA.md` | Aggiornare sezione auth + sezione DB (nuova tabella) + flussi. |
| `CLAUDE.md` | Cambiare riga `⚠️ C1 (autenticazione dashboard) — da fare dopo lancio` in `✅ C1 (autenticazione phone-first cookie firmato)`. |

---

## 9. Edge cases con risoluzione esplicita

| # | Caso | Risoluzione |
|---|---|---|
| 1 | Race: utente scansiona QR prima che browser inizi polling | Stato in DB, non in memoria. Polling lo trova quando arriva. Nessun problema. |
| 2 | Tab multipli aperti per stesso phone | Webhook UPDATE con `ORDER BY created_at DESC LIMIT 1`: marca la più recente. Le altre scadono e sono pulite dal cron. |
| 3 | `ownerJid` ricevuto dal webhook non matcha il `phone` della pending session | UPDATE non trova righe → polling continua → timeout (10 min) → utente vede errore "QR scansionato con il numero sbagliato". |
| 4 | Cookie scaduto durante uso attivo | Middleware risponde 401. Frontend intercetta → redirect a `/connect`. |
| 5 | Cookie firma manomessa | `verifyCookie` ritorna null. Middleware tratta come assente. |
| 6 | Furto cookie (XSS/malware client) | Mitigato da HttpOnly + Secure + SameSite=Lax. Residuo: accesso fisico al browser dell'utente — fuori scope. Nessuna revocation list in v1. |
| 7 | 3 utenti pre-esistenti dopo deploy | Non hanno cookie. Devono andare su `/connect` e ri-scannerizzare. Documento + email manuale. |
| 8 | Webhook arriva ma `pending_auth_sessions` è scaduta | UPDATE non trova righe (filtro `expires_at > NOW()`). Polling timeout. Utente riprova. |
| 9 | `AUTH_COOKIE_SECRET` ruotato in produzione | Tutti i cookie esistenti diventano invalidi → tutti gli utenti devono ri-pairare. Operazione di emergenza, non di routine. |
| 10 | Multi-device (portatile dopo telefono) | LIMITAZIONE V1: re-pair forzato. Avviso UI esplicito su `/connect` quando rileva istanza già connessa. v1.5 risolverà con OTP via self-chat. |

---

## 10. Modello di sicurezza

### 10.1 Garanzie post-C1

| Proprietà | Garantita da |
|---|---|
| Solo chi possiede WhatsApp del numero X può autenticarsi come X | Webhook `ownerJid` verificato == phone in pending session, sotto `WEBHOOK_SECRET` |
| Sessione non manomettibile lato client | HMAC-SHA256 con secret server-side, `timingSafeEqual` per il confronto |
| Cookie non leggibile da JavaScript | HttpOnly |
| Cookie non inviato in cleartext | Secure (HTTPS only) |
| CSRF mitigato | SameSite=Lax + (se servirà per write op cross-site) check `Origin` header |
| `/api/messages`, `/api/connect`, `/api/payment/*` non accessibili senza prova di possesso | Middleware + verifica cookie |
| Endpoint `getCodeAndPairing` non più disponibile come azione separata exploitable | Rimosso, logica spostata dentro `/api/auth/init` (che crea pending session vincolante) |

### 10.2 Vettori RIMASTI fuori scope (con motivazione)

- **Rate limiting su `/api/auth/init`** — un attaccante che spamma init non ottiene accesso (serve sempre lo scan QR), ma può causare costo Evolution API (creazione/distruzione istanze). Da aggiungere quando ci saranno utenti reali.
- **Logout server-side / revocation list** — il cookie è valido fino a `exp` anche dopo logout (logout pulisce solo client). Aggiunge complessità (tabella sessioni revocate). Da valutare se richiesto.
- **2FA** — fuori target prodotto.
- **Session binding a User-Agent / IP** — false positive su mobile (cambio rete) > beneficio reale.

---

## 11. Strategia di test

### 11.1 Unit (`__tests__/auth-cookie.test.ts`)

- `signCookie + verifyCookie` round-trip
- Manomissione payload → `verifyCookie` ritorna null
- Manomissione signature → null
- Cookie scaduto (`exp < now`) → null
- Cookie con `iat > 7gg` → `shouldRefresh` ritorna true
- Confronto firma usa `timingSafeEqual` (verifica indiretta: test sull'API esposta)
- Errore se `AUTH_COOKIE_SECRET` mancante al boot

### 11.2 Integration (`__tests__/auth-flow.integration.test.ts`)

Mock di Supabase + Evolution API. Coprire:
- Happy path: init → webhook fires → check → cookie set
- Tab multipli: 2 init paralleli → webhook UPDATE marca solo la più recente
- Webhook arriva con phone diverso da pending → polling timeout
- Polling dopo cookie set → 200 e cleanup row
- Cookie inviato a `/api/messages` valido → ritorna messaggi
- Cookie manomesso a `/api/messages` → 401
- Cookie assente a `/api/messages` → 401
- DELETE `/api/messages` con cookie phone diverso da owner del messaggio → 403

### 11.3 E2E (`__tests__/e2e/auth.spec.ts` Playwright)

- Aggiornare `auth.spec.ts` esistente: oggi testa /login Supabase Auth (non più rilevante in pratica), aggiungere test del flusso `/connect` reale (mockando Evolution API e webhook).
- Test logout pulisce cookie.

### 11.4 Test esistenti da aggiornare

- `cron.integration.test.ts` — aggiungere assertion sul cleanup `pending_auth_sessions`
- `webhook.integration.test.ts` — aggiungere case CONNECTION_UPDATE state=open con e senza pending session
- Rimuovere/aggiornare test esistenti su `/api/messages?phone=` (oggi probabilmente esistenti)

---

## 12. Rollout plan

Singolo deploy atomico (zero utenti reali = no rolling):

1. Aggiungere `AUTH_COOKIE_SECRET` in Vercel + locale
2. Apply migration `pending_auth_sessions`
3. Deploy del codice (tutto insieme: middleware, route, dashboard)
4. Smoke test in produzione: aprire `/connect`, fare flusso completo con un numero test
5. Notificare i 3 utenti test: "fai logout, rivai su /connect e ri-pairare"
6. Aggiornare `CLAUDE.md` e `ARCHITETTURA.md`

Rollback plan: `git revert` del commit + rollback Vercel deploy. La migration può restare (la tabella vuota non rompe nulla). I cookie già emessi diventano inutilizzati ma non causano errori.

---

## 13. Stima effort

| Pezzo | Ore |
|---|---|
| `auth-cookie.ts` + unit test | 1-2h |
| Migration + cleanup nel cron | 0.5h |
| `/api/auth/init` (con estrazione logica connect) | 2-3h |
| `/api/auth/check` + cookie minting | 1-2h |
| `/api/auth/me`, `/api/auth/logout` | 0.5h |
| Webhook update | 0.5h |
| Middleware HMAC + allowlist | 1-2h |
| Refactor `/api/messages` | 1-2h |
| Refactor `/api/connect` | 1-2h |
| Refactor `/api/payment/*` | 1h |
| `app/connect/page.tsx` + cleanup dashboard | 3-4h |
| Test integration + E2E + aggiornamento esistenti | 2-3h |
| Aggiornamento docs (ARCHITETTURA, CLAUDE.md) | 0.5h |
| Buffer | 2-3h |
| **Totale** | **16-24h** (~2-3 giornate) |

---

## 14. Open questions / future work

- **OTP via WhatsApp self-chat (v1.5)** — risolve multi-device, riduce friction re-auth. ~3-4h.
- **Rate limiting `/api/auth/init`** — quando ci saranno utenti reali, per evitare abuse Evolution API.
- **Revocation list / logout server-side** — se emergerà necessità di "log out from all devices".
- **Decisione futura su `/login` `/signup`** — restano dormienti. Quando il prodotto avrà chiarezza su "vogliamo email/password mai?", decidere se cancellarli o riattivarli.
- **Aggiornamento ARCHITETTURA.md sul mismatch `user_id`**: la sezione "Tabella user_instances" dichiara una colonna `user_id` che non esiste in DB. Va rimossa indipendentemente da C1.

---

## 15. Riferimenti file di codice attualmente coinvolti

- `middleware.ts` — passthrough da sostituire
- `app/dashboard/page.tsx:14-30` — blocco localStorage da rimuovere
- `app/dashboard/page.tsx:67-95` — `validateSession` da rimuovere
- `app/api/messages/route.ts:15-89` — refactor completo GET + DELETE
- `app/api/connect/route.ts` — protezione + rimozione getCodeAndPairing
- `app/api/webhook/route.ts` — handler CONNECTION_UPDATE da estendere
- `app/api/payment/create-checkout/route.ts`, `app/api/payment/portal/route.ts` — derive phone da cookie
- `app/api/cron/send-messages/route.ts` — aggiungi cleanup
- `lib/phone.ts` — riusare `normalizeItalianPhone` esistente
- `lib/evolution/client.ts` — riusare client esistente per Evolution API
