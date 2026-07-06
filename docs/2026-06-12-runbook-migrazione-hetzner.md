# Runbook: migrazione DigitalOcean → Hetzner

> **STATO (2026-07-05): ✅ ESEGUITO — migrazione completata, DigitalOcean DISMESSO.**
> 2026-07-05: verifica live pre-destroy RIPETUTA, 3/3 PASS (Coolify=Hetzner `hopixj64…` via `/api/ops/coolify/containers`; `EVOLUTION_API_URL`=Hetzner provata via `manager` URL in `/api/ops/evolution/version`; 4 istanze `open` su Hetzner: 226/599/739/526). **Env `DO_API_TOKEN`/`DO_DROPLET_ID` RIMOSSE da Vercel + redeploy production ✅** (Claude). **Fase 6 eseguita da Andrea in pari data (guidato via Chrome): droplet `ubuntu-s-1vcpu-2gb-70gb-intel-fra1-01` (161.35.212.68) DISTRUTTO; Volumes/Snapshots/Backups/Reserved IP/Load Balancer verificati VUOTI; token `whatslaterpush-monitoring` REVOCATO; billing $0.00.** Dump finale Postgres saltato di proposito (rollback non più significativo: sessioni ri-pairate su Hetzner, dati su Supabase). Lavori di codice §8 CHIUSI: §8.1 eseguita 2026-07-05 (commit `a330b3e`, modulo `coolify-base.ts` fail-loud + 7° residuo `COOLIFY_EVOLUTION_UUID`); §8.2 eseguita 2026-07-06 (push host-metrics live, verificato E2E; gotcha Next Data Cache sulle GET supabase → fix no-store). Resta solo la rotazione `OPS_SECRET` post-sessione. **RUNBOOK COMPLETAMENTE ESEGUITO.**
>
> Storico:
> **STATO (2026-06-24): VERIFICA / GO COMPLETATI — Fase 6 (power-off → destroy → cleanup env DO) ANCORA DA ESEGUIRE a mano da Andrea.**
> Cutover su Hetzner fatto e verificato live. Indagine read-only 2026-06-23/24 (4 lenti avversariali) → **GO al decommission con 5/5 verifiche PASS**: `EVOLUTION_API_URL`=Hetzner (nessun fallback DO in codice), `COOLIFY_API_URL`=Hetzner confermata live via `/api/ops/coolify/containers` (uuid `hopixj64…`, non DO `pkso00o0…`), 4 istanze `open` su Hetzner, nessun cron/webhook/config→DO (solo 6 file Coolify col fallback `|| 161.35.212.68`, dormiente: `ops_commands` vuota), dati tutti su Supabase + Storage.
> **Il droplet DO `161.35.212.68` resta ACCESO come nodo backup/rollback finché Andrea non lo distrugge davvero.** Il power-off→destroy→cleanup (Fase 6) NON è ancora avvenuto.
> **Quando il destroy sarà fatto** → marcare questo runbook "eseguito" e togliere i riferimenti DO residui. (Env `DO_API_TOKEN`/`DO_DROPLET_ID` già rimosse da Vercel + redeploy, e CLAUDE.md già aggiornato, il 2026-07-05.)

Data: 2026-06-12 · Deadline esterna: crediti DO scadono **31 luglio 2026** (poi standard billing $12/mese).
Decisione: Hetzner diventa il **nodo primario del lancio**. DO resta acceso come rollback (gratis, coperto dai crediti) e si distrugge solo a migrazione verificata.

**Regola d'oro: si spegne DO solo DOPO 7 giorni di Hetzner stabile. Mai prima.**

---

## Strategia: fresh start, non dump/restore

Con ~0 utenti reali, sul droplet non c'è quasi nulla di prezioso: contatti cache, messaggi, audit, media stanno **tutti su Supabase**. Sul droplet vivono solo le sessioni Evolution (la tua istanza operatore + test) e la config Coolify. Quindi:

