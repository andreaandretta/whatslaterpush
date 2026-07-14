# WhatsLater — Piano di hardening pre-scala beta (5–10 utenti concorrenti)

> **Per l'esecutore (modello economico):** esegui una task alla volta, in ordine. Ogni task è indipendente e committabile da sola. Le task usano checkbox `- [ ]`. NON saltare i comandi di verifica: se l'output atteso non compare, **fermati e non committare** quella task — passa alla successiva e segnala il blocco.
>
> **Skill consigliata:** superpowers:executing-plans (esecuzione a batch con checkpoint).

**Goal:** portare l'infrastruttura WhatsLater dallo stato "testato da 1 utente (il founder)" a "regge 5–10 utenti ICP reali che fanno pairing e inviano in concorrenza", riducendo al minimo il rischio che l'infra ceda o che un incidente bruci la fiducia dei primi beta tester.

**Architettura del sistema (contesto):** Next.js 14 App Router su Vercel (piano **Hobby**, lambda ~10s, nessun `maxDuration` esportato oggi), Supabase Postgres, Evolution API v2 self-hosted su **un singolo nodo Hetzner** (Coolify, immagine Baileys patchata). Stripe è disattivato via kill-switch `BILLING_ENABLED=false` (beta gratis: piano sintetico `beta` runtime, mai persistito). Il cuore è il cron `/api/cron/send-messages` e il monolite `/api/webhook/route.ts` (1874 righe, gestisce pairing + parser self-chat + contatti + delivery).

**⚠️ Stack trigger REALE del cron (verificato in prod, diverso da CLAUDE.md).** `/api/cron/send-messages` è colpito ogni 60s da questi trigger (+ una safety-net giornaliera):
1. **pg_cron `send-messages-cron` dentro Supabase** — `* * * * *`, il vero workhorse: **84.806 run dal 13-mag, 0 fallimenti**. Chiama `net.http_get('…/api/cron/send-messages?secret=<CRON_SECRET>')`. **Non documentato in CLAUDE.md.** (vedi Task 43)
2. **self-cron `instrumentation.ts` @60s** — un `setInterval` per ogni istanza lambda Node warm, staggerato a :30.
3. **cron-job.org @60s** — esterno, **Inactive dal 12-giu-2026** (verificato): non è più un consumer vivo.
4. **vercel.json `0 0 * * *`** — safety-net giornaliera.
Il lock atomico (`send_attempted_at` + CAS `pending→processing`) previene il doppio invio, ma **ogni** fire ri-esegue tutto il preamble (reset RPC, scan full-table ricorrenze, cleanup). Task 43 documenta lo stack; Task 43-bis (dopo Task 44) tiene pg_cron come unico motore; Task 44 ruota il `CRON_SECRET` esposto in chiaro nel comando pg_cron.

**Tech stack:** TypeScript 5.5, Jest 30 (unit + integration), Playwright (e2e, suite separata), Supabase JS v2, Zod.

---

## ✅ DECISIONI DI ANDREA (recepite — l'esecutore le applica come sotto)

Le 6 decisioni di prodotto/infra sono state prese. Le task sotto sono già aggiornate di conseguenza; le task infra restano da eseguire in una sessione ops guidata (non dall'esecutore).

1. **Toggle "Richiedi approvazione" (Task 11) e "Promemoria" (Task 12): RIMUOVERE dalla UI ora, ma progettati per riattivazione E2E facile.** Non cancellare il codice: nascondere i toggle dietro un flag `false` in modo che riattivarli in futuro sia un flip + il wiring backend. Vedi Task 11/12.

2. **`syncFullHistory` (Task 5): ~~DISATTIVARLO (opzione a)~~ → RIVISTA in opzione (b) semaforo (11-lug).** L'opzione (a) è stata scartata: il codice documenta un incidente (`6d3fb6b`) in cui disattivare il full-sync svuotava la rubrica di ogni nuovo utente. Implementato invece un **semaforo distribuito** che preserva il burst di contatti e serializza i full-sync concorrenti contro l'OOM. Vedi Task 5.

3. **Rate-limit `/api/auth/init` (Task 4): SÌ, riusando `rate_limit_state` + RPC atomica esistente.** Nessuna tabella nuova: si riusa `rate_limit_record`. Vedi Task 4 (codice pronto).

4. **TLS Evolution (Task 22), rotazione secret (Task 32+44), backup Baileys (Task 21): runbook con COMANDI ESATTI da incollare, NON eseguiti dall'esecutore.** Andrea li chiude in sessione ops guidata (come il decommission DigitalOcean). La rotazione copre **`CRON_SECRET`, `OPS_SECRET`, `WEBHOOK_SECRET`** (tutti esposti). **⚠️ Dipendenza sequenziale imposta da Andrea:** Task 43-bis (spegnere cron-job.org + self-cron) è **BLOCCATA-DA Task 44 completata + pg_cron verificato per 24h col nuovo secret** — così un errore di rotazione non causa un blackout invii.

5. **HMAC webhook (Task 23): N/A per ora.** Confermato che Evolution v2.3.7 **non firma** gli eventi. La protezione resta `WEBHOOK_SECRET` in header. **Non** "in attesa di config": è una decisione chiusa, la task è marcata N/A.

6. **Taglio zavorra (Task 37/40): SÌ, lista mostrata sotto per revisione.** Andrea è consapevole che cancellare da HEAD non pulisce la history git — è igiene, non segretezza. La lista esatta (verificata con grep) è nella Task 37 e 40.

> **Correzione post-verifica:** `app/components/Logo.tsx` e `components/Logo.tsx` sono **entrambi vivi e distinti** (uno è la versione `<img>`/PWA, l'altro SVG inline) — **NON vanno cancellati**. L'unico vero orfano è `components/ConnectStepper.tsx`. Vedi Task 37.

---

## 🗺️ Indice esecutivo (task → fase → severità → file toccati)

**Fasatura dell'esecuzione (imposta da Andrea — NON eseguire tutto in una volta):**
- **FASE 1 (subito):** solo **P0, Task 1→7**. L'esecutore **si ferma dopo la Task 7** e NON entra in P1. Andrea valida prima di proseguire.
- **FASE 2 (dopo validazione P0 di Andrea):** **P1** — Task 8→17, 42, 43. Escluse le parti runbook-infra. Task 43-bis resta in attesa (dipende da Task 44 = ops).
- **FASE 3+ (dopo i primi utenti):** **P2/P3** — Task 18→20, 24→31, 33→41.
- **🔒 SESSIONE OPS DI ANDREA (fuori dall'esecutore economico):** Task **21** (backup Baileys), **22** (TLS), **32** (OPS_SECRET), **44** (esecuzione rotazione), **43-bis** (spegnimento self-cron, dopo 44). L'esecutore NON tocca queste — i comandi esatti sono già nel piano per la sessione ops guidata.

| # | Task | Fase | Severità | File principali |
|---|------|------|----------|-----------------|
| 1 | Separare Playwright da Jest (baseline onesta) | 1 | high | `jest.config.js` |
| 2 | Circuit-breaker: riprogramma oltre mezzanotte + dedup notifica | 1 | **critical→high** | `app/api/cron/send-messages/route.ts` |
| 3 | Fairness per-utente (max 8/utente/tick) | 1 | **critical→high** | `app/api/cron/send-messages/route.ts` |
| 4 | Rate-limit `/api/auth/init` (riusa `rate_limit_record`) | 1 | **critical→high** | `app/api/auth/init/route.ts` |
| 5 | Full-sync gate-ato da semaforo (opzione b, + verifica E2E) | 1 | high→medium | `app/api/auth/init/route.ts` + migration |
| 6 | Timeout invio non ri-accoda (no duplicati) | 1 | high | `app/api/cron/send-messages/route.ts` |
| 7 | `maxDuration` webhook + release claim su uscita | 1 | high→medium | `app/api/webhook/route.ts` |
| 8 | DELETE con guard di stato + client rispetta res.ok | 2 | high→medium | `app/api/messages/route.ts`, `app/dashboard/page.tsx` |
| 9 | Cooldown non bypassabile intra-batch | 2 | high | `app/api/cron/send-messages/route.ts` |
| 10 | "Modifica" usa PATCH in-place (no doppia consegna) | 2 | high | `app/dashboard/page.tsx`, `components/ScheduleModal.tsx` |
| 11 | Nascondere toggle approvazione/promemoria dietro flag | 2 | high | `components/ScheduleModal.tsx` |
| 13 | Banner "WhatsApp disconnesso" + CTA | 2 | high | `app/dashboard/page.tsx` |
| 14 | Welcome punta alla dashboard, non al self-chat | 2 | high | `app/api/webhook/route.ts` |
| 15 | Cap contatti via COUNT SQL (no troncamento 1000) | 2 | high→medium | `app/api/messages/route.ts` |
| 16 | Reschedule su `now()`, non su scheduled_at stale | 2 | medium | `app/lib/cron-utils.ts` |
| 17 | health-check probe paralleli + `maxDuration` | 2 | high | `app/lib/monitoring.ts`, `app/api/monitoring/health-check/route.ts` |
| 42 | `fetchCache='force-no-store'` su 14 route | 2 | high | 14 route in `app/api/**` |
| 43 | Documentare pg_cron primario | 2 | medium | `CLAUDE.md`, `docs/RUNBOOK-cron-triggers.md` |
| 43-bis | Spegnere self-cron (pg_cron canonico) | 🔒 ops (post-44) | medium | `instrumentation.ts` |
| 18 | Onset alert atomico (backlog #9) | 3 | medium | `app/lib/monitoring.ts` + migration |
| 19 | Heartbeat tutti i cron + dead-man esterno | 3 | medium | `app/lib/monitoring.ts`, cron routes |
| 20 | Capacity guard (soft cap istanze) | 3 | medium | `app/api/auth/init/route.ts` |
| 21 | Backup offsite sessioni Baileys | 🔒 ops | medium | `docs/RUNBOOK-backup-baileys.md` |
| 22 | Evolution TLS + firewall | 🔒 ops | medium | `docs/RUNBOOK-evolution-tls.md` |
| 23 | HMAC webhook — **N/A** (Evolution non firma) | — | — | — |
| 24 | Chiudere buchi PII nei log | 3 | medium | `app/api/webhook/route.ts`, `app/lib/log-scrubber.ts` |
| 25 | Canale alert non circolare + email verificata | 3 | medium | `app/lib/monitoring.ts` |
| 26 | Rimuovere "✅ Inviato" per ogni messaggio | 3 | medium | `app/api/cron/send-messages/route.ts` |
| 27 | Link "Aiuto/Segnala" in-app | 3 | medium | `app/dashboard/page.tsx`, `app/connect/page.tsx` |
| 28 | Messaggi bot fuori dal parser LLM | 3 | medium | `app/api/webhook/route.ts` |
| 29 | Welcome/disclaimer con CAS (no doppio) | 3 | medium | `app/api/webhook/route.ts` |
| 30 | `import 'server-only'` in billing.ts | 3 | medium | `app/lib/billing.ts` |
| 31 | CI (`tsc`+jest) + togliere `ignoreBuildErrors` | 3 | high | `.github/workflows/ci.yml`, `next.config.js` |
| 32 | Ruotare OPS_SECRET + header-only mutazioni | 🔒 ops | medium | `app/lib/ops-auth.ts` + runbook |
| 33 | Errori pairing inline, non `alert()` | 3 | medium | `app/connect/page.tsx` |
| 34 | Host-metrics stale → alert reale | 3 | medium | `app/lib/monitoring.ts` |
| 35 | Normalizzazione telefono no-corruzione esteri | 3 | medium | `app/lib/phone.ts`, `app/api/contacts/import/route.ts` |
| 36 | `verifyAndFixMessage` guard troncamento | 3 | medium | `app/api/webhook/route.ts` |
| 37 | Cancellare orfano `ConnectStepper` (SOLO quello) | 3 | low | `components/ConnectStepper.tsx` |
| 38 | Allineare `.env.example`/README/CLAUDE.md | 3 | low | `.env.example`, `README.md`, `CLAUDE.md` |
| 39 | Rigenerare `types/supabase.ts` + indice caldo | 3 | medium | `types/supabase.ts` + migration |
| 40 | Ripulire zavorra repo pubblico (16 HTML + 3 doc) | 3 | low | `sprint5/`, doc deprecati |
| 41 | `cleanup-media` throughput beta | 3 | medium | `app/api/cron/cleanup-media/route.ts` |
| 44 | Ruotare CRON_SECRET (+OPS+WEBHOOK) | 🔒 ops | medium | `docs/RUNBOOK-rotazione-secret.md` |

*(Task 12 unita a 11.) Severità `X→Y` = severità iniziale → aggiustata dalla verifica avversariale.*

---

## Regole di esecuzione (leggi prima di iniziare)

- **⚠️ FASE 1 SOLO: esegui Task 1→7, poi FERMATI.** Non entrare in P1/Fase 2 finché Andrea non valida la P0. Non toccare le task marcate 🔒 (sessione ops di Andrea).
- **Branch:** lavora su un branch dedicato, non su `main`.
  ```bash
  git checkout -b beta-hardening
  ```
- **Un commit per task**, messaggio `fix(area): <task> — <finding ref>`. Termina ogni messaggio con:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  ```
- **NON toccare** senza una task esplicita: la logica del kill-switch beta (`app/lib/billing.ts` salvo Task 30), il flusso di riattivazione billing (`docs/RUNBOOK-riattivazione-billing.md`), le migration già applicate. Sono decisioni deliberate del founder.
- **NON deployare in produzione.** Il flip in prod lo fa Andrea. Il tuo output è il branch.
- **Baseline test attesa** (da eseguire una volta all'inizio, prima di qualsiasi modifica):
  ```bash
  npx jest --ci --maxWorkers=4 2>&1 | tail -5
  ```
  Atteso PRIMA della Task 1: **873 pass, 13 fail** (8 suite Playwright erroneamente raccolte da Jest + 3 integration flaky: `cron.integration`, `webhook.integration`, `webhook-quick-capture`). Dopo la **Task 1** i 13 fail scendono a **3** (i soli integration flaky). Da quel momento, **qualsiasi test rosso che non sia uno di quei 3 = regressione tua**: fermati.
- **`tsc` deve restare pulito:** `npx tsc --noEmit` non deve introdurre errori nuovi.

---

# TIER P0 — Ship-blocker: segnale onesto, collasso concorrente, perdita silenziosa di messaggi

Questi proteggono il servizio dal cedere quando più utenti lo usano insieme, e i messaggi dall'essere persi/duplicati in silenzio. Fai questi per primi.

---

### Task 1: Separare Playwright da Jest (baseline di test onesta)

**Perché:** `jest.config.js` raccoglie tutto sotto `__tests__/`, incluse le 8 suite `.spec.ts` di Playwright, che falliscono sempre perché Jest non sa eseguirle. Risultato: la suite è **cronicamente rossa** e nasconde le regressioni vere. È il prerequisito di ogni verifica successiva. — *Finding #17 (high), confermato.*

**Files:**
- Modify: `jest.config.js:6`

- [ ] **Step 1: Verificare lo stato rosso attuale**

Run: `npx jest --ci --maxWorkers=4 2>&1 | tail -3`
Atteso: righe tipo `Tests: 13 failed, 873 passed` (o simile: ci sono 8 suite Playwright + 3 integration flaky).

- [ ] **Step 2: Escludere le directory Playwright dalla raccolta Jest**

In `jest.config.js`, sostituisci la riga `testPathIgnorePatterns`:

```js
  testPathIgnorePatterns: ['<rootDir>/__tests__/helpers/'],
```

con:

```js
  testPathIgnorePatterns: [
    '<rootDir>/__tests__/helpers/',
    '<rootDir>/__tests__/e2e/',        // Playwright — girano via `npm run test:e2e`
    '<rootDir>/__tests__/e2e-local/',  // Playwright locale
  ],
```

- [ ] **Step 3: Verificare che la baseline sia ora quasi verde**

Run: `npx jest --ci --maxWorkers=4 2>&1 | tail -5`
Atteso: le suite fallite scendono a **3** — solo `cron.integration.test.ts`, `webhook.integration.test.ts`, `webhook-quick-capture.test.ts` (flaky pre-esistenti del backlog, non tuoi). Nessuna suite `e2e` nell'elenco.

- [ ] **Step 4: Verificare che Playwright giri ancora dalla sua config**

Run: `grep -n "testDir" playwright.config.ts`
Atteso: `testDir: './__tests__/e2e'` — la suite e2e resta accessibile via `npm run test:e2e`, solo separata da Jest.

- [ ] **Step 5: Commit**

```bash
git add jest.config.js
git commit -m "fix(test): escludi le suite Playwright dalla raccolta Jest — baseline onesta (#17)"
```

---

### Task 2: L'utente in circuit-breaker non deve affamare la coda globale né spammare notifiche

**Perché:** quando un utente supera 5 fallimenti/24h, `checkFailures` ritorna `'skipped'` **senza toccare la riga**: quella resta `pending` con `scheduled_at` nel passato e **rientra nella finestra globale `limit(25)` oldest-first a ogni tick**, affamando la consegna di tutti gli altri. Inoltre la notifica "⚠️ Messaggi sospesi" parte a **ogni tick**, senza dedup né timeout → decine di sendText/ora verso un'istanza probabilmente giù. Con 5–10 utenti, un solo bloccato degrada tutti. — *Finding #0 (critical→high), confermato.* Il codebase ha già il pattern corretto da copiare al ramo daily-limit (`route.ts:439-442`).

**Files:**
- Modify: `app/api/cron/send-messages/route.ts:470-486`

- [ ] **Step 1: Riprogrammare la riga bloccata oltre mezzanotte + dedup della notifica**

In `app/api/cron/send-messages/route.ts`, individua il blocco (≈ righe 470-486):

```js
        const isBlocked = await checkFailures(supabase, ownerPhone);
        if (isBlocked) {
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: ownerPhone, text: '⚠️ Messaggi sospesi temporaneamente. Troppi invii falliti.' })
            });
          } catch (e) {}
          return 'skipped' as const;
        }

        const check = await canSend(supabase, ownerPhone, instanceName);
        if (!check.allowed) {
          console.log('CRON: RATE LIMITED:', ownerPhone, check.reason);
          return 'rate_limited' as const;
        }
