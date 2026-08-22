# RUNBOOK — Attivazione Google Calendar sync (promemoria automatici)

> Scopo: passi esatti per accendere la feature `CALENDAR_SYNC_ENABLED` in produzione.
> La feature è **opt-in, default SPENTA**: senza questi passi non esiste (la card in
> dashboard non compare, le route rispondono 404/`{enabled:false}`).
>
> ⚠️ Repo PUBBLICO: i valori reali dei secret NON vanno MAI scritti qui, né committati.
> Ovunque vedi `<PLACEHOLDER>` sostituisci a mano al momento dell'esecuzione.

## Cosa fa la feature (ripasso in 3 righe)

L'utente collega il suo Google Calendar (sola lettura). Ogni ~15 min un cron scansiona
gli eventi dei prossimi 14 giorni: gli eventi con un numero di telefono nel titolo
(o descrizione/luogo) generano un promemoria WhatsApp auto-schedulato nella normale
pipeline `scheduled_messages`, idempotente per evento.

## Prerequisiti

- [ ] Migration **`supabase/migrations/20260822_calendar_sync.sql`** applicata in prod
      (tabella `calendar_connections` + colonna/indice `scheduled_messages.calendar_event_key`).
      Applicala dal SQL editor Supabase (progetto `inheoexhtuyjtfotbzyw`) o con la
      procedura migration standard. **Verifica**:
      ```sql
      select to_regclass('public.calendar_connections');           -- non-null
      select column_name from information_schema.columns
        where table_name = 'scheduled_messages'
          and column_name = 'calendar_event_key';                  -- 1 riga
      ```
- [ ] Env già presenti su Vercel (non toccarle): `AUTH_COOKIE_SECRET`, `CRON_SECRET`,
      `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

## (a) Google Cloud Console — OAuth client

1. Vai su https://console.cloud.google.com → **crea un progetto** (es. `whatslater-calendar`).
2. **APIs & Services → Library** → cerca **Google Calendar API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**.
   - App name / support email / developer email: compila con i dati WhatsLater.
   - **Scopes**: aggiungi solo `https://www.googleapis.com/auth/calendar.readonly`.
   - **Test users**: finché l'app non è verificata da Google, aggiungi qui gli account
     Gmail che potranno collegarsi (il tuo + i beta tester). Fuori da questa lista il
     consent fallisce con `access_denied`.
   - Publishing status: puoi restare in **Testing** per la beta (max 100 test user).
     ⚠️ In Testing i refresh token **scadono dopo 7 giorni**: per la prova va bene,
     per l'uso reale porta l'app a **In production** (basta il passaggio di stato;
     la verifica Google completa serve solo oltre certe soglie di utenti).
4. **APIs & Services → Credentials → Create credentials → OAuth Client ID**:
   - Application type: **Web application**, nome es. `whatslater-web`.
   - **Authorized redirect URIs** (entrambi, esatti):
     - `https://whatslaterpush.vercel.app/api/calendar/callback`
     - `http://localhost:3000/api/calendar/callback`
   - Salva → copia **Client ID** e **Client secret**.

## (b) Genera CALENDAR_TOKEN_SECRET

Chiave AES-256-GCM per cifrare i refresh token Google a riposo (64 hex = 32 byte):

```bash
openssl rand -hex 32
```

Conserva il valore nel password manager. Se un domani va ruotata: i token cifrati con
la vecchia chiave diventano illeggibili → ogni utente dovrà ricollegare il calendario
(la card mostrerà "Ricollega"); non è distruttivo, solo attrito.

## (c) Env su Vercel + redeploy

4 variabili, tutte su **Production** (ripeti per Preview solo se serve testare lì):

```bash
vercel env add CALENDAR_SYNC_ENABLED production        # valore: true
vercel env add GOOGLE_CALENDAR_CLIENT_ID production    # valore: <CLIENT_ID>.apps.googleusercontent.com
vercel env add GOOGLE_CALENDAR_CLIENT_SECRET production # valore: <CLIENT_SECRET>   (Sensitive)
vercel env add CALENDAR_TOKEN_SECRET production        # valore: <64_HEX_DA_OPENSSL> (Sensitive)

# Le env si applicano solo con un nuovo deploy:
vercel redeploy --prod
```

Note:
- `NEXT_PUBLIC_APP_URL` è **OBBLIGATORIA in produzione** (review sicurezza:
  l'origin non deve mai derivare dall'header Host, che è influenzabile dal
  client). Valore: `https://whatslaterpush.vercel.app` — origin SENZA
  trailing slash. Senza di essa, /api/calendar/auth risponde 500
  `calendar_sync_misconfigured`. Il fallback dall'origin della richiesta
  esiste solo in dev locale.