- **Fresh start**: Coolify pulito + Evolution pulito su Hetzner, ri-pairi il tuo numero operatore (2 minuti) e i numeri di test. Zero complessità di migrazione dati.
- **Dump/restore del Postgres Evolution** resta come **fallback** solo se il pairing diretto da Hetzner risultasse bloccato (le sessioni già stabilite sopravvivono al trasloco di IP — confermato dall'incidente DO).

Ogni utente reale onboardato su DO da oggi in poi renderebbe la migrazione più delicata: **prima si migra, poi si lancia la campagna.**

---

## Chi fa cosa

| Andrea (serve identità/pagamento/SSH) | Claude (da Cowork) |
|---|---|
| Account Hetzner + metodo di pagamento | Runbook (questo file) |
| Creazione server (5 min, guidata sotto) | Modifiche codice pre/post-cutover (§8) |
| Incollare 1 comando via console/SSH | Verifica deploy Vercel + lettura torre/logs |
| Copiare env dal Coolify vecchio al nuovo | Supporto in tempo reale durante il cutover |

---

## Fase 1 — Account e server (Giorno 0, ~30 min)

1. Account su `console.hetzner.com` → Cloud. Nota: i nuovi account a volte richiedono verifica identità e partono con limiti bassi — se succede, è normale, si sblocca in fretta. Metodo di pagamento: carta o PayPal.
2. Nuovo progetto → **Add Server**:
   - **Location**: Falkenstein (fsn1) o Norimberga (nbg1) — entrambe ok, latenza verso Vercel/Supabase EU equivalente a Frankfurt.
   - **Image**: Ubuntu 24.04.
   - **Type**: **CX22** (x86, 2 vCPU, 4GB RAM, 40GB) — RAM doppia del droplet DO. Evita ARM (CAX) finché non verifichiamo che l'immagine Evolution sia multi-arch. Prezzo esatto lo vedi al checkout (Hetzner ha ritoccato i listini ad aprile 2026, ~€4-6/mese).
   - **Networking**: **IPv4 pubblico ABILITATO** (costa ~€0,50/mese extra: obbligatorio — un server IPv6-only ricreerebbe esattamente il bug di maggio).
   - **SSH key**: se non ne hai una: `ssh-keygen -t ed25519` sul Mac, incolli il contenuto di `~/.ssh/id_ed25519.pub`.
   - **Backups**: ON (+20%, ~€1/mese — assicurazione che costa un caffè).
3. **Firewall Hetzner** (dalla console, applicato al server):
   - 22/tcp: solo dal tuo IP (o lascialo aperto se hai IP dinamico, la key protegge).
   - 80, 443/tcp: aperti.
   - 8000/tcp (Coolify API/UI): aperto con auth a token come oggi su DO — la torre di controllo chiama da Vercel che non ha IP fissi. (Hardening futuro: mettere Coolify dietro dominio+HTTPS, backlog.)
   - Porta Evolution: replica l'esposizione attuale (stessa porta/dominio che oggi è in `EVOLUTION_API_URL`).
4. Installa Coolify — un solo comando da root (console web Hetzner o SSH):
   ```bash
   curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
   ```
   ~10 minuti. Poi apri `http://<IP-NUOVO>:8000`, crea l'admin, genera un **API token** (Settings → API) → servirà per `COOLIFY_API_TOKEN` su Vercel.

Billing orario: un server cancellato smette di costare. Tienilo a mente per la Fase 2.

---

## Fase 2 — IL test che decide tutto (Giorno 0-1)

**Prima di costruire tutto, verifica che l'IP Hetzner non sia a sua volta bruciato per i pairing.**

1. Su Coolify nuovo: deploy Evolution minimale (anche solo il servizio Evolution + Postgres + Redis del compose, vedi Fase 3).
2. Crea un'istanza di test e paira un **numero di riserva** (MAI il numero operatore in questa fase) — direttamente, senza proxy.
3. Esiti:
   - ✅ **Pairing regge >1h** → IP buono, prosegui Fase 3. Il proxy ISP resta assicurazione da attivare più avanti (il pool egress è già deployato, default OFF).
   - ❌ **401 immediato come su DO** → cancella il server e ricrealo (IP nuovo, costo ~zero col billing orario). Riprova 2-3 volte. Se anche allora fallisce → l'ASN Hetzner è messo male per te: attiva `PAIRING_PROXY_ENABLED=true` con un ISP proxy (piano A1 già pronto) e prosegui comunque — il nodo serve lo stesso per RAM/costi.

---

## Fase 3 — Build completo (Giorno 1-2)

1. Su Coolify nuovo: risorsa Docker Compose con i 3 servizi, **stessi tag di oggi**:
   - `evoapicloud/evolution-api:v2.3.7` (pinnato, non `latest`)
   - Postgres (volume persistente!) + Redis
2. **Env**: apri il Coolify vecchio (`http://161.35.212.68:8000`) e copia le env del servizio Evolution una a una nel nuovo. Chiavi critiche: `AUTHENTICATION_API_KEY` (se la tieni identica, su Vercel non va cambiato `EVOLUTION_API_KEY`), `DATABASE_*`, `CACHE_*`, webhook globali se presenti.
3. Verifica `https://<nuovo>/` → la versione risponde (stesso check del tuo `/api/ops/evolution/version`).
4. NON toccare ancora le env Vercel: il prod continua a puntare a DO.

---

## Fase 4 — Cutover (30-60 min, fascia serale)

Su Vercel → Settings → Environment Variables (production):

| Env | Azione |
|---|---|
| `EVOLUTION_API_URL` | → URL nuovo Hetzner |
| `EVOLUTION_API_KEY` | invariata se hai riusato la stessa key, altrimenti aggiorna |
| `COOLIFY_API_URL` | → `http://<IP-NUOVO>:8000` ⚠️ **se oggi NON esiste su Vercel, va CREATA**: 6 file hanno un fallback hardcoded all'IP DO (vedi §8) |
| `COOLIFY_API_TOKEN` | → token del Coolify nuovo |
| `DO_API_TOKEN`, `DO_DROPLET_ID` | rimuovi (vedi §8 per il buco di monitoring che si apre) |

Poi, in ordine:
1. Redeploy Vercel (le env entrano solo col redeploy).
2. **Ri-paira il numero operatore** sul nodo nuovo — è il canale degli alert WhatsApp del watchdog: finché non lo fai, gli alert cascano su email (Resend). La vecchia sessione resta come dispositivo collegato zombie sul telefono: rimuovila da WhatsApp → Dispositivi collegati (o si spegne col teardown).
3. Test end-to-end: pairing numero di riserva → schedula messaggio a 2 min → arriva → `audit_events` registra `message_sent`.
4. Torre di controllo: `/api/ops/evolution/instances` e `/api/ops/coolify/containers` rispondono dal nodo nuovo; `/admin/tower` verde (la card droplet DO resterà vuota — atteso, §8).
5. **`/api/admin/backfill-photos`** dopo il re-pair: gli URL foto `pps.whatsapp.net` cachati su Supabase scadono — il backfill li rinfresca (audit storico Q1).

Nota esposizione (audit Q7): il vecchio nodo esponeva Evolution via dominio sslip.io HTTP del proxy Coolify; sul nuovo si parte in parità (`http://157.90.251.241:8080` diretto). Dominio vero + HTTPS per l'API key in transito = hardening in backlog, non blocker del cutover.

**Rollback** (se qualcosa va storto): rimetti le env vecchie + redeploy. DO è ancora lì, intatto. Per questo non si distrugge nulla oggi.

---

## Fase 5 — Osservazione (7 giorni, DO acceso in parallelo)

- Watchdog e torre già coprono: `pairing_blackout`, `instance_flapping`, webhook, cron.
- Attenzione manuale: stabilità della sessione operatore (gli alert arrivano su WhatsApp?), RAM dal pannello Coolify (l'alert automatico RAM è il buco temporaneo di §8).

---

## Fase 6 — Teardown DO (dopo Fase 5, comunque ENTRO il 31 luglio)

0. **Verifica punti ciechi SSH** (audit storico Q5/Q6 — 10 min dalla console web DO, Droplet → Access → Launch Console):
   ```bash
   crontab -l; ls -la /etc/cron.d /etc/cron.daily 2>/dev/null
   systemctl list-timers --all | head -20
   docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
   docker volume ls
   docker inspect $(docker ps -q) --format '{{.Name}} {{range .Mounts}}{{.Source}}→{{.Destination}} {{end}}' 2>/dev/null
   ```
   Cerchi: cron/script non noti, container fuori inventario (atteso: Coolify + Evolution + Postgres + Redis + orphan `whatslaterpush:main` spenta — NON ricrearla sul nuovo), mount custom. Se esce qualcosa di ignoto → fermati e valuta prima di distruggere.
1. Dump finale del Postgres Evolution **scaricato in locale** come cintura di sicurezza (NON snapshot DO: gli snapshot fatturano dopo il 31/7).
2. **Destroy** del droplet — non power-off: su DO un droplet spento fattura comunque.
3. Pulizia risorse orfane in billing: Volumes, Snapshots, Reserved IP staccati, Load Balancer.
4. Revoca il `DO_API_TOKEN` (è morto, ma igiene).
5. Decidi se rimuovere il metodo di pagamento dall'account DO.

---

## §7 — Cosa NON cambia (zero azioni)

Supabase, Stripe, Resend, Sentry, cron-job.org (pinga Vercel, non il droplet), dominio `whatslaterpush.vercel.app`, codice app (egress pool resta deployato OFF). I webhook per-istanza puntano a Vercel e nascono col create — le istanze nuove li ricevono da sole.

---

## §8 — Lavori di codice collegati (li fa Claude, su richiesta)

1. ✅ **FATTO 2026-07-05 (commit `a330b3e`)** — **Fallback hardcoded IP DO in 6 file** (`ops-worker`, `coolify/{containers,redeploy,manage,logs,env}`): `process.env.COOLIFY_API_URL || 'http://161.35.212.68:8000'`. Centralizzato in `app/lib/coolify-base.ts`, fallback RIMOSSO (fail-loud). Bonus: 7° residuo `DEFAULT_EVOLUTION_UUID` (uuid DO in coolify/logs) → env `COOLIFY_EVOLUTION_UUID`.
2. ✅ **CHIUSO 2026-07-06 (commit `395a528` + fix Data Cache `95c896f`, verificato E2E)** — **Buco monitoring RAM post-DO**: `app/lib/droplet.ts` + `checkDropletRam` + `/api/ops/droplet/metrics` + `stress-index` + `admin/droplet` + `daily-report` usano l'API DigitalOcean. Senza `DO_*` degradano in silenzio → **si perde l'alert RAM 50/70/80%**. L'API Hetzner NON espone la memoria (solo cpu/disk/network), quindi la soluzione provider-agnostic è un **push**: cron sul server (cloud-init) che ogni 60s manda `free`/`df`/loadavg a un nuovo `POST /api/ops/host-metrics` (OPS_SECRET) → ultima riga letta da `fetchDropletMetrics` quando `HOST_METRICS_SOURCE=push`. ~30 righe + test. Mai più sposati a un'API di provider.
3. **Docs**: aggiornare CLAUDE.md (IP droplet, sezione stack) e marcare questo runbook come eseguito.

---

## Gotchas Hetzner

- Prezzi post-aumento aprile 2026: il listino vero lo vedi al checkout.
- IPv4 a pagamento ma obbligatoria (vedi sopra).
- Nuovi account: possibile verifica identità + limiti iniziali.
- SMTP outbound bloccato di default sui nuovi account — irrilevante (Resend va in HTTPS).
- Billing orario = la "roulette IP" della Fase 2 costa centesimi.