```

e sostituiscilo con (nota: `nextRomeMidnight`, `applyJitter` sono già importati e usati a `route.ts:440`; aggiungi il Set di dedup accanto agli altri Set, vedi Step 2):

```js
        const isBlocked = await checkFailures(supabase, ownerPhone);
        if (isBlocked) {
          // Move the blocked user's row past the Rome-midnight reset so it
          // leaves the global limit(25) oldest-first window instead of
          // re-entering it every tick and starving other users (same head-of
          // -line fix as the daily-limit branch above). Notify the owner ONCE
          // per cron run, with a timeout so a hung socket can't burn the batch.
          await supabase.from('scheduled_messages').update({
            scheduled_at: applyJitter(nextRomeMidnight(new Date()).toISOString(), 30 * 60_000),
            error_message: 'Invii sospesi (troppi fallimenti nelle ultime 24h) — riprogrammato dopo il reset di mezzanotte',
          }).eq('id', msg.id);
          if (!blockedNotifiedInstances.has(instanceName)) {
            blockedNotifiedInstances.add(instanceName);
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 3000);
              await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                method: 'POST',
                headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: ownerPhone, text: '⚠️ Messaggi sospesi temporaneamente. Troppi invii falliti.' }),
                signal: ctrl.signal,
              });
              clearTimeout(t);
            } catch (e) {}
          }
          return 'rate_limited' as const;
        }

        const check = await canSend(supabase, ownerPhone, instanceName);
        if (!check.allowed) {
          console.log('CRON: RATE LIMITED:', ownerPhone, check.reason);
          // Reschedule out of the window too — otherwise a rate-limited row
          // sits at its stale scheduled_at and re-enters limit(25) each tick.
          await supabase.from('scheduled_messages').update({
            scheduled_at: applyJitter(nextRomeMidnight(new Date()).toISOString(), 30 * 60_000),
            error_message: 'Rate limit raggiunto — riprogrammato dopo il reset di mezzanotte',
          }).eq('id', msg.id);
          return 'rate_limited' as const;
        }
```

- [ ] **Step 2: Dichiarare il Set di dedup accanto agli altri**

Trova la dichiarazione `const thresholdNotifiedInstances = new Set<string>();` (≈ `route.ts:294`) e aggiungi sotto:

```js
    // Dedup the "invii sospesi" owner notification to once per cron run, per
    // instance — same reason as thresholdNotifiedInstances above.
    const blockedNotifiedInstances = new Set<string>();
```

- [ ] **Step 3: Verificare che il tipo compili**

Run: `npx tsc --noEmit 2>&1 | grep -c "send-messages"`
Atteso: `0` (nessun errore di tipo introdotto nel file).

- [ ] **Step 4: Verificare che la suite del cron non regredisca**

Run: `npx jest __tests__/cron-utils.test.ts --ci 2>&1 | tail -3`
Atteso: `Tests: ... passed` (verde — la logica pura non è toccata; `cron.integration` resta nel set flaky noto).

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/send-messages/route.ts
git commit -m "fix(cron): il circuit-breaker riprogramma oltre mezzanotte + dedup notifica bloccato (#0)"
```

---

### Task 3: Fairness per-utente nella finestra di invio (niente monopolio della coda)

**Perché:** la query di lavoro è `.eq('status','pending').lte('scheduled_at', now).order('scheduled_at').limit(25)` — **globale, oldest-first, senza cap per utente**. Un beta user con 50 messaggi in coda occupa l'intera finestra e ritarda tutti gli altri di minuti. Il rate-limit `PER_USER_PER_MINUTE=15` mitiga ma non elimina lo squilibrio quando i pesanti hanno backlog vecchi. — *Finding #11 (high→medium), confermato.*

**Files:**
- Modify: `app/api/cron/send-messages/route.ts:272-278`

- [ ] **Step 1: Allargare la finestra e applicare un cap per-utente in memoria**

La soluzione minima senza SQL complesso: pescare più righe (es. 60) ordinate oldest-first e poi, in JS, tenere al massimo N per istanza prima di processare, così un singolo utente non satura il batch. Sostituisci:

```js
    const { data: pendingMessages, error: queryErr } = await supabase
      .from('scheduled_messages')
      .select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status, messages_sent_today, upsell_sent_today)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(25);

    if (queryErr) {
      console.error('CRON: Query error:', queryErr.message);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }
    console.log('CRON: ' + (pendingMessages || []).length + ' pending messages found');
```

con:

```js
    const { data: pendingPool, error: queryErr } = await supabase
      .from('scheduled_messages')
      .select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status, messages_sent_today, upsell_sent_today)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(60);

    if (queryErr) {
      console.error('CRON: Query error:', queryErr.message);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    // Per-user fairness: cap how many of one user's messages enter a single
    // tick so a user with a large backlog can't monopolize the window and
    // starve others. The remaining rows are picked up on the next tick(s).
    const MAX_PER_USER_PER_TICK = 8;
    const perUserCount: Record<string, number> = {};
    const pendingMessages = (pendingPool || []).filter((m: any) => {
      const key = m.instance_phone || m.user_instances?.phone_number || 'unknown';
      perUserCount[key] = (perUserCount[key] || 0) + 1;
      return perUserCount[key] <= MAX_PER_USER_PER_TICK;
    }).slice(0, 25);
    console.log('CRON: ' + pendingMessages.length + ' pending messages selected (fair, pool=' + (pendingPool || []).length + ')');
```

- [ ] **Step 2: Verificare compilazione**

Run: `npx tsc --noEmit 2>&1 | grep -c "send-messages"`
Atteso: `0`.

- [ ] **Step 3: Verificare che le suite pure restino verdi**

Run: `npx jest __tests__/cron-utils.test.ts __tests__/recurrence.test.ts --ci 2>&1 | tail -3`
Atteso: `Tests: ... passed`.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/send-messages/route.ts
git commit -m "fix(cron): fairness per-utente nella finestra di invio, no monopolio coda (#11)"
```

---

### Task 4: Rate-limit su `/api/auth/init` (endpoint pairing pubblico) — riusa `rate_limit_state`

**Perché:** `/api/auth/init` è pubblico, senza autenticazione e **senza alcun limite per-IP o per-numero**. Ogni chiamata crea un'istanza Evolution (socket Baileys) sul nodo unico Hetzner (4GB, no swap, no `mem_limit`). Un bot — o retry legittimi concentrati — possono spawnare istanze fino all'OOM = servizio giù per tutti. — *Finding #1 (critical→high), confermato.*

**Decisione #3:** nessuna tabella nuova. Si riusa la RPC atomica **`rate_limit_record`** già in `supabase/migrations/20260526_rate_limit_state.sql:30` (la stessa usata da `recordSend` in `app/lib/rate-limit.ts:82`). La RPC non conosce soglie: incrementa atomicamente `minute_count` con reset a `p_minute_reset` e ritorna la riga; la soglia si valuta lato TS sul count di ritorno. Usiamo la finestra "minute" della riga come **finestra di 10 minuti** (passando `p_minute_reset = now + 600000`) e chiavi con prefisso `pairing:` (nessuna collisione con `user:`/`inst:`).

**Files:**
- Modify: `app/api/auth/init/route.ts` (inserire il gate subito dopo la validazione del telefono, prima di `getEgressForPairing`/create istanza)

- [ ] **Step 1: Inserire il gate di rate-limit riusando la RPC esistente**

In `app/api/auth/init/route.ts`, subito dopo che `cleanPhone` (il numero validato) è disponibile e **prima** di `getEgressForPairing`/`forceDeleteInstance`, inserisci. Nota: il file crea già `const supabase = getSupabase();` più in basso — **sposta** quella riga qui (o riusa il client già creato) per non istanziarlo due volte.

```js
  // Rate limit the public pairing endpoint by IP and by phone, reusing the
  // existing atomic rate_limit_record RPC (rate_limit_state table). Each call
  // spawns a Baileys socket on the single Evolution node — without a cap a
  // flood can OOM the box (#1). The RPC has no built-in threshold: we pass a
  // 10-min window as the "minute" reset and enforce the limit on the returned
  // count (same pattern as recordSend in app/lib/rate-limit.ts).
  const supabase = getSupabase(); // if this const already exists lower down, move it here and delete the duplicate
  {
    const PAIRING_WINDOW_MS = 10 * 60 * 1000;
    const PAIRING_MAX_PER_IP = 8;
    const PAIRING_MAX_PER_PHONE = 5;
    const nowMs = Date.now();
    const winReset = nowMs + PAIRING_WINDOW_MS;
    const dayReset = nowMs + 86_400_000; // neutral: daily_count is not read here
    const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '').split(',')[0].trim() || 'unknown';
    const [ipRes, phoneRes] = await Promise.all([
      supabase.rpc('rate_limit_record', { p_key: 'pairing:ip:' + ip, p_now: nowMs, p_minute_reset: winReset, p_daily_reset: dayReset }),
      supabase.rpc('rate_limit_record', { p_key: 'pairing:phone:' + cleanPhone, p_now: nowMs, p_minute_reset: winReset, p_daily_reset: dayReset }),
    ]);
    // Fail-open on RPC error: a rate-limiter blip must not break pairing
    // (same non-fatal philosophy as recordSend). Flip to a 503 here if you
    // prefer fail-closed for this public pre-auth endpoint.
    if (!ipRes.error && !phoneRes.error) {
      const ipCount = (ipRes.data as { minute_count: number })?.minute_count ?? 0;
      const phoneCount = (phoneRes.data as { minute_count: number })?.minute_count ?? 0;
      if (ipCount > PAIRING_MAX_PER_IP || phoneCount > PAIRING_MAX_PER_PHONE) {
        return NextResponse.json(
          { error: 'rate_limited', message: 'Troppi tentativi di collegamento. Riprova tra qualche minuto.' },
          { status: 429, headers: { 'Retry-After': String(PAIRING_WINDOW_MS / 1000) } }
        );
      }
    } else {
      console.warn('[auth/init] rate-limit RPC error (fail-open):', ipRes.error?.message || phoneRes.error?.message);
    }
  }
