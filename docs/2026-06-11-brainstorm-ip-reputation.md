# Brainstorm: soffitto strutturale reputazione IP / pairing Baileys

Data: 2026-06-11 · Contesto: pairing nuovi dispositivi killati (401 loggedOut) da IP droplet DO Frankfurt. Sessioni esistenti sopravvivono. Analisi post-lettura repo (auth/init, monitoring.ts, ops/*) + verifica campo (issue EvolutionAPI #2437, vendor, pricing giugno 2026).

---

## 0. Verdetto secco (la domanda scomoda, subito)

**Non si risolve. Si gestisce.** E la distinzione non è retorica: Meta tiene tre kill-switch indipendenti, e tu ne controlli solo uno.

1. **Reputazione IP/ASN** (il problema di oggi) → **ingegnerizzabile**. Con pool di egress, diversità di provider e failover lo riduci a fastidio operativo da ~€10/mese. È l'unico layer dove puoi vincere davvero.
2. **Detection del protocollo** (fingerprint Baileys) → **non controllabile**. Dipendi dalla velocità di WhiskeySockets/Evolution upstream dopo ogni mossa di Meta. Aneddoto di campo 2026: "8 mesi senza problemi, un update e in 48h tutti i numeri fuori". Mitigazione = aggiornare in fretta e avere una finestra di esposizione di giorni, non eliminarla.
3. **Policy enforcement sui numeri** → solo parzialmente influenzabile. Il tuo ICP (15-50 contatti noti, volume basso, zero cold) è la classe d'uso più resistente che esista, ma il crackdown Meta di gennaio 2026 sui chatbot AI dimostra che la vite si sta stringendo, non allargando.

Il mercato prezza la gestione del SOLO layer 1 a $6-35/numero/mese (WASenderAPI→Whapi). Nessuno, a nessun prezzo, ti vende protezione dai layer 2-3. Se Whapi chiede $35 e tu €4,99, il tuo margine È letteralmente la tua disponibilità a fare l'idraulico della reputazione IP da solo. Questo è il business: borrowed protocol, borrowed time. I competitor convivono con la stessa fragilità da anni e ci hanno costruito sopra aziende — quindi è gestibile. Ma chi ti dice "risolvibile" ti sta vendendo qualcosa.

**Implicazione di business da scrivere nel piano:** niente SLA promessa nei ToS, cash buffer, e accettare che un'ondata protocollare Baileys-wide può fermare i NUOVI pairing per giorni (le sessioni esistenti storicamente sopravvivono — il tuo incidente lo conferma).

---

## 1. Cosa cambia il quadro (fatti verificati, non opinioni)

Dal repo e dall'issue #2437 (umbrella ufficiale QR/pairing, triage 2026-04):

- **Il pattern è ASN-level, non IP-level.** Hostinger: intero ASN bloccato da Meta (feb 2026), confermato con test extra_hosts su CDN diverse. Cambiare IP dentro DO ha probabilità bassa di funzionare. Migrazioni riuscite documentate: AWS us-east-1, Hetzner, server casalingo. E la citazione chiave del thread: *"mesmo migrando para outro DC, nada impede que isso volte a ocorrer lá"* — whack-a-mole, non fix.
- **Proxy sullo stesso VPS = inutile** (egress identico). Un utente l'ha scoperto a sue spese con TinyProxy. Il proxy serve solo se l'exit node è FUORI dall'ASN bruciato.
- **Evolution v2 supporta proxy per-istanza** nel payload di `/instance/create` (`proxyHost/proxyPort/proxyProtocol/proxyUsername/proxyPassword`) + endpoint `/proxy/set/{instance}` + env globali `PROXY_HOST/PORT/PROTOCOL`. Il tuo punto di integrazione è UNA riga di payload in `app/api/auth/init/route.ts` (~riga 143). E le env globali puoi settarle già oggi da remoto col TUO `/api/ops/coolify/env` + redeploy — la torre di controllo ha già il tooling.
- **Caveat reale: Baileys non instrada i media via proxy** (upload/download CDN vanno diretti). Per il tuo caso (reputation-kill al pairing, non blocco di rete) va bene: il choke point è l'handshake WS. Ma distingue due modalità di guasto diverse — vedi §4.
- **`CONFIG_SESSION_PHONE_VERSION`: non più necessaria su 2.3.4+** (Evolution inietta la versione aggiornata da solo) e pinnarla all'ultima ha causato ban a chi l'ha fatto. Lasciala stare.
- Sei su **v2.3.7 = ultima**, quindi "Evolution vecchio" è escluso come causa. La diagnosi IP/ASN regge.

Due modalità di guasto da tenere separate nella testa (e nel watchdog):

| Modalità | Sintomo | Cosa la cura |
|---|---|---|
| **Reputation-kill** (il tuo caso oggi) | Pairing nuovo → 401 subito; sessioni vecchie ok; media ok | Egress pulito per il pairing (proxy o nodo nuovo) |
| **Network-block** (caso Hostinger) | Tutto morto, anche sessioni esistenti e media | SOLO migrazione di nodo. Il proxy non basta (media non proxati) |

Oggi sei nella prima. La seconda è lo scenario che il tuo piano di resilienza deve assumere come possibile.

---

## 2. Livello A — Sbloccare ORA (ranked)

| # | Opzione | Costo | Effort | Rischio | Risolve |
|---|---|---|---|---|---|
| A1 | **ISP proxy statico EU per-istanza al pairing** (IPRoyal/Webshare, Frankfurt/Milano) | €2-5/mese | 2-4h | Basso (reversibile) | Sblocca ORA + è il mattone della scala |
| A2 | **Secondo nodo Evolution su altro ASN** (Hetzner CX22 ~€4, o AWS Lightsail) | €4-8/mese | 0,5-1 giorno | Basso; Hetzner è ASN chiacchierato ma funzionante a feb 2026 | Sblocca + serve comunque per RAM (§3-B3) |
| A3 | **Swap IP dentro DO** (reserved IP/nuovo droplet stesso DC) | €0 | 30 min | Nullo | Probabilità bassa (blocco ASN-level). Fallo solo come misurazione gratis |

**A1 in pratica:** compra 1 ISP proxy statico EU (~$2/mese, banda illimitata). In `auth/init`, dietro env flag (`PAIRING_PROXY_URL`), aggiungi i campi proxy al payload `instance/create`. Paira un numero di test. Se funziona hai: (a) lo sblocco, (b) la conferma definitiva della diagnosi, (c) il prototipo dell'architettura di lancio. È il miglior rapporto informazione/euro disponibile.

**Test empirico critico (giorno 2-3):** paira via proxy, poi rimuovi il proxy dall'istanza (`/proxy/set`) e osserva 48h. Le sessioni Baileys sopravvivono ai cambi IP (i telefoni cambiano rete di continuo) e il tuo stesso incidente dimostra che le sessioni stabilite sull'IP bruciato vivono. Se regge → **architettura "pairing-only egress"**: il proxy tocca solo il pairing, lo steady-state resta diretto sul droplet. Conseguenze enormi: 1-2 IP bastano a lungo, il proxy non diventa dipendenza di uptime h24, e niente concentrazione di N socket WhatsApp su un solo IP ISP. Se invece la sessione fresca muore al rientro sul droplet → fallback a proxy sticky con pool dimensionato (~15-25 sessioni/IP max, numero da strumentare, non da credere).

---

## 3. Livello B — Reggere il lancio (ranked)

| # | Opzione | Costo | Effort | Rischio | Risolve |
|---|---|---|---|---|---|
| B1 | **Pairing gateway: pool egress + budget pairing per IP** | €5-15/mese | 1-2 settimane part-time | Medio-basso | È LA risposta strutturale alla tua scala |
| B2 | **Throttle onboarding: cap pairing/giorno + cooldown per numero + waitlist drip** | €0 | 0,5-1 giorno | Nullo | Disinnesca il burst da lancio (il momento più pericoloso) |
| B3 | **Nodo B su altro ASN + runbook restore sessioni (testato!)** | €4-8/mese | 1-2 giorni | Basso | Assicurazione contro network-block + soffitto RAM |
| B4 | **Watchdog: salute per-egress + discriminatore "ondata vs IP"** | €0 | 1-2 giorni | Nullo | Failover informato invece che panico |
| B5 | **Igiene protocollo** (update cadence, no pinning, no retry storm) | €0 | ongoing, ore | Nullo | Riduce esposizione layer 2 |
| B6 | **Vendor managed** (WASenderAPI $6→$4,5/sessione; Whapi $29-35) | $6-35/utente/mese | 1 settimana (adapter) | Vendor risk + GDPR + stessa fragilità sotto | Piano B credibile, ma uccide il margine Personal |
| B7 | **Break-glass: modalità degradata wa.me tap-to-send** | €0 | 2-3 giorni (dopo) | Nullo | Preserva il valore "dal tuo numero" durante un'ondata |

**B1 — Pairing gateway (il cuore).** Tabella `egress_pool` (proxy creds, stato, budget) + colonna egress su `user_instances`. `auth/init` sceglie un egress sano con budget residuo (es. max 4-5 pairing/giorno/IP, warm-up più lento per IP nuovi: 1-2/giorno la prima settimana — soglie folk, non documentate: parti conservativo e strumenta). Hai già `pairing_started/pairing_completed` in `audit_events`: aggiungi il label egress al payload e `checkPairingBlackout` diventa per-egress quasi gratis. Successo per-egress sotto soglia → quarantena automatica via `ops_commands` (pattern già tuo). Con 3 IP × 4 pairing/giorno = 12 onboarding/giorno = 360/mese: sopra ogni scenario organico realistico; per i burst da marketing allarghi il pool con giorni di anticipo (è un acquisto da $2, non un progetto).

**B2 — Throttle.** Cap globale `MAX_PAIRINGS_PER_DAY` (specchio del pattern `MAX_PENDING` che hai già per i messaggi) + cooldown server-side su `auth/init` per numero (es. 3 init/h — oggi un utente confuso che ritenta genera churn di create/delete istanza visibile dal tuo IP). Oltre il cap: waitlist con drip ("ti avvisiamo domani"). Sì, fa male mettere in coda iscritti caldi al lancio. Fa più male bruciare l'ASN il giorno del lancio con il 100% degli iscritti bloccati. Il tuo GTM (comunità piccole, organico) è compatibile con un drip; un burst da 200 pairing in un'ora non lo è con NESSUNA architettura single-IP.

**B3 — Nodo B + runbook.** Hetzner via Coolify multi-server (un solo pannello, i tuoi `/api/ops/coolify/*` continuano a funzionare). Le credenziali sessione di Evolution v2 vivono nel suo Postgres: dump → restore su nodo B → le sessioni si riconnettono SENZA re-pairing degli utenti. Questo è il fatto più sottovalutato di tutto il piano: lo scenario incubo "droplet bruciato = tutti ri-pairano" è FALSO se hai testato il restore una volta. Fallo una volta, cronometralo, scrivi il runbook. Quella è la tua vera assicurazione, più di qualunque proxy. Bonus: il nodo B risolve anche il secondo soffitto strutturale che non hai citato ma hai — 2GB/1vCPU regge realisticamente 15-25 istanze Baileys con `syncFullHistory:false`; a 30-40 utenti ci sbatti comunque.

**B4 — Watchdog.** Il discriminatore che ti manca: se UN egress fallisce i pairing → quarantena e ruota (problema locale). Se TUTTI gli egress falliscono insieme → ondata protocollare/upstream → **freeze totale dei pairing** (ogni tentativo in più brucia fiducia del numero e dell'IP), alert, aspetta fix upstream. Niente canary sintetici con pairing veri: un pairing finto consuma reputazione esattamente come uno vero. Telemetria passiva sui pairing reali + il tuo `instance_flapping` esistente bastano.

**B6 — Managed, i numeri veri (giugno 2026).** Whapi $35/canale ($29 annuale, sconti partner/white-label), numeri personali ok via QR/pairing. 2Chat da $38. Wassenger ha pivotato sull'API ufficiale (fuori gioco per te). WASenderAPI $6/sessione → $4,50-5 a volume: è l'unico compatibile con qualcosa, e solo coi tier Professional/Business. Contro strutturali: (a) Personal €4,99 muore anche a $6; (b) i messaggi dei tuoi utenti transitano da un processor terzo → DPA, addio al lavoro GDPR Sprint 6 fatto in casa; (c) sotto il cofano è lo stesso protocollo — compri la gestione del layer 1, non l'immunità; (d) vendor budget = rischio longevità. Uso giusto: piano B documentato (adapter pronto sulla carta, non costruito) o split per tier se un giorno il self-host ti satura. Se mai diventa necessario, il floor di pricing si sposta a ~€12-15/utente: decisione di business, non tecnica.

**B7 — Break-glass.** Se i pairing sono globalmente rotti per giorni (ondata layer 2), modalità degradata dichiarata: all'ora schedulata il SISTEMA manda all'utente un link `wa.me` precompilato → tap → il messaggio parte dal suo numero, manualmente. Viola il principio silenzioso, e va bene così: è il piano C dichiarato per l'emergenza, mantiene viva la promessa "dal tuo numero" quando l'infra non può. Da costruire DOPO il lancio, non ora.

---

## 4. Cose da NON fare (e perché)

- **TinyProxy/Squid sullo stesso droplet**: egress invariato, zero effetto. Confermato sul campo.
- **Pinnare `CONFIG_SESSION_PHONE_VERSION`**: non serve su 2.3.7 e ha causato ban.
- **Proxy env GLOBALE su Evolution**: instraderebbe anche le sessioni esistenti (sane, dirette) attraverso il proxy → crei una dipendenza di uptime e un punto di concentrazione per tutti. Proxy per-istanza, solo dove serve.
- **Residential ROTATING per le sessioni**: l'IP che cambia sotto un socket lungo è rumore inutile. Per pairing/sessioni servono IP statici (ISP).
- **Canary di pairing sintetici schedulati**: consumano reputazione vera per produrre telemetria che i pairing reali ti danno gratis.
- **Mobile proxy dedicato (€50-90/mese)**: overkill ora; rivaluta solo se gli ISP proxy si dimostrano deboli ai pairing (possibile ma non riportato come necessario nel thread).
- **Multi-sessione ridondante per utente** (2 slot companion): doppia RAM, doppio rischio ban, doppia frizione onboarding. No.
- **API ufficiale / coexistence**: manda solo da numeri business. Per definizione fuori. (E i "WhatsApp Business API ufficiale per numero personale" che vedrai pubblicizzati sono Baileys con il trucco.)
- **Client-side sending (PWA)**: un service worker non può tenere un socket WhatsApp. Vicolo cieco.

---

## 5. Percorso concreto (founder solo, budget basso)

**Giorno 0-1 — Sblocco + diagnosi definitiva (~€5)**
1. A3 gratis: swap IP DO, 30 min, aspettativa bassa.
2. A1: compra 1 ISP proxy statico EU, campo proxy in `auth/init` dietro env flag, paira un numero di test. → Se passa: diagnosi confermata, prodotto sbloccato.

**Giorno 2-4 — Decidi l'architettura con un esperimento**
3. Test "pair-via-proxy → steady-state diretto" (48h). Esito A: pairing-only egress (migliore). Esito B: proxy sticky + pool.

**Settimana 1-2 — Hardening pre-lancio (~€10/mese totali)**
4. B2: cap globale pairing/giorno + cooldown per numero + waitlist drip.
5. B1 v0: 2 IP nel pool (anche solo 2 env var, niente sovra-ingegneria), budget per IP, label egress in `audit_events`, `checkPairingBlackout` per-egress.
6. B4: regola freeze-tutto se 2+ egress falliscono insieme.

**Settimana 2-3 — Assicurazione (~€15/mese totali)**
7. B3: nodo Hetzner standby via Coolify multi-server. **Test del restore sessioni una volta, runbook scritto.** Da qui in poi il worst-case "ASN DO network-blocked" = ore di lavoro, non morte del prodotto.

**Trigger post-lancio (decisioni già prese, da eseguire a soglia)**
- RAM >65% o >25 utenti attivi → nodo B attivo, nuovi utenti pairano e vivono lì (diversità ASN gratis, blast radius dimezzato).
- Pairing success rate di un egress degrada → quarantena + swap IP (acquisto da $2, non progetto).
- Ondata Baileys-wide → freeze pairing + comunicazione onesta + valuta WASenderAPI come tampone per nuovi utenti business mentre upstream fixa.
- Margini sotto pressione o ops insostenibili → rivedi pricing PRIMA di andare managed, non dopo.

---

## 6. Rischio residuo non assicurabile (da accettare per iscritto)

Dopo tutto questo resta scoperto: un'ondata di detection protocollare che Meta può lanciare quando vuole (storico: giorni di blackout pairing, sessioni esistenti quasi sempre sopravvissute), e l'enforcement policy sui numeri (il tuo ICP è la classe meno esposta in assoluto, ma non a rischio zero). Nessun fornitore, prezzo o architettura elimina questo. La risposta giusta non è tecnica: niente SLA nei ToS, comunicazione onesta in caso di ondata, cash buffer, e un prodotto il cui valore per utente è abbastanza alto da perdonare un'interruzione di pairing di 3 giorni. Se questo rischio residuo non è accettabile, il prodotto giusto è un altro. Se lo è — ed è l'assunzione su cui Whapi e soci hanno costruito business pluriennali — il piano sopra lo porta da "roulette" a "fastidio operativo misurabile".

---

## Fonti
- [Issue #2437 — META QR/pairing umbrella](https://github.com/EvolutionAPI/evolution-api/issues/2437) (blocco ASN Hostinger, migrazioni AWS/Hetzner, TinyProxy stesso-VPS inutile, media non proxati, CONFIG_SESSION_PHONE_VERSION deprecata)
- [Evolution API v2 — Create Instance (campi proxy)](https://doc.evolution-api.com/v2/api-reference/instance-controller/create-instance-basic)
- [Whapi pricing](https://whapi.cloud/price) · [WASenderAPI](https://wasenderapi.com/) · [Wassenger pricing](https://wassenger.com/pricing) · [2Chat review](https://erwinvanginkel.com/whatsapp-business/2chat/)
- [IPRoyal static residential pricing](https://iproyal.com/pricing/static-residential-proxies/) · [Confronto ISP proxy 2026](https://aimultiple.com/isp-proxies)
- [Crackdown Meta gen-2026 su chatbot terzi](https://chatboq.com/blogs/third-party-ai-chatbots-ban)