- Marca CLIENT_SECRET e TOKEN_SECRET come **Sensitive** (gotcha noto: le var
  Sensitive escono vuote da `vercel env pull` — è atteso).

## (d) Trigger pg_cron (Supabase) — ogni 15 minuti

Il trigger NON sta in `vercel.json` (stessa postura di `send-messages-cron`, Task 43):
è un job pg_cron nel progetto Supabase. Dal SQL editor:

```sql
-- Variante consigliata: secret nell'header Authorization (postura Task 44,
-- niente secret in chiaro nella query string / nei log del comando URL).
select cron.schedule(
  'calendar-sync-cron',
  '*/15 * * * *',
  $$ select net.http_get(
       url     := 'https://whatslaterpush.vercel.app/api/cron/calendar-sync',
       headers := '{"Authorization": "Bearer <CRON_SECRET>"}'::jsonb
     ) $$
);
```

```sql
-- Alternativa legacy (stessa forma di send-messages-cron, ?secret= in chiaro):
-- select cron.schedule(
--   'calendar-sync-cron',
--   '*/15 * * * *',
--   $$ select net.http_get('https://whatslaterpush.vercel.app/api/cron/calendar-sync?secret=<CRON_SECRET>') $$
-- );
```

La route accetta entrambe le forme (`Authorization: Bearer` O `?secret=`, come
`send-messages` post-`c9fe33a`). `<CRON_SECRET>` = lo stesso `CRON_SECRET` di Vercel.

**Verifica salute del job** (stesse query del runbook cron-triggers):

```sql
select jobid, schedule, jobname, active from cron.job where jobname = 'calendar-sync-cron';

select count(*) runs,
       count(*) filter (where status = 'failed') failed,
       max(start_time) last_run
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'calendar-sync-cron')
  and start_time > now() - interval '24 hours';
-- Atteso in salute: runs ≈ 96/giorno, failed = 0.
```

Lato app: ogni run con flag acceso timbra `ops_heartbeat` con nome `calendar-sync`.

**Spegnimento** (rollback trigger): `select cron.unschedule('calendar-sync-cron');`

## (e) Smoke test E2E (checklist)

1. [ ] Login in dashboard → compare la card **"Promemoria da Google Calendar"**
       (se non compare: flag non attivo o deploy vecchio).
2. [ ] Click **"Collega Google Calendar"** → consent Google (con un account nella
       lista test users) → redirect a `/dashboard?calendar=connected` → toast
       "Google Calendar collegato!" e card con l'email collegata.
3. [ ] Crea sul calendario un evento **domani** (non oggi: eviti il clamp) tipo:
       `Prova +39347XXXXXXX alle 15` — il numero deve essere un TUO numero di test.
4. [ ] Aspetta un ciclo di sync (≤15 min; o forza:
       `curl -H "Authorization: Bearer <CRON_SECRET>" https://whatslaterpush.vercel.app/api/cron/calendar-sync`
       → atteso `{"enabled":true,"connections":1,"results":[{"status":"ok","inserted":1,...}]}`).
5. [ ] In dashboard compare il messaggio programmato: destinatario = numero
       dell'evento, testo dal template, orario = inizio evento − anticipo (default 1h).
       In DB la riga ha `calendar_event_key` valorizzato.
6. [ ] Sposta l'evento di 1 ora → al sync successivo la riga pending si riallinea
       (stesso `calendar_event_key`, niente duplicati).
7. [ ] Cancella l'evento dal calendario → al sync successivo la riga pending passa
       a `cancelled` con `error_message='calendar_event_removed'`.
8. [ ] **"Scollega"** dalla card → i promemoria pending della connessione diventano
       `cancelled` (`calendar_disconnected`) e la card torna alla CTA di collegamento.
9. [ ] (Facoltativo) Ricollega e lascia vivo un evento reale per validare l'invio
       WhatsApp end-to-end dalla pipeline `send-messages`.

## Rollback completo

1. `select cron.unschedule('calendar-sync-cron');`
2. Rimuovi `CALENDAR_SYNC_ENABLED` da Vercel (o settala ≠ `true`) + `vercel redeploy --prod`.
   → card invisibile, route calendar 404, cron risponde `{enabled:false}` senza lavorare.
3. I dati restano (connessioni cifrate + righe già schedulate): per bonificare anche
   quelli, cancella le righe `scheduled_messages` pending con `calendar_event_key not null`
   e svuota `calendar_connections`. Non serve toccare la migration.