```

Nota per l'esecutore: verifica con `grep -n "cleanPhone\|const supabase = getSupabase\|x-forwarded-for" app/api/auth/init/route.ts` il nome esatto della variabile del numero validato (potrebbe essere `phone`/`normalizedPhone` invece di `cleanPhone`) e adegua. NON creare `getSupabase()` due volte.

- [ ] **Step 2: Verificare compilazione**

Run: `npx tsc --noEmit 2>&1 | grep -c "auth/init"`
Atteso: `0`.

- [ ] **Step 3: Verificare che nessun nuovo SQL sia richiesto**

Run: `grep -n "rate_limit_record" supabase/migrations/20260526_rate_limit_state.sql`
Atteso: la riga `create or replace function public.rate_limit_record(` compare — la RPC esiste già in prod, nessuna migration nuova serve.

- [ ] **Step 4: Commit**

```bash
git add app/api/auth/init/route.ts
git commit -m "fix(auth): rate-limit per-IP/per-phone su /api/auth/init riusando rate_limit_record (#1)"
```

---

### Task 5: Evitare l'OOM da burst di `syncFullHistory` (semaforo — decisione #2 opzione b)

**Perché:** ogni primo pairing crea l'istanza con `syncFullHistory=true`; Baileys bufferizza tutta la cronologia in RAM. Il commento nel codice documenta l'OOM da "signup-burst". Il gate è solo per-utente, non serializza: 3–4 nuovi utenti nello stesso minuto = N full-sync simultanei sul nodo unico. — *Finding #2 (high→medium), confermato.*

**Decisione #2:** disattivare `syncFullHistory`. La rubrica si popola dagli eventi `contacts.upsert` progressivi dopo la connessione (il webhook li gestisce già a `route.ts:1024-1072`), senza il picco RAM. **Andrea ha richiesto una verifica end-to-end obbligatoria** (Step 3): dopo il fix, un pairing reale deve comunque popolare il ContactPicker.

> **⚠️ AGGIORNATO — decisione #2 rivista in opzione (b) (11-lug).** L'opzione (a) originale (disattivare `syncFullHistory`) è stata **scartata**: il codice documenta un incidente (`auth/init:217-218`, commit `6d3fb6b`) in cui hardcodare `false` ha causato "contatti spariti su ogni nuovo pairing" — il burst di contatti *è* `syncFullHistory`. Implementata invece l'**opzione (b): un semaforo distribuito** che preserva il burst (rubrica ok) e serializza i full-sync concorrenti per prevenire l'OOM. **Già implementata e committata** (commit `27290b6` + revert `7084052`).

**Files (implementati):**
- Create: `supabase/migrations/20260711_full_sync_semaphore.sql` (tabella `full_sync_slots` + RPC `acquire_full_sync_slot`, 2 slot, TTL 120s, `FOR UPDATE SKIP LOCKED`)
- Modify: `app/api/auth/init/route.ts` (semaforo prima del `/instance/create` + `syncFullHistory` condizionale ripristinato + `maxDuration=30`)

- [x] **Step 1: Semaforo distribuito (fatto)** — al primo pairing (`syncFullHistory===true`) acquisisce uno slot via `acquire_full_sync_slot`; se tutti gli slot sono occupati attende fino a 2.5s (stagger del burst → picco RAM più basso), poi procede comunque (**fail-open**: mai rubrica vuota, `console.warn` + Sentry). `syncFullHistory` resta condizionale (true solo primo pairing). Fail-safe: senza migration applicata la RPC dà errore → si procede col full-sync condizionale (comportamento pre-Task-5).

- [x] **Step 2: tsc verificato** — 23 errori pre-esistenti invariati, zero nuovi in `auth/init`; test `auth-init-egress.integration` + `rate-limit` verdi.

- [ ] **Step 3: DA APPLICARE AL DEPLOY (sessione ops di Andrea)** — applicare la migration `20260711_full_sync_semaphore.sql` al DB Supabase prima/al deploy del branch (senza, il semaforo è inattivo ma sicuro).

- [ ] **Step 4: VERIFICA E2E (Andrea)** — con il branch in preview + migration applicata: pairing di un numero di prova, attendere 30-60s dopo `state=open`, confermare che il ContactPicker si popoli. SQL: `select count(*) from whatsapp_contacts where user_phone='<numero>';` → atteso >0 e crescente. Con l'opzione (b) il burst è preservato, quindi la rubrica **deve** popolarsi come prima; se non lo fa, il problema è altrove (non il full-sync).

---

### Task 6: Non ri-accodare in automatico un invio andato in timeout (evita duplicati al destinatario)

**Perché:** l'invio ha un abort a 8s (`route.ts:576-612`); se scade, la fetch lancia e il failure-handler tratta **ogni** rejection come fallimento → refund quota + `buildFailureRequeueUpdate` che azzera `send_attempted_at` e rimette `pending` → re-invio al tick dopo. Ma Baileys può **aver già consegnato**: il destinatario riceve il messaggio due volte. Ironia: la stale-recovery (`route.ts:182-201`) usa già la logica giusta ("send_attempted_at settato → probabilmente consegnato → non ritentare"), ma il timeout dell'invio diretto no. — *Finding #10 (high), confermato.*

**Files:**
- Modify: `app/api/cron/send-messages/route.ts` (blocco send + failure handler, ≈ `576-612` e `720-742`)

- [ ] **Step 1: Distinguere il timeout (esito indeterminato) dal fallimento vero**

Individua il punto dove l'abort scatta e la fetch lancia. L'errore da `AbortController` ha `name === 'AbortError'` (o `err.name === 'TimeoutError'` a seconda del runtime). Nel `catch`/failure-handler del singolo messaggio, **prima** di chiamare il refund + requeue, aggiungi il ramo:

```js
      // Send timed out: the fetch was aborted but Baileys may have delivered.
      // Do NOT auto-requeue (that would double-send). Mark the row 'sent' with
      // a diagnostic marker (same policy as the stale-processing recovery),
      // and do NOT refund the quota slot — the message likely went out.
      const isTimeout = err?.name === 'AbortError' || err?.name === 'TimeoutError';
      if (isTimeout) {
        await supabase.from('scheduled_messages').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: 'send_timeout_indeterminate: nessuna conferma da Evolution entro 8s, marcato inviato per evitare duplicati (verifica ✓✓ su WhatsApp se critico)',
        }).eq('id', msg.id);
        return 'sent' as const;
      }
```

Nota per l'esecutore: leggi il codice reale del failure-handler (cerca `buildFailureRequeueUpdate` e `refund_daily_quota` in `route.ts`) e inserisci il ramo `isTimeout` **prima** della logica di refund/requeue esistente, replicando il pattern di `catch` già presente. Il tipo di `err` va gestito come `any` (il file usa già `catch` non tipizzati).

- [ ] **Step 2: Verificare compilazione**

Run: `npx tsc --noEmit 2>&1 | grep -c "send-messages"`
Atteso: `0`.

- [ ] **Step 3: Verificare le suite pure**

Run: `npx jest __tests__/cron-utils.test.ts __tests__/message-error.test.ts --ci 2>&1 | tail -3`
Atteso: `Tests: ... passed`.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/send-messages/route.ts
git commit -m "fix(cron): il timeout d'invio non ri-accoda (evita doppia consegna) (#10)"
```

---

### Task 7: `maxDuration` sul webhook + rilascio del claim se l'insert non completa (evita perdita silenziosa di comandi)

**Perché:** il webhook self-chat concatena `askAI` (8s) + `verifyAndFixMessage` (6s) + notify (8s) + query, senza `maxDuration` esportato → su Hobby la lambda muore a ~10s. Il claim dedup è committato **prima** dell'insert; se la lambda viene uccisa (SIGKILL) tra claim e insert, il `catch` non gira, il claim resta e il retry di Evolution viene deduplicato → **il comando dell'utente sparisce senza risposta né riga**. — *Finding #4 (high→medium), confermato.*

**Files:**
- Modify: `app/api/webhook/route.ts` (top-level export + logica claim/insert)

- [ ] **Step 1: Alzare il budget della lambda webhook**

In cima a `app/api/webhook/route.ts`, vicino a `export const dynamic = 'force-dynamic';`, aggiungi:

```js
// The self-chat path chains askAI (8s) + verifyAndFixMessage (6s) + notify;
// the Hobby default ~10s kills it mid-insert, orphaning the dedup claim (#4).
// Vercel now allows up to 300s; 30s covers the worst-case LLM chain.
export const maxDuration = 30;
```

Nota: `maxDuration` è rispettato solo se il piano Vercel lo consente. Se il progetto è ancora Hobby con cap 10s effettivo, questo è comunque innocuo e diventa efficace all'upgrade; il vero fix anti-perdita è lo Step 2.

- [ ] **Step 2: Ridurre la finestra tra claim e insert**

Leggi il codice attorno al claim dedup (cerca `claimWebhookEvent` e il commit `claimedMsgId = null`, ≈ `route.ts:1089` e `1711`). Il claim va rilasciato se il processing non raggiunge l'insert. Individua il `catch` finale (≈ `route.ts:1866-1872`, che già fa release-on-error) e verifica che **ogni** ramo di uscita anticipata (return prima dell'insert) rilasci il claim. Dove un `return` avviene tra il claim e l'insert senza release, aggiungi la chiamata di release del claim (stessa funzione usata nel catch).

Nota per l'esecutore: questo richiede di leggere i ~600 righe del ramo `messages.upsert`. Traccia ogni `return` tra la riga del claim e la riga dell'insert; per ognuno che non passa dal release, aggiungi il release. Non modificare la logica di parsing.

- [ ] **Step 3: Verificare compilazione e suite webhook pure**

Run: `npx tsc --noEmit 2>&1 | grep -c "webhook"` → atteso `0`
Run: `npx jest __tests__/webhook-utils.test.ts __tests__/webhook-dedup.test.ts --ci 2>&1 | tail -3` → atteso `Tests: ... passed`

- [ ] **Step 4: Commit**

```bash
git add app/api/webhook/route.ts
git commit -m "fix(webhook): maxDuration 30s + release claim su uscita anticipata, no comandi persi (#4)"
```

---

# TIER P1 — Correttezza e fiducia che i primi utenti colpiscono subito

---

### Task 8: DELETE messaggio con guard di stato + il client rispetta lo status HTTP

**Perché:** il DELETE fa `update({status:'cancelled'}).eq('id')` **senza** `.in('status', [...])` (il PATCH invece ce l'ha, `route.ts:290`). Se l'utente annulla mentre il cron ha claimato la riga (`processing`), il messaggio parte davvero ma risulta `cancelled`, o il flip finale del cron sovrascrive `cancelled→sent`. Lato client, `handleDelete`/`handlePauseToggle` mostrano il toast di successo **prima** della fetch e ignorano `res.ok`: un 409 appare come successo. — *Finding #8 (high→medium), confermato.*

**Files:**
- Modify: `app/api/messages/route.ts:133-137`
- Modify: `app/dashboard/page.tsx` (handler delete/pause) e/o `app/components/MessagesSection.tsx:170`

- [ ] **Step 1: Guard di stato sul DELETE**

In `app/api/messages/route.ts`, sostituisci:

```js
  const { error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('instance_phone', phone);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
```

con:

```js
  const { data: updated, error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('instance_phone', phone)
    .in('status', ['pending', 'paused'])   // never cancel a row the cron already claimed
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'message_not_cancellable', message: 'Il messaggio è già in invio o inviato.' }, { status: 409 });
  }
  return NextResponse.json({ success: true });
```

- [ ] **Step 2: Il client controlla `res.ok` prima del toast di successo**

In `app/dashboard/page.tsx` (e/o `MessagesSection.tsx`), trova `handleDelete` e `handlePauseToggle`. Sposta il toast di successo **dopo** il controllo `if (res.ok)`, e mostra un toast d'errore leggibile su non-ok. Esempio del pattern atteso:

```js
    const res = await fetch('/api/messages', { method: 'DELETE', headers: {...}, body: JSON.stringify({ id }) });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'Impossibile annullare: il messaggio è già in invio.');
      return;
    }
    showToast('Messaggio annullato');
    // ...refresh
```

Nota: leggi la firma reale di `showToast` e del refresh nel file prima di editare.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -cE "messages/route|dashboard/page|MessagesSection"` → atteso `0`

- [ ] **Step 4: Commit**

```bash
git add app/api/messages/route.ts app/dashboard/page.tsx app/components/MessagesSection.tsx
git commit -m "fix(messages): DELETE con guard di stato + client rispetta res.ok (#8)"
```

---

### Task 9: Cooldown e rate-limit non bypassabili dentro lo stesso batch

**Perché:** i 5 promise del batch leggono in parallelo il count del cooldown (`route.ts:447-455`) e `canSend` (`route.ts:482`) **prima** che qualcuno scriva `sent`: 5 messaggi allo stesso destinatario nello stesso batch vedono tutti `count<3` e partono tutti insieme — esattamente il pattern anti-ban che il cooldown doveva impedire. — *Finding #9 (high), confermato.*

**Files:**
- Modify: `app/api/cron/send-messages/route.ts` (loop batch, ≈ `route.ts:300-321`)

- [ ] **Step 1: Serializzare per destinatario dentro il batch**

La soluzione minima: tenere un `Map` per-run che conta gli invii **già decisi in questo run** verso ciascun destinatario, e incrementarlo prima del send (non solo leggere dal DB). Vicino agli altri Set del run (`disconnectedInstances`, ecc.), aggiungi:

```js
    // Within-run cooldown guard: the DB "3 msg / 24h" count is read per-message
    // in parallel, so 5 msgs to the same recipient in one batch all see count<3
    // and fire together (#9). Track in-run sends per recipient and enforce the
    // cap against DB-count + in-run-count.
    const inRunSendsToRecipient: Record<string, number> = {};
```

Poi, nel punto del cooldown (dove leggi `recentToRecipient`), cambia la condizione da:

```js
        if ((recentToRecipient || 0) >= 3) {
```

a:

```js
        const recipKey = ownerPhone + '|' + msg.recipient_number;
        const alreadyInRun = inRunSendsToRecipient[recipKey] || 0;
        if ((recentToRecipient || 0) + alreadyInRun >= 3) {
```

e **subito prima** del claim atomico (`route.ts:489`, dove parte l'invio effettivo), incrementa il contatore:

```js
        inRunSendsToRecipient[recipKey] = (inRunSendsToRecipient[recipKey] || 0) + 1;
```

Nota per l'esecutore: poiché i 5 promise girano in `Promise.allSettled`, l'incremento sincrono prima dell'`await` del claim riduce ma non elimina al 100% la race tra promise concorrenti dello stesso batch. Per la beta (batch da 5, stesso destinatario raro) è sufficiente; un fix atomico completo (RPC increment-and-check) è nel backlog P2.

- [ ] **Step 2: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -c "send-messages"` → atteso `0`
Run: `npx jest __tests__/cron-utils.test.ts __tests__/rate-limit.test.ts --ci 2>&1 | tail -3` → atteso `Tests: ... passed`

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/send-messages/route.ts
git commit -m "fix(cron): cooldown per-destinatario non bypassabile intra-batch (#9)"
```

---

### Task 10: "Modifica" deve aggiornare in-place, non duplicare

**Perché:** `handleEdit` chiama `handleDuplicate` e POSTa un **nuovo** messaggio, lasciando l'originale in coda: il destinatario riceve il messaggio **due volte**. Il backend PATCH edit-in-place **esiste già** (`messages/route.ts:228-292`) ma la modal non lo usa. — *Finding #13 (high).*

**Files:**
- Modify: `app/dashboard/page.tsx:203-206` (handleEdit)
- Modify: `components/ScheduleModal.tsx` (accettare un `editMsgId` e chiamare PATCH invece di POST quando presente)

- [ ] **Step 1: Passare l'id del messaggio da modificare alla modal**

In `app/dashboard/page.tsx`, cambia `handleEdit` da "duplica" a "apri la modal in modalità edit" passando l'id del messaggio (es. uno stato `editingMsg`). Rimuovi il toast "Modifica come duplicato".

- [ ] **Step 2: La modal usa PATCH quando è in edit**

In `components/ScheduleModal.tsx`, in `handleSubmit`, se è presente `editMsgId`, chiama `PATCH /api/messages` con `{ id: editMsgId, message, scheduled_at, ... }` invece di `POST`. Leggi la firma accettata dal PATCH in `messages/route.ts:228-292` per allineare i campi.

Nota per l'esecutore: questa task tocca il flusso UI più delicato. Leggi entrambi i file per intero prima di editare. Verifica che i campi inviati al PATCH corrispondano a `EDITABLE_STATES` e alle colonne che il PATCH accetta.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -cE "ScheduleModal|dashboard/page"` → atteso `0`

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx components/ScheduleModal.tsx
git commit -m "fix(ui): 'Modifica' usa il PATCH in-place, niente doppia consegna (#13)"
```

---

### Task 11: Nascondere i toggle "Richiedi approvazione" e "Promemoria" dietro un feature-flag (decisione #1)

**Perché:** i toggle esistono nella UI (`ScheduleModal.tsx:70` approval, `:68` reminder) e appaiono nel riepilogo, ma **`handleSubmit` non li invia mai al backend** → il messaggio parte in automatico, il promemoria non arriva mai. Un utente che si fida di "Richiedi approvazione" vede il messaggio partire senza conferma: trust-killer immediato. — *Finding #15 (high) + finding "Promemoria" (medium).*

**Decisione #1:** rimuoverli **dalla UI ora**, ma **NON cancellare il codice** — nasconderli dietro un flag `false` così la riattivazione E2E futura è un flip + il wiring backend. Un solo flag copre entrambi i toggle (sono la stessa classe: "opzioni avanzate non ancora implementate").

**Files:**
- Modify: `components/ScheduleModal.tsx`

- [ ] **Step 1: Aggiungere il feature-flag in cima al file**

In `components/ScheduleModal.tsx`, subito dopo gli import, aggiungi:

```js
// Feature flag: "Richiedi approvazione" e "Promemoria" sono raccolti dalla UI
// ma NON ancora consegnati end-to-end (handleSubmit non li invia, non c'è cron
// promemoria). Nascosti finché non implementati per non promettere qualcosa che
// non accade. Riattivazione futura = mettere true QUI e fare il wiring backend
// (invio dei campi nel POST + colonna DB + flusso conferma/promemoria).
const ADVANCED_APPROVAL_REMINDER_ENABLED = false;
```

- [ ] **Step 2: Gate del rendering dei due blocchi**

Avvolgi il blocco UI del toggle "Richiedi approvazione" (≈ righe 326-348) e quello "Promemoria" (≈ righe 356-359 + lo sheet `ReminderBottomSheet` ≈ 441-446) in un rendering condizionale `{ADVANCED_APPROVAL_REMINDER_ENABLED && ( ... )}`. Nel riepilogo (`advancedSummary`, righe 131-137) escludi le voci `approval` e `reminder` quando il flag è off:

```js
  const advancedSummary = !ADVANCED_APPROVAL_REMINDER_ENABLED
    ? (hasRecurrence ? `Ricorrenza: ${/* etichetta esistente */}` : 'Nessuna opzione avanzata')
    : (/* … la logica esistente con approval/reminder … */);
```

Nota per l'esecutore: leggi la logica reale di `advancedSummary` (righe 131-137) e adattala mantenendo il ramo ricorrenza (che è implementato e funziona). Gli stati `approval`, `reminder`, `reminderSheetOpen` restano dichiarati (dormienti) — non cancellarli, servono alla riattivazione. Verifica che nessuna variabile diventi "unused" con errore (il file compila con `strict:false`, ma controlla).

- [ ] **Step 3: Verificare che i toggle non siano più visibili ma il codice resti**

Run: `grep -c "ADVANCED_APPROVAL_REMINDER_ENABLED" components/ScheduleModal.tsx` → atteso `≥3` (dichiarazione + i gate)
Run: `grep -c "const \[approval" components/ScheduleModal.tsx` → atteso `1` (lo stato resta dormiente, non cancellato)
Run: `npx tsc --noEmit 2>&1 | grep -c "ScheduleModal"` → atteso `0`

- [ ] **Step 4: Commit**

```bash
git add components/ScheduleModal.tsx
git commit -m "fix(ui): nascondi toggle approvazione/promemoria dietro feature-flag off (#15, #12b)"
```

---

### Task 12: (unita alla Task 11)

Il toggle "Promemoria" è gestito insieme a "Richiedi approvazione" nella Task 11 (stesso feature-flag `ADVANCED_APPROVAL_REMINDER_ENABLED`). Nessuna azione separata: **salta questa task**.

---

### Task 13: Banner "WhatsApp disconnesso" con CTA di ricollegamento

**Perché:** quando l'istanza si disconnette (logout, telefono spento), i messaggi smettono di partire in silenzio. L'unica UI è una pill piccola "Disconnesso" (`dashboard/page.tsx:568`); nessun banner, nessuna CTA. L'utente lo scopre solo quando un cliente reclama. — *Finding #14 (high).*

**Files:**
- Modify: `app/dashboard/page.tsx` (aggiungere un banner quando `connection_status !== 'open'`)

- [ ] **Step 1: Banner prominente in cima alla dashboard**

Dove la dashboard conosce lo stato connessione (cerca la variabile `connected`/`connection_status`), aggiungi in cima al contenuto principale, condizionato a non-connesso:

```jsx
{!connected && (
  <div className="mx-auto max-w-2xl mb-4 rounded-xl bg-red-500/10 border border-red-500/40 px-4 py-3 flex items-center justify-between gap-3">
    <div className="text-sm text-red-200">
      <strong>WhatsApp disconnesso.</strong> I tuoi messaggi programmati non partono finché non ricolleghi.
    </div>
    <a href="/connect" className="shrink-0 rounded-lg bg-red-500 px-3 py-2 text-sm font-semibold text-white">Ricollega</a>
  </div>
)}
```

Adatta le classi al design system esistente (cerca altri banner nel file per coerenza, es. il trial banner).

- [ ] **Step 2: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -c "dashboard/page"` → atteso `0`

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): banner disconnessione WhatsApp con CTA ricollega (#14)"
```

---

### Task 14: Il messaggio di benvenuto punta alla dashboard, non al self-chat nascosto

**Perché:** il welcome al pairing insegna il flusso self-chat (`"Scrivi il comando: Invia a Marco domani…"`, `webhook/route.ts:968-974`), che è deliberatamente **non esposto in UI** (easter egg). Un utente ICP reale viene indirizzato a un flusso non documentato invece che alla dashboard. — *Finding #16 (high).*

**Files:**
- Modify: `app/api/webhook/route.ts:950-979` (testo del welcome)

- [ ] **Step 1: Riscrivere il copy del welcome**

Sostituisci il testo che spiega i comandi self-chat con un messaggio che punta alla dashboard, es.:

```
✅ WhatsApp collegato!

Apri *whatslater.it/dashboard* (o l'app installata) e tocca *"Manda messaggio"*: scegli il contatto, scrivi, imposta data e ora. Ci pensiamo noi a inviarlo al momento giusto.

Buon lavoro! 🎯
```

Mantieni la struttura a 2 messaggi (disclaimer + welcome) e la variabile URL già usata nel file. NON rimuovere il parser self-chat, solo il copy che lo pubblicizza.

- [ ] **Step 2: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -c "webhook"` → atteso `0`

- [ ] **Step 3: Commit**

```bash
git add app/api/webhook/route.ts
git commit -m "fix(webhook): welcome indirizza alla dashboard, non al self-chat nascosto (#16)"
```

---

### Task 15: Cap contatti/coda: conteggio via COUNT aggregato (fix troncamento a 1000 righe)

**Perché:** il calcolo dei contatti attivi (`messages/route.ts:416-420`) scarica **tutte** le `scheduled_messages` non-cancelled dell'utente senza `.limit`; supabase-js tronca a ~1000 righe. Il founder ha già ~7k righe → il conteggio è **già sbagliato in prod** (cap sottostimato). Costo O(storico) per ogni POST. — *Finding #7 (high→medium), confermato.*

**Files:**
- Modify: `app/api/messages/route.ts:408-454`

- [ ] **Step 1: Sostituire lo scan in-JS con un COUNT lato SQL**

Il conteggio dei contatti attivi va fatto con una query aggregata invece di scaricare le righe. Leggi la logica attuale (`isRecipientActive`, finestra 90gg da `contact-window.ts`). Il fix minimo: applicare il filtro data **lato SQL** (`.gte('scheduled_at', contactActiveCutoffIso())` o equivalente sul campo giusto) e usare `count: 'exact', head: true` su distinct-recipient dove possibile, oppure paginare con `.range()` se serve la lista dei distinti. Evita lo `select('*')` non-bounded.

Nota per l'esecutore: questo richiede attenzione perché `isRecipientActive` ha logica (in-flight sempre attivo, sent/failed entro 90gg). Se non riesci a esprimerla in una singola query aggregata, applica **almeno** un `.gte` sulla data lato SQL + `.limit(2000)` esplicito con un `console.warn` se raggiungi il limite, così il troncamento smette di essere silenzioso. Non cambiare le soglie dei piani.

- [ ] **Step 2: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -c "messages/route"` → atteso `0`
Run: `npx jest __tests__/contact-window.test.ts __tests__/messages-post.integration.test.ts --ci 2>&1 | tail -3` → atteso `Tests: ... passed` (o, se `messages-post` è nel set flaky, verifica almeno `contact-window`).

- [ ] **Step 3: Commit**

```bash
git add app/api/messages/route.ts
git commit -m "fix(messages): conteggio contatti attivi via COUNT lato SQL, no troncamento 1000 righe (#7)"
```

---

### Task 16: Reschedule basato su `now()`, non sullo `scheduled_at` stale

**Perché:** `rescheduleSoon` somma i minuti allo `scheduled_at` **originale** (`cron-utils.ts:110-114`). Un messaggio in forte ritardo resta "due now" per decine di tick, alimentando il churn della finestra e bruciando i retry. — *Finding "reschedule stale" (medium), corrobora #0/#11.*

**Files:**
- Modify: `app/lib/cron-utils.ts:110-114`
- Test: `__tests__/cron-utils.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

In `__tests__/cron-utils.test.ts`, aggiungi:

```js
test('rescheduleSoon parte da ora, non dallo scheduled_at stale', () => {
  const stale = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h fa
  const out = new Date(rescheduleSoon(stale, 5)).getTime();
  // Deve essere ~5 min nel FUTURO, non 3h-5min nel passato
  expect(out).toBeGreaterThan(Date.now());
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `npx jest __tests__/cron-utils.test.ts -t "rescheduleSoon parte da ora" --ci 2>&1 | tail -5`
Atteso: FAIL (l'attuale implementazione ritorna un timestamp nel passato).

- [ ] **Step 3: Correggere l'implementazione**

In `app/lib/cron-utils.ts`, sostituisci:

```js
export function rescheduleSoon(scheduledAt: string, minutes: number = 5): string {
  const next = new Date(scheduledAt);
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}
```

con:

```js
export function rescheduleSoon(scheduledAt: string, minutes: number = 5): string {
  // Base the deferral on NOW, not the (possibly stale) original scheduled_at,
  // so a badly-late row actually leaves the current cron window instead of
  // staying "due now" for dozens of ticks. The scheduledAt arg is kept for
  // signature compatibility but no longer anchors the result.
  const next = new Date(Math.max(Date.now(), new Date(scheduledAt).getTime()));
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}
```

- [ ] **Step 4: Verificare che passi (e nessuna regressione nella suite)**

Run: `npx jest __tests__/cron-utils.test.ts --ci 2>&1 | tail -3`
Atteso: `Tests: ... passed` (incluso il nuovo test; controlla che i test esistenti su `rescheduleSoon` non si rompano — se assumevano il vecchio comportamento, aggiornali coerentemente al nuovo intento).

- [ ] **Step 5: Commit**

```bash
git add app/lib/cron-utils.ts __tests__/cron-utils.test.ts
git commit -m "fix(cron): rescheduleSoon ancorato a now, non allo scheduled_at stale (#reschedule)"
```

---

### Task 17: `health-check` — probe in parallelo + `maxDuration` (il monitoring non deve auto-spegnersi durante un outage)

**Perché:** `runAllChecks` gira 11 check in serie (`monitoring.ts:545-547`) e `checkWebhookInactive` fa una fetch Evolution **sequenziale per ogni istanza** (8s ciascuna, `monitoring.ts:221-249`), senza `maxDuration`. Con Evolution giù, bastano 2 probe (16s) per uccidere la lambda **prima** che gli alert vengano inviati: il rilevatore si disattiva proprio quando serve. — *Finding #6 (high), confermato.*

**Files:**
- Modify: `app/api/monitoring/health-check/route.ts` (aggiungere `maxDuration`)
- Modify: `app/lib/monitoring.ts:221-249` (parallelizzare i probe per-istanza)

- [ ] **Step 1: `maxDuration` sulla route**

In cima a `app/api/monitoring/health-check/route.ts`:

```js
export const maxDuration = 60; // O(N istanze) di probe Evolution non deve morire a 10s
```

- [ ] **Step 2: Parallelizzare i probe per-istanza**

In `app/lib/monitoring.ts`, nel `checkWebhookInactive` (≈ 221-249), sostituisci il `for` sequenziale con `Promise.allSettled` sui probe, mantenendo il timeout 8s per-probe:

```js
  const results = await Promise.allSettled(
    activeInstances.map(async (inst) => {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      try {
        // ...stessa fetch di prima, con signal: controller.signal
      } finally {
        clearTimeout(t);
      }
    })
  );
  // ...aggrega results come faceva il loop
```

Nota per l'esecutore: leggi il corpo attuale del loop e replica la logica di aggregazione (quali istanze considerate "inattive") sui `results`. Non cambiare le soglie.

- [ ] **Step 3: Verificare**

Run: `npx tsc --noEmit 2>&1 | grep -cE "monitoring"` → atteso `0`
Run: `npx jest __tests__/monitoring.test.ts __tests__/monitoring-pairing.test.ts --ci 2>&1 | tail -3` → atteso `Tests: ... passed`

- [ ] **Step 4: Commit**

```bash
git add app/api/monitoring/health-check/route.ts app/lib/monitoring.ts
git commit -m "fix(monitoring): probe Evolution in parallelo + maxDuration, no auto-spegnimento (#6)"
```

---

### Task 42: Audit `fetchCache='force-no-store'` su tutte le route con GET/RPC deterministico (aggiunta Andrea)

**Perché:** la Next.js Data Cache ha già **congelato query in prod 3 volte** (stress-index, reset quote, host-metrics): le `.select()` di supabase-js sono GET a PostgREST, cacheabili se l'URL è deterministico. `dynamic='force-dynamic'` copre solo la Full Route Cache, **non** la Data Cache — serve `export const fetchCache = 'force-no-store'` a livello route. Audit verificato: **13 route** leggono da Supabase via GET/RPC deterministico e NON hanno il fix (una, `messages`, ha solo `dynamic`).

**Files (aggiungere una riga a ciascuna):**
- `app/api/health/route.ts` (non esporta nulla), `app/api/admin/contacts-stats/route.ts`, `app/api/admin/data/route.ts`, `app/api/admin/sla/route.ts`, `app/api/contacts/route.ts`, `app/api/debug-logs/route.ts`, `app/api/labels/route.ts`, `app/api/templates/route.ts`, `app/api/templates/personal/route.ts`, `app/api/monitoring/health-check/route.ts`, `app/api/cron/cleanup-media/route.ts`, `app/api/cron/daily-report/route.ts`, `app/api/cron/ops-worker/route.ts`, `app/api/messages/route.ts`.

- [ ] **Step 1: Aggiungere `fetchCache='force-no-store'` a ogni route dell'elenco**

In cima a ciascun file (vicino a `export const dynamic = ...` dove presente), aggiungi:

```js
export const fetchCache = 'force-no-store';
```

Le due più critiche: `monitoring/health-check` (la GET che legge `previousStatus` per l'onset-dedup — una cache congelata falserebbe lo stato precedente) e `cron/ops-worker` (rilegge la coda `ops_commands` @60s — una cache congelata farebbe ri-processare lo stesso batch).

- [ ] **Step 2: Verificare che tutte abbiano il fix**

Run: `for f in app/api/health/route.ts app/api/admin/contacts-stats/route.ts app/api/admin/data/route.ts app/api/admin/sla/route.ts app/api/contacts/route.ts app/api/debug-logs/route.ts app/api/labels/route.ts app/api/templates/route.ts app/api/templates/personal/route.ts app/api/monitoring/health-check/route.ts app/api/cron/cleanup-media/route.ts app/api/cron/daily-report/route.ts app/api/cron/ops-worker/route.ts app/api/messages/route.ts; do grep -q "fetchCache" "$f" || echo "MANCA: $f"; done`
Atteso: **nessun output** (tutte hanno il fix).

- [ ] **Step 3: Verificare compilazione**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Atteso: nessun errore nuovo.

- [ ] **Step 4: Commit**

```bash
git add app/api/health/route.ts app/api/admin/contacts-stats/route.ts app/api/admin/data/route.ts app/api/admin/sla/route.ts app/api/contacts/route.ts app/api/debug-logs/route.ts app/api/labels/route.ts app/api/templates/route.ts app/api/templates/personal/route.ts app/api/monitoring/health-check/route.ts app/api/cron/cleanup-media/route.ts app/api/cron/daily-report/route.ts app/api/cron/ops-worker/route.ts app/api/messages/route.ts
git commit -m "fix(cache): fetchCache='force-no-store' su 14 route con GET/RPC deterministico (#42)"
```

---

### Task 43: Documentare il pg_cron `send-messages-cron` come trigger primario (aggiunta Andrea)

**Perché:** dentro Supabase c'è un job pg_cron `send-messages-cron` (`* * * * *` = **1440 invocazioni/giorno**) che chiama `net.http_get('…/api/cron/send-messages?secret=<CRON_SECRET>')`. **Verificato in prod: 84.806 run dal 13-mag-2026, 0 fallimenti** — è di fatto **il trigger primario reale**, ma **non è documentato in CLAUDE.md**, che descrive solo cron-job.org + self-cron + vercel-daily. Nota: **cron-job.org è Inactive dal 12-giu-2026** (verificato), quindi lo stack @60s VIVO oggi è **pg_cron + self-cron** (quest'ultimo per ogni istanza lambda warm, ×N). Il lock atomico previene il doppio invio, ma ogni fire ri-esegue tutto il preamble (reset RPC, scan full-table ricorrenze, cleanup) → carico preamble moltiplicato ogni minuto.

> ⚠️ **Decisione di Andrea:** in questa task **NON si spegne nulla** — si documenta soltanto. La riduzione della tripla concorrenza avviene in **Task 43-bis**, che è **BLOCCATA-DA Task 44 completata e verificata** (vedi sotto). L'ordine sicuro evita un blackout invii se la rotazione del secret va storta.

**Files:**
- Modify: `CLAUDE.md` (sezione "Monitoring (cron trigger stack)")
- Create: `docs/RUNBOOK-cron-triggers.md`

- [ ] **Step 1: Documentare lo stack reale in CLAUDE.md**

Nella sezione "Monitoring (cron trigger stack)" di `CLAUDE.md`, correggi l'elenco aggiungendo il pg_cron come **layer 0 (trigger primario reale: 1440/giorno, 84.806 run, 0 fallimenti al 11-lug-2026)**, nota che i layer @60s sono **tre** + la safety-net giornaliera, e che il `CRON_SECRET` è in chiaro nel comando pg_cron (→ ruotato e spostato in header dalla Task 44).

- [ ] **Step 2: Runbook di ispezione**

Crea `docs/RUNBOOK-cron-triggers.md` con i 4 trigger e le query di ispezione (progetto Supabase `inheoexhtuyjtfotbzyw`):
```sql
-- Elenco job pg_cron
select jobid, schedule, jobname, active from cron.job;
-- Salute del job (sostituisci <jobid>, oggi = 3)
select count(*) total, count(*) filter (where status='failed') failed, max(start_time) last_run
from cron.job_run_details where jobid = <jobid>;
```
Documenta anche i comandi di modifica/spegnimento per la Task 43-bis (NON eseguirli qui):
```sql
-- Spegnere (Task 43-bis, solo dopo Task 44 verificata): 
--   select cron.unschedule('send-messages-cron');
-- Riaccendere:
--   select cron.schedule('send-messages-cron','* * * * *', $$ ... $$);
```

- [ ] **Step 3: Verificare e committare**

Run: `grep -c "pg_cron\|send-messages-cron" CLAUDE.md docs/RUNBOOK-cron-triggers.md` → atteso `≥2`
```bash
git add CLAUDE.md docs/RUNBOOK-cron-triggers.md
git commit -m "docs(cron): documenta il pg_cron primario send-messages-cron (1440/g, 0 fail) (#43)"
```

---

### Task 43-bis: Ridurre la tripla concorrenza @60s — `[BLOCCATA-DA Task 44 completata e verificata 24h]`

**Perché:** una volta ruotato il `CRON_SECRET` (Task 44) e confermato che pg_cron regge da solo, tenere anche cron-job.org + self-cron triplica inutilmente il carico del preamble. — *Ordine imposto da Andrea per evitare blackout invii.*

> ⚠️ **NON eseguire finché Task 44 non è completata E verificata.** Sequenza obbligatoria:
> 1. **Task 44** ruota `CRON_SECRET` su **tutti e tre** i trigger (pg_cron, cron-job.org, self-cron via env).
> 2. **Verifica 24h:** confermare che il pg_cron continua a girare col nuovo segreto per 24 ore (query sotto = 0 fallimenti nelle ultime 24h).
> 3. **SOLO DOPO** questa task spegne cron-job.org + self-cron, lasciando pg_cron unico motore.

- [ ] **Step 1 (gate): verificare 24h di pg_cron col nuovo secret**

Query Supabase (progetto `inheoexhtuyjtfotbzyw`):
```sql
select count(*) runs, count(*) filter (where status='failed') failed, min(start_time), max(start_time)
from cron.job_run_details
where jobid = 3 and start_time > now() - interval '24 hours';
```
Atteso: `runs ≈ 1440`, `failed = 0`. **Se `failed > 0`, FERMATI** — la rotazione ha rotto qualcosa, non spegnere gli altri trigger.

- [ ] **Step 2 (codice): gate del self-cron dietro un flag off**

In `instrumentation.ts`, avvolgi l'avvio del self-cron (il blocco `setInterval(runCron, INTERVAL_MS)` e il suo warmup, righe ~42-74) in un flag così resta riattivabile:
```js
  // Self-cron disabilitato: pg_cron `send-messages-cron` è il trigger canonico
  // (Task 43/43-bis). Rimettere 'true' per riattivare il fallback @60s per-lambda.
  const SELF_CRON_ENABLED = process.env.SELF_CRON_ENABLED === 'true';
  if (!SELF_CRON_ENABLED) {
    console.log('[instrumentation] self-cron disabled (pg_cron is canonical)');
    return;
  }
```
(Inserito dopo l'init Sentry e prima del blocco di scheduling.)

- [ ] **Step 2b (nota): cron-job.org è già Inactive dal 12-giu-2026**

Non serve spegnerlo: è già inattivo (verificato). Il job dormiente può essere **cancellato** dal pannello cron-job.org quando Andrea ruota il secret (Task 44 A3), solo per igiene. L'unico layer ridondante ancora VIVO da spegnere in questa task è il **self-cron** (Step 2).

- [ ] **Step 3: verificare che pg_cron sia l'unico attivo + committare**

Run: `grep -c "SELF_CRON_ENABLED" instrumentation.ts` → atteso `≥2`
Run: `npx tsc --noEmit 2>&1 | grep -c instrumentation` → atteso `0`
```bash
git add instrumentation.ts docs/RUNBOOK-cron-triggers.md
git commit -m "chore(cron): self-cron dietro flag off, pg_cron canonico (#43-bis, post-#44)"
```
Dopo il deploy, monitorare per 1-2 giorni che gli invii restino puntuali (audit_events `message_sent` senza gap). Se calano, rimettere `SELF_CRON_ENABLED=true` su Vercel e riattivare cron-job.org.

---

### Task 44: [RUNBOOK per Andrea] Ruotare `CRON_SECRET` (+ `OPS_SECRET`, `WEBHOOK_SECRET`) con comandi esatti

**Perché:** `CRON_SECRET` è esposto in chiaro **nel comando del pg_cron** (`cron.job.command`, leggibile da chi ha read sul DB e nei log Postgres) **e** nella query string verso cron-job.org. Va ruotato e spostato in header. **Fatto verificato:** `send-messages` accetta già `Authorization: Bearer` (`route.ts:69`), quindi il move-in-header **non richiede codice**. — *Prerequisito di Task 43-bis.*

> **Ordine sicuro (corretto):** prima **l'env Vercel + redeploy**, e appena il deploy è **READY** aggiorni il comando pg_cron → la finestra di disallineamento è di **pochi secondi** (non i 2-3 min del build). ⚠️ **Nota onesta:** esiste comunque una micro-finestra in cui il pg_cron manda ancora il vecchio secret e l'endpoint aspetta il nuovo → gli invii di quei pochi secondi ricevono 401 e **restano pending** (zero perdite, partono al tick dopo). **Non lanciare la rotazione a ridosso di invii schedulati importanti.**

**Files:**
- Create: `docs/RUNBOOK-rotazione-secret.md` (condiviso con Task 32)

- [ ] **Step 1: Creare il runbook con i comandi esatti**

Crea `docs/RUNBOOK-rotazione-secret.md` con ESATTAMENTE questo contenuto (comandi pronti; i `<NEW_...>` sono gli unici da sostituire col valore generato):

````markdown
# Runbook — Rotazione secret (CRON_SECRET, OPS_SECRET, WEBHOOK_SECRET)

Generare i nuovi valori:
```bash
openssl rand -hex 32   # NEW_CRON_SECRET
openssl rand -hex 32   # NEW_OPS_SECRET
openssl rand -hex 32   # NEW_WEBHOOK_SECRET
```

## A) CRON_SECRET — ordine: ENV VERCEL PRIMA, poi pg_cron (finestra di pochi secondi)

**A1. Vercel env + redeploy — FARE PER PRIMO.** Copre il self-cron di `instrumentation.ts` (legge l'env). Attendere che il deploy sia **READY** prima di A2.
```bash
vercel env rm CRON_SECRET production
printf '<NEW_CRON_SECRET>' | vercel env add CRON_SECRET production
vercel --prod          # attendere lo stato READY prima di procedere
```

**A2. pg_cron (Supabase, progetto inheoexhtuyjtfotbzyw) — SUBITO DOPO che il deploy è READY.** Sposta il secret in HEADER (esce dalla query string; l'endpoint accetta già `Authorization: Bearer`, `route.ts:69`). **NON usare `cron.unschedule` prima:** `cron.schedule` fa **upsert per nome** e mantiene lo stesso `jobid` (3); un unschedule+reschedule creerebbe un jobid nuovo e romperebbe tutte le verifiche `where jobid=3` (A4 qui e il gate 24h di Task 43-bis).
```sql
-- upsert per nome: mantiene jobid=3
select cron.schedule('send-messages-cron', '* * * * *', $$
  select net.http_get(
    url     := 'https://whatslaterpush.vercel.app/api/cron/send-messages',
    headers := jsonb_build_object('Authorization', 'Bearer <NEW_CRON_SECRET>')
  );
$$);
-- verifica (jobid deve restare 3):
select jobid, schedule, active, command from cron.job where jobname='send-messages-cron';
```

**A3. cron-job.org — NON è un consumer vivo.** Il job che pingava `/api/cron/send-messages` è **Inactive dal 12-giu-2026** (verificato): non serve aggiornarlo per il funzionamento. Opzionale: nel pannello, **cancellarlo** (o svuotare il vecchio secret dalla config) solo per togliere il vecchio `CRON_SECRET` dalla vista.

**A4. Ritestare `/api/test/sentry`** (usa CRON_SECRET) e verificare il pg_cron:
```bash
curl -s "https://whatslaterpush.vercel.app/api/test/sentry?secret=<NEW_CRON_SECRET>" | head
```
```sql
-- dopo ~2 min: il pg_cron gira col nuovo secret senza 401
select status, count(*) from cron.job_run_details
where jobid=3 and start_time > now() - interval '5 minutes' group by status;
```
Atteso: solo `succeeded`. → sblocca la verifica 24h di Task 43-bis.

## B) OPS_SECRET (vedi anche Task 32 per il cambio codice header-only)
```bash
vercel env rm OPS_SECRET production && printf '<NEW_OPS_SECRET>' | vercel env add OPS_SECRET production && vercel --prod
```
Poi sul server Hetzner (via terminale Coolify) aggiornare il file letto dal cron host-metrics:
```bash
sed -i 's/^OPS_SECRET=.*/OPS_SECRET=<NEW_OPS_SECRET>/' /etc/whatslater-metrics.env
```
E aggiornare l'`OPS_SECRET` negli URL/header dei task schedulati della Torre Cowork.

## C) WEBHOOK_SECRET
```bash
vercel env rm WEBHOOK_SECRET production && printf '<NEW_WEBHOOK_SECRET>' | vercel env add WEBHOOK_SECRET production && vercel --prod
```
Poi aggiornare lo stesso valore nella config webhook dell'istanza Evolution (Coolify → env della risorsa Evolution, oppure via `/webhook/set` con la nuova `x-webhook-secret`).
````

- [ ] **Step 2: Verificare completezza**

Run: `grep -c "cron.schedule\|vercel env\|/etc/whatslater-metrics.env\|Bearer" docs/RUNBOOK-rotazione-secret.md`
Atteso: `≥4`.

- [ ] **Step 3: Commit**

```bash
git add docs/RUNBOOK-rotazione-secret.md
git commit -m "docs(ops): runbook rotazione secret con comandi esatti (#44)"
```

---

# TIER P2 — Hardening e osservabilità (riduce il rischio di scoprire i guasti troppo tardi)

Ogni voce qui è una task compatta: **cosa / perché / file:riga / fix / verifica**. Applica lo stesso rigore (branch, un commit per voce, `tsc` pulito). Le voci `[RUNBOOK per Andrea]` = l'esecutore scrive il runbook/codice ma **non esegue** l'azione infrastrutturale (la fa Andrea nella sessione ops).

- [ ] **Task 18 — Onset alert atomico (backlog #9).** *Perché:* i due runner `*/15` (Vercel cron + cron-job.org) leggono entrambi `previousStatus=ok` e sparano lo stesso alert due volte (read-then-write, `monitoring.ts:624`, `802-814`). *Fix:* migration con unique partial index `monitoring_alerts(check_name, date_trunc('minute', created_at))`; nel dispatch, `INSERT ... ON CONFLICT DO NOTHING` **prima** di inviare, e inviare solo se l'insert ha creato la riga (claim-before-send). *Verifica:* `npx jest __tests__/monitoring-dedup.test.ts --ci` verde + aggiungi un test che simula due dispatch concorrenti.

- [ ] **Task 19 — Heartbeat per tutti i cron + dead-man esterno.** *Perché:* solo `send-messages` scrive heartbeat, e riga assente = trattata OK (`monitoring.ts:92-102`); gli altri 5 cron possono morire in silenzio. *Fix:* far scrivere `ops_heartbeat` a ogni cron (daily-report, cleanup-media, cleanup-webhook-logs, ops-worker, health-check) e aggiungere un check che, se un heartbeat esistente sparisce da >20min, emette `critical`. Registrare un monitor esterno (cron-job.org/healthchecks.io) che pinga se `health-check` non gira. *Verifica:* `npx jest __tests__/monitoring.test.ts --ci` verde; `grep -n "ops_heartbeat" app/api/cron/*/route.ts` mostra >1 file.

- [ ] **Task 20 — Capacity guard (soft cap istanze).** *Perché:* nessun limite impedisce all'11° utente di saturare la VM 4GB (`monitoring.ts:870`, auth/init nessun cap). *Fix:* in `auth/init`, contare le istanze `connection_status='open'`; oltre soglia (es. 12) rifiutare il nuovo pairing con messaggio "beta al completo, ti avvisiamo appena si libera un posto". *Verifica:* `npx tsc --noEmit` pulito; test unità sul conteggio.

- [ ] **Task 21 — [RUNBOOK per Andrea, #4] Backup offsite delle sessioni Baileys + restore di prova.** *Perché:* il backup copre solo Supabase (`backup-supabase.yml:36-37`); le sessioni Baileys vivono nel Postgres interno di Evolution (service `postgres`, db/user `evolution`, nessuna porta host — `evolution-compose.yml:63-71`) senza dump offsite → perdita nodo = tutti ri-pairano. *Deliverable dell'esecutore:* crea `docs/RUNBOOK-backup-baileys.md` con ESATTAMENTE questi comandi (Andrea li esegue via terminale Coolify sul nodo Hetzner):
  ````markdown
  # Dump del Postgres Evolution (sessioni Baileys). Il container è gestito da Coolify:
  PG=$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)
  docker exec "$PG" pg_dump -U evolution -d evolution -Fc > /root/evolution-$(date +%F).dump
  # Copiare OFFSITE (es. verso il repo privato di backup, o storage esterno):
  #   scp /root/evolution-*.dump <destinazione-offsite>
  # Restore di prova (su un Postgres vuoto di test, MAI in prod al primo giro):
  #   docker exec -i "$PG_TEST" pg_restore -U evolution -d evolution --clean < evolution-YYYY-MM-DD.dump
  ````
  Includere anche: schedulazione (cron sul server o GitHub Action settimanale), retention, e l'aggiunta dello **Storage Supabase (media)** al backup esistente (oggi `backup-supabase.yml` esclude `--exclude-schema=storage`). *Verifica:* `grep -c "pg_dump\|pg_restore" docs/RUNBOOK-backup-baileys.md` → `≥2`. **Esecuzione + restore di prova = Andrea in sessione ops.**

- [ ] **Task 22 — [RUNBOOK per Andrea, #4] Evolution dietro TLS + firewall ristretto.** *Perché:* `SERVER_URL http://157.90.251.241:8080` in chiaro (`evolution-compose.yml:33`) e firewall 8080 aperto a `0.0.0.0/0` (`README.md:24`): apikey admin + numeri + testo messaggi viaggiano non cifrati. *Deliverable dell'esecutore:* crea `docs/RUNBOOK-evolution-tls.md` con questi passi/comandi concreti (Andrea esegue; i `<...>` da riempire):
  ````markdown
  1. DNS: puntare un sottodominio (es. evolution.whatslater.it) all'IP 157.90.251.241 (record A).
  2. Coolify: esporre il service `evolution` (porta interna 8080) con quel dominio → Coolify emette il cert Let's Encrypt automaticamente (proxy Traefik/Caddy integrato). Verificare HTTPS:
     curl -sI https://evolution.whatslater.it/ | head -1     # atteso: HTTP/2 200|401
  3. Aggiornare Evolution SERVER_URL alla nuova base https (env della risorsa in Coolify), redeploy.
  4. Vercel: puntare l'app al nuovo dominio TLS
     vercel env rm EVOLUTION_API_URL production && printf 'https://evolution.whatslater.it' | vercel env add EVOLUTION_API_URL production && vercel --prod
  5. Ripuntare il webhook delle istanze al nuovo dominio (o verificare che l'URL webhook resti quello Vercel, invariato).
  6. Firewall: chiudere 8080 pubblico, lasciare solo 443 (e SSH se serve). Su Hetzner (ufw):
     ufw allow 443/tcp && ufw delete allow 8080/tcp && ufw reload && ufw status
     # (verificare prima che il proxy Coolify sia su 443 e funzioni, per non tagliarsi fuori)
  ````
  *Verifica del runbook:* `grep -c "ufw\|EVOLUTION_API_URL\|https" docs/RUNBOOK-evolution-tls.md` → `≥3`. **Esecuzione = Andrea in sessione ops** (ordine critico: TLS funzionante PRIMA di chiudere 8080).

- [ ] **Task 23 — N/A (decisione #5): la firma HMAC obbligatoria NON si attiva ora.** Confermato che **Evolution v2.3.7 non firma** gli eventi in uscita, quindi `EVOLUTION_SIGNATURE_REQUIRED=true` bloccherebbe tutti i webhook legittimi. La protezione resta `WEBHOOK_SECRET` in header (`webhook/route.ts:872`). **Nessuna azione di codice.** L'unica parte residua è la **rotazione di `WEBHOOK_SECRET`**, che confluisce nella sessione di rotazione secret (Task 44 la include come touchpoint). *Nota per l'esecutore:* non toccare `EVOLUTION_SIGNATURE_REQUIRED`; non è "in attesa di config", è una scelta chiusa.

- [ ] **Task 24 — Chiudere i buchi PII nei log (regressione `scrubPiiForLog` partial).** *Perché:* `console.log` di testo self-chat integrale (`webhook/route.ts:1303`, `764`) e `dbLog('CONTACT_NOT_FOUND', {allContacts...})` (`route.ts:339`) salvano PII in chiaro; lo scrubber lascia passare gli array annidati (`log-scrubber.ts:15-17`). *Fix:* rimuovere i `console.log` di testo integrale; aggiungere `allContacts`/`recipient_number` all'allowlist redact e redigere gli array annidati nello scrubber. *Verifica:* `npx jest __tests__/log-scrubber.test.ts --ci` verde + nuovo test su array annidato; `grep -n "console.log" app/api/webhook/route.ts` non mostra testo grezzo.

- [ ] **Task 25 — Canale alert non circolare + email da sender verificato.** *Perché:* l'alert WhatsApp passa dallo **stesso** nodo Evolution che monitora (`monitoring.ts:756-771`); il fallback email usa `onboarding@resend.dev` non verificato (`monitoring.ts:790`). Se il nodo cade, l'alert primario cade con lui. *Fix:* per `evolution_api`/`cron_heartbeat` inviare email **in parallelo** (non solo dopo il fail WhatsApp) da un dominio Resend verificato; aggiungere fallback email al daily-report. *Verifica:* forzare un check critical in locale e vedere l'email partire indipendentemente dal canale WhatsApp.

- [ ] **Task 26 — Rimuovere la conferma "✅ Inviato" per ogni messaggio.** *Perché:* `route.ts:701-707` invia un WhatsApp all'owner per **ogni** invio, senza timeout, fuori dal conteggio quota: viola il principio silenzioso e raddoppia il traffico Evolution. *Fix:* rimuovere la conferma per-messaggio (la dashboard mostra già "Inviato", i fallimenti sono già notificati); se serve un segnale, renderlo aggregato giornaliero. *Verifica:* `grep -n "Inviato a" app/api/cron/send-messages/route.ts` vuoto; suite cron verde.

- [ ] **Task 27 — Link "Aiuto / Segnala problema" in-app.** *Perché:* nessun canale feedback visibile (`Footer.tsx` non importato in dashboard/connect): il beta tester bloccato sparisce senza segnalare. *Fix:* aggiungere un link fisso (mailto o `wa.me/<numero Andrea>`) in dashboard e connect. *Verifica:* il link compare e apre il canale corretto.

- [ ] **Task 28 — I messaggi bot non rientrano nel parser LLM.** *Perché:* le notifiche di sistema in self-chat rientrano in `askAI` (`webhook/route.ts:1215-1219` guarda solo 3 stringhe, poi `askAI` a `1304`): chiamate Groq spazzatura + rischio ghost-schedule. *Fix:* marcare i messaggi bot con un sentinel riconoscibile ed early-return nel webhook prima di `askAI`. *Verifica:* test unità che un messaggio col sentinel viene scartato prima del parser.

- [ ] **Task 29 — Welcome/disclaimer con CAS (niente doppio benvenuto).** *Perché:* `welcome_sent` è read-then-write senza claim (`webhook/route.ts:952-978`); Baileys emette `state=open` più volte → doppio disclaimer+welcome al nuovo utente. *Fix:* fare l'update con `.eq('welcome_sent', false).select()` come CAS e inviare solo se ha aggiornato ≥1 riga. *Verifica:* test unità/integration del ramo CONNECTION_UPDATE.

- [ ] **Task 30 — `import 'server-only'` in `billing.ts`.** *Perché:* il contratto "server-only" del kill-switch è solo documentale (`billing.ts:4`); un import accidentale da un client component romperebbe silenziosamente il flag beta. *Fix:* aggiungere `import 'server-only';` come **prima riga** di `app/lib/billing.ts`. *Verifica:* `npx tsc --noEmit` pulito e `npm run build` non fallisce (nessun client component lo importa oggi); qualsiasi import futuro da client fallirà a build.

- [ ] **Task 31 — CI: `tsc --noEmit` + jest su ogni push + togliere `ignoreBuildErrors`.** *Perché:* `next.config.js:24-26` ha `ignoreBuildErrors:true`, zero CI, jest `strict:false`: un type error reale può deployare in prod. *Fix:* aggiungere `.github/workflows/ci.yml` che gira `npx tsc --noEmit` e `npx jest --ci` su PR/push a main; allineare `strict` nel tsconfig di ts-jest; togliere `ignoreBuildErrors` **solo quando** `tsc` è verde. *Verifica:* il workflow gira verde sul branch.

- [ ] **Task 32 — Ruotare `OPS_SECRET` + accettarlo solo via header sulle mutazioni.** *Perché:* `OPS_SECRET` è esposto in chat/log e accettato anche in query string su endpoint distruttivi (`ops-auth.ts:25-27` accetta header OR query per tutti). Il commento a `ops-auth.ts:18-21` dice esplicitamente che la query serve solo ai GET read-only della Torre/cron-job.org, non alle mutazioni. *Deliverable — CODICE (l'esecutore lo fa):* in `app/lib/ops-auth.ts`, aggiungere un parametro opt-in per saltare il fallback query, e usarlo dalle route di mutazione:
  ```js
  export function denyUnlessOpsAuthorized(req: NextRequest, opts?: { headerOnly?: boolean }): NextResponse | null {
    const expected = process.env.OPS_SECRET;
    if (!expected) return NextResponse.json({ error: 'OPS_SECRET not configured' }, { status: 500 });
    const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
    if (headerToken === expected) return null;
    if (!opts?.headerOnly) {                                   // query fallback SOLO per i GET read-only
      const queryToken = new URL(req.url).searchParams.get('secret');
      if (queryToken === expected) return null;
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  ```
  Poi passare `{ headerOnly: true }` dalle **route di mutazione**: `app/api/ops/evolution/manage`, `app/api/ops/coolify/manage`, `app/api/ops/coolify/redeploy`, `app/api/ops/egress/unquarantine`. *Deliverable — RUNBOOK:* i touchpoint di rotazione OPS_SECRET sono nella sezione B del `docs/RUNBOOK-rotazione-secret.md` (Task 44). *Verifica codice:* aggiungere a `__tests__/ops-auth.test.ts` un caso "mutazione con `?secret=` valido ma senza header → 401"; `npx jest __tests__/ops-auth.test.ts --ci` verde. *Rotazione vera:* Andrea in sessione ops (runbook Task 44 sezione B).

- [ ] **Task 33 — Errori pairing inline, non `alert()` col codice grezzo.** *Perché:* `connect/page.tsx:76` fa `alert(data.error || ...)` mostrando codici tipo `pairing_frozen` a un utente non tecnico. *Fix:* usare `data.message || data.error` e sostituire `alert()` con un errore inline nel form; gestire 503 (sovraccarico) e 409 (già collegato) con copy dedicato. *Verifica:* simulare le risposte e vedere il copy leggibile.

- [ ] **Task 34 — Host-metrics stale → alert reale, non solo DB.** *Perché:* quando il feed host-metrics muore, il warning non contiene `%` → il router lo declassa a solo-DB (`monitoring.ts:869-872`), e la RAM può salire all'OOM non vista. *Fix:* trattare "metriche host stale" come alert instradato su WhatsApp/email, non dedotto dalla regex del `%`. *Verifica:* test unità sul routing del caso feed-morto.

- [ ] **Task 35 — Normalizzazione telefono non corrompe numeri esteri.** *Perché:* `import/route.ts:14` `E164_RE=/^39\d{8,11}$/` e `phone.ts:11` trasforma ogni `0…` in `39…`: un numero estero digitato in locale può partire verso il destinatario sbagliato. *Fix:* non riscrivere numeri con prefisso `+`/`00` esteri; preservare l'E.164 fornito. *Verifica:* `npx jest __tests__/phone.test.ts --ci` verde + test con numero estero.

- [ ] **Task 36 — `verifyAndFixMessage`: guard sul troncamento / opt-in.** *Perché:* un secondo LLM riscrive il messaggio destinato al cliente con `max_tokens:150` senza check `finish_reason` (`webhook/route.ts:752-764`): può troncare il messaggio dell'utente. *Fix:* non sostituire mai se `finish_reason=length` o se `fixed.length < original.length`; alzare `max_tokens`; rendere il rewrite opt-in. *Verifica:* test unità sui casi di troncamento.

---

# TIER P3 — Igiene e taglio (riduce rumore e superficie del repo pubblico)

- [ ] **Task 37 — Cancellare il codice orfano (decisione #6). ⚠️ SOLO `ConnectStepper`.** *Correzione post-verifica:* `app/components/Logo.tsx` (versione `<img>`/PWA) e `components/Logo.tsx` (SVG inline) sono **entrambi vivi e distinti** — **NON cancellarli**. L'unico vero orfano confermato via grep è `components/ConnectStepper.tsx` (0 importer di produzione; unico importer = il suo test). *Fix:* cancellare `components/ConnectStepper.tsx` **e** `__tests__/connect-stepper.test.tsx`. *NON toccare:* `components/Button.tsx` (usato da `ContactPickerModal.tsx:7`), `app/api/debug-logs` (whitelisted in `middleware.ts:28` + test auth vivo), `app/lib/egress-pool.ts` (spento ma pronto, importato da monitoring/auth), i due `Logo.tsx`. *Verifica:* `grep -rn "ConnectStepper" app components --include=*.tsx` → 0 dopo la cancellazione; `npx jest --ci 2>&1 | tail -3` verde (la suite del test cancellato sparisce, nessuna nuova rossa); `npx tsc --noEmit` pulito.

- [ ] **Task 38 — Allineare `.env.example`, `README.md`, `CLAUDE.md`.** *Perché:* `.env.example` contiene ancora `DO_API_TOKEN`/`DO_DROPLET_ID` (DigitalOcean decommissionato) e commenti stale, e **manca** `OPS_SECRET`, `COOLIFY_*`, `HOST_METRICS_SOURCE`; `README.md:5,14,143` e `CLAUDE.md` hanno claim falsi ("555+ test verdi" vs 873). *Fix:* rimuovere il blocco `DO_*`, aggiungere le env mancanti al template, correggere le righe README e la riga test di CLAUDE.md (873 pass / 13 fail noti, di cui 3 flaky dopo la Task 1). *Verifica:* `grep -c "DO_API_TOKEN" .env.example` → 0; `grep -c "OPS_SECRET" .env.example` → ≥1.

- [ ] **Task 39 — Rigenerare `types/supabase.ts` + verificare l'indice caldo.** *Perché:* `types/supabase.ts` è lo schema v7 morto (`user_id`, tabelle mai create), non riproducibile dalle migration; l'indice `(status, scheduled_at)` che serve alla query calda del cron esiste solo nello snapshot deprecato `schema.sql`. *Fix:* rigenerare i types con `npm run db:types` (richiede `SUPABASE_PROJECT_ID`), oppure marcare il file DEPRECATO; aggiungere una migration esplicita che garantisce l'indice `idx_scheduled_messages_pending` su `(status, scheduled_at)` se non presente in prod. *Verifica:* la migration applica senza errore; la query `EXPLAIN` del cron usa l'indice.

- [ ] **Task 40 — Ripulire la zavorra dal repo pubblico (decisione #6, lista verificata).** *Perché:* zavorra visibile nel repo pubblico, zero dipendenza runtime (verificato via grep). **Lista esatta da cancellare:**
  - **`sprint5/` — 16 file HTML** (mockup design cluster A-F + hero + PWA/SPEC-FINAL, ~528KB). Riferiti solo in commenti-spec (`HeroSection.tsx:7-8`, `__tests__/manifest.test.ts:18`), nessuna dipendenza di build/test.
  - **`BUSINESS_PLAN.md`** — header "DOCUMENTO DEPRECATO — Marzo 2026" (pre-pivot ICP A).
  - **`LAUNCH_PLAN.md`** — header "DOCUMENTO DEPRECATO — 18 Marzo 2026".
  - **`docs/ARCHITETTURA.md`** — header "DOCUMENTO DEPRECATO — 4 Aprile 2026 (snapshot v7.0.0)".
  - **`supabase/schema.sql`** — snapshot legacy v7, header "DEPRECATED snapshot… kept ONLY as historical reference". *(Prima di cancellarlo, completa la Task 39: verifica che l'indice `(status, scheduled_at)` esista in prod via migration esplicita — lo snapshot è l'unico posto dove quell'indice è dichiarato.)*

  *Fix:* `git rm` dei file sopra. **NON toccare** i commenti-spec che li citano (restano leggibili come riferimento storico). *Verifica:* `git ls-files sprint5/ | wc -l` → 0; `git ls-files | grep -E "BUSINESS_PLAN|LAUNCH_PLAN|ARCHITETTURA" | wc -l` → 0; `npx jest __tests__/manifest.test.ts --ci` ancora verde (il test cita il path in un commento, non lo legge).

- [ ] **Task 41 — `cleanup-media`: throughput adeguato al carico beta.** *Perché:* smaltisce max 100 media/settimana (cap Hobby 10s); con 10 utenti il bucket Storage cresce senza limite. *Fix:* alzare il batch o aumentare la frequenza del cron; valutare `maxDuration`. *Verifica:* stimare il tasso di crescita media/settimana con 10 utenti e confrontarlo col throughput di cleanup.

---

# TIER FINDING POST-MERGE (review 14-lug, riconciliata contro `main` post-Fase1+2)

Una seconda review (3 agenti) ha rivisto il codice a valle del merge. **3 finding erano già chiusi da Fase 1+2** (doppio invio timeout=Task 6, head-of-line=Task 2, DELETE guard=Task 8 — il reviewer aveva letto codice pre-merge). Restano queste voci **verificate reali sul codice attuale**. Ordinate per gravità.

- [x] **Task 45 — [FATTO + DEPLOYATO `c9fe33a`, 14-lug] 3 cron collaterali 401 da Vercel Cron.** *Perché:* `daily-report`, `cleanup-media`, `cleanup-webhook-logs` leggevano SOLO `?secret=`, ma Vercel Cron manda `Authorization: Bearer` → **401 ad ogni run** (confermato in prod: daily-report 401×7/settimana). Conseguenza: daily-report mai eseguito (nessun report + `audit_events` mai potato → query flapping/ban sballate), media/log cresciuti all'infinito. *Fix:* leggono header Bearer OR `?secret=` come `send-messages` (`daily-report:240`, `cleanup-media:117`, `cleanup-webhook-logs:63`). *Verifica:* `__tests__/cron-auth.test.ts` (9 test) + prod-200 al prossimo run schedulato (daily-report 06:00 UTC; cleanup domenica).

- [x] **Task 46 — [LIVE in prod `8745c8e`, decisione confermata di tenerlo] Account hijack durante un flap (severità rivista al ribasso).** *Era:* il guard owner-only su `/api/auth/init` mordeva SOLO se `connection_status==='open'` → durante un flap un estraneo poteva iniettare una pending session per il numero della vittima. *Severità rivista dalla verifica avversariale:* **NON è un takeover one-click** — `forceDeleteInstance` unlinka il device, serve la ri-scansione FISICA del telefono della vittima entro il TTL 10min (social-engineering, realismo basso). Difetto strutturale reale, chiuso. *Fix implementato:* `auth/init:182` `if(existing)` + `verifyCookie` — qualsiasi numero con account esistente richiede il cookie owner; numero nuovo resta libero. Init registra `instance_name` sulla pending (prerequisito OTP). *Fix-2 webhook `.eq('instance_name')` SALTATO* (quasi-no-op: instance_name deterministico; + rischio NULL su pending legacy; fix-1 rende già il flip per-phone sicuro). *⚠️ Trade-off (accettato):* re-pair da browser nuovo (device perso, no cookie) → 409, recovery manuale operatore (`docs/RUNBOOK-recovery-repair.md`). *Decisione Andrea (14 lug): tenerlo live* — con 4 utenti e zero esterni l'attrito NON si manifesta (costo reale ~zero), mentre un revert sarebbe un'altra operazione delicata sul path auth in prod. **OTP self-chat v1.5 eliminerà l'attrito** (recovery self-service) — a quel punto il fix è completo senza costi. *Verifica:* 3 test TDD in `auth-flow.integration`.

- [ ] **Task 47 — [alta, corruzione dati] Ricorrenze migrano a mezzanotte.** *Perché:* quando una ricorrente sbatte su daily-limit/cool-down/rate-limit/blocked/disconnect, il suo `scheduled_at` viene sovrascritto (es. `nextRomeMidnight`, `send-messages:459/485/499/525/559/376`). Poi la reconciliation calcola la **prossima** occorrenza da `row.scheduled_at` MUTATO (`send-messages:237/249` → `recurrence.ts:185`). Per una DAILY, un "ogni giorno alle 18:00" che slitta a 00:15 fira alle 00:15 **ogni notte per sempre** — clienti messaggiati nel cuore della notte. Non esiste un anchor originale. *Fix:* colonna `original_scheduled_at` (o time-of-day della catena parent) da cui derivare la next-occurrence, indipendente dagli spostamenti operativi. *Verifica:* test che una ricorrente rischedulata mantiene l'orario originale nell'occorrenza successiva.

- [ ] **Task 48 — [alta] Select senza `.limit()` nel picker e nella lista messaggi.** *Perché:* Task 15 ha cappato SOLO la query cap-contatti nel POST. Il **picker** (`contacts` GET, `contacts/route.ts:157-160`) e la **lista messaggi** (`messages` GET, `messages/route.ts:56-61`) restano senza `.limit()`/`.range()` → cap silenzioso 1000 righe PostgREST. Un utente con >1000 contatti cached (ce n'è già uno con 951) perde la coda della rubrica; vecchi `paused` vivi possono sparire dalla lista. *Fix:* `.range()`/paginazione o `.limit()` esplicito sopra il default su entrambe le GET. *Verifica:* test con >1000 righe mockate → la query usa range/limit, nessun troncamento silenzioso.

- [ ] **Task 49 — [media, estende Task 17] `runAllChecks` esegue gli 11 check in SERIE.** *Perché:* Task 17 ha parallelizzato i probe *dentro* `checkWebhookInactive`, ma `runAllChecks` (`monitoring.ts:549-551`) resta un `for...await` sui 11 check, diversi dei quali fanno fetch di rete (Evolution, droplet, egress). Regge oggi solo grazie a `maxDuration=60`. *Fix:* `Promise.allSettled` anche su `runAllChecks` (o raggruppare i check di rete). *Verifica:* i check girano concorrenti; durata totale ≈ il check più lento, non la somma.

- [ ] **Task 50 — [media, estende Task 18] Il gemello recovery dell'onset-alert ha la stessa race.** *Perché:* Task 18 copre l'onset (`shouldAlert`→`dispatchAlert`), ma la **recovery** (`shouldRecover`→`sendRecovery`, `health-check:82-88`, `monitoring.ts:649-664`) è read-then-write identica → doppio "✅ Risolto" con 2 runner `*/15`. *Fix:* estendere lo stesso claim atomico (unique/CAS) anche alla recovery. *Verifica:* incluso nel test di Task 18 con due dispatch concorrenti di recovery.

- [ ] **Task 51 — [media] vCard senza `waid` non normalizzato → contatto doppio.** *Perché:* il ramo senza `waid` (`webhook:1167-1171`) pulisce il TEL a cifre e prepone `39` SOLO se inizia con `0` — NON passa da `validatePhone`/`normalizeItalianPhone`. Un mobile `340…` resta `340…` mentre la forma `waid` è `39340…` → chiavi diverse sullo unique `owner_phone,recipient_number` → 2 righe, doppio conteggio nel cap, invii falliti. *Fix:* normalizzare su ENTRAMBI i rami (waid e TEL) prima dell'upsert. *Verifica:* test che le due forme collassano su una riga.

- [ ] **Task 52 — [media, beta] `cleanup-media` (30gg) contro storico beta (90gg).** *Perché:* `cleanup-media` azzera media e cancella file Storage sulle righe terminali >30gg (`RETENTION_DAYS=30`), ma la GET lista mostra i terminali fino a `historyDays` (beta=90, `plans.ts`) → tra il giorno 30 e 90 gli allegati risultano spariti. Mascherato ORA perché il cron non girava (Task 45 lo riattiva → il problema diventa visibile). *Fix:* allineare `RETENTION_DAYS` al max `historyDays`, o escludere dal purge i media di righe ancora dentro la finestra history del piano effettivo. *Verifica:* test che un media di una riga entro 90gg non viene cancellato.

- [ ] **Task 53 — [media] Stati `awaiting_*` non allineati frontend/backend.** *Perché:* il backend crea `awaiting_time`/`awaiting_recipient`/`awaiting_confirm` (`webhook:1583/1604`) ma la UI ha config solo per `awaiting_confirm`/`contact`/`datetime`/`message` (`dashboard:265-268`): `awaiting_time`/`awaiting_recipient` non hanno badge, non sono in `UPCOMING_STATUSES` (invisibili), ogni PATCH dà 409. Impatto limitato al self-chat nascosto + self-heal 1h. *Fix:* allineare i set (backend usa i nomi UI, o la UI gestisce time/recipient). *Verifica:* test che gli stati awaiting_* del backend hanno tutti config UI + sono editabili.

*(#6 heartbeat-prima-del-lavoro resta la Task 19 esistente; nessuna nuova.)*

---

## Appendice A — Stato baseline e regressioni (dal review multi-agente)

**Baseline test (verificata):** `873 pass / 13 fail`, coerente con CLAUDE.md. I 13 fail = 8 suite Playwright raccolte per errore da Jest (**risolte dalla Task 1**) + 3 integration flaky pre-esistenti (`cron.integration`, `webhook.integration`, `webhook-quick-capture`). `tsc --noEmit` pulito.

**Regressioni sui bug già chiusi:** 33 check su 34 **reggono** (doppio invio, claim atomico, H1–H11, C1/C2, reset quote fail-loud, dedup Stripe, DST, ecc. — tutti verificati presenti nel codice). **Unica eccezione — Task 24:** `scrubPiiForLog` è **partial** (PII in chiaro nei `console.log` webhook e in `CONTACT_NOT_FOUND`).

## Appendice B — Finding esaminati e DE-prioritizzati (non serve agire ora)

- **"Onboarding tutti dallo stesso IP Hetzner → ban Meta"** — *refutato dalla verifica.* Il burn dei numeri è ASN-level e per-numero (restrizione Meta #2298 su 526/599), non da concentrazione IP; Hetzner non risulta bruciato (226/408/526 `open`). `PAIRING_PROXY_ENABLED=off` è una scelta deliberata, non un difetto. Rivalutare solo se compaiono 401 immediati su numeri freschi.
- **"Cold-start: 5 fallimenti bloccano un utente nuovo"** (#12) — reale ma non verificato in profondità; **incluso implicitamente** nel miglioramento del circuit-breaker (Task 2) e va rifinito con il conteggio per destinatari-distinti quando tocchi `checkFailures`.

## Appendice C — Come è stato prodotto questo piano

Review a 4 lenti (fragile / da tagliare / mancante / struttura-vs-obiettivo) via orchestrazione multi-agente: 10 mapper di sottosistema + baseline + 3 regression-checker + 9 hunter (priorità concorrenza) + merge/dedup + verifica avversariale bounded. Pool grezzo di 146 finding → **41 finding merged**, di cui 11 confermati e 1 refutato dalla verifica avversariale sui critical/high concorrenti. Ogni task cita l'evidenza `file:riga` da cui deriva.

Un secondo round di ricognizione mirata (per le decisioni di Andrea) ha aggiunto: audit `fetchCache` su 50 route (13 da fixare, Task 42); design del rate-limit riusando `rate_limit_record` senza SQL nuovo (Task 4); cut-list verificata con grep (Task 37/40, con la correzione sui due `Logo.tsx` entrambi vivi); e la **verifica in prod del pg_cron `send-messages-cron`** via Supabase (84.806 run, 0 fallimenti — Task 43/44).

Le task marcate "confermato" sono passate dalla verifica avversariale; le altre derivano da red flag di mappa corroborati da più agenti indipendenti o da verifica diretta in questo round.
