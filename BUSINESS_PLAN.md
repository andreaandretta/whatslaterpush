# WhatsLater — Business Plan

**Tagline:** Schedula messaggi WhatsApp dal tuo numero personale, senza app, in 2 minuti.

**Versione:** 1.0 — Marzo 2026
**Stato:** Pre-lancio, MVP funzionante in produzione
**URL:** https://whatslaterpush.vercel.app
**Stack:** Next.js 14, Supabase, Evolution API v2, Groq AI, Stripe

---

## Indice

1. [Posizionamento e Value Proposition](#1-posizionamento-e-value-proposition)
2. [Pricing e Monetizzazione](#2-pricing-e-monetizzazione)
3. [Go-to-Market — Primi 100 Utenti Paganti](#3-go-to-market--primi-100-utenti-paganti)
4. [Rischi e Mitigazioni](#4-rischi-e-mitigazioni)
5. [Scalabilità Tecnica e Roadmap](#5-scalabilità-tecnica-e-roadmap)
6. [Prossimi 30 Giorni](#6-prossimi-30-giorni)

---

## 1. Posizionamento e Value Proposition

### Il problema

Milioni di professionisti e piccole imprese italiane perdono clienti per appuntamenti dimenticati, follow-up mancati e comunicazioni in ritardo. Gli strumenti esistenti richiedono numeri business dedicati, approvazioni Meta, setup complessi e costi elevati.

### La soluzione

WhatsLater permette di programmare messaggi WhatsApp **dal proprio numero personale**, usando linguaggio naturale. Nessuna app da installare, nessuna approvazione Meta, setup in 2 minuti.

L'utente scrive a se stesso su WhatsApp:
> "Invia a Marco domani alle 15: Ricordati la riunione!"

L'AI capisce destinatario, orario e messaggio. Chiede conferma. Invia automaticamente all'orario programmato.

### Vantaggio competitivo unico

Il messaggio arriva dal **numero personale dell'utente**, non da un numero sconosciuto. I clienti vedono il nome che conoscono e di cui si fidano. Zero burocrazia, zero template da approvare, zero numeri Twilio.

### Differenziazione competitiva

| Competitor | Problema | WhatsLater |
|-----------|----------|------------|
| WATI / Respond.io | €50+/mese, numero dedicato, setup settimane | €4.99-19.99, tuo numero, 2 minuti |
| SKEDit | App Android, hack accessibilità, inaffidabile | Browser, nessuna app, AI parsing |
| Brevo / Mailchimp | WhatsApp Business API, template approvati | Zero burocrazia, linguaggio naturale |
| Whatso / WhatSender | Bulk sender, alto rischio ban | Messaggi mirati, rate limiting, anti-ban |
| Calendly | No WhatsApp nativo, solo reminder | WhatsApp-first, dal tuo numero |

WhatsLater non compete direttamente con nessuno di questi. Crea una nuova categoria: **personal messaging scheduler**.

### Target di mercato

**Primario (lancio):**
- Professionisti italiani: medici, dentisti, avvocati, personal trainer, estetiste, parrucchieri
- Piccoli negozi e ristoranti: conferme prenotazioni, promemoria
- Agenti immobiliari: follow-up clienti

**Secondario (crescita):**
- Utenti normali: compleanni, promemoria personali (piano gratuito, crescita virale)

---

## 2. Pricing e Monetizzazione

### Modello: Freemium a 3 tier con cool-down automatico

| | Free | Personal (€4.99/mese) | Business (€19.99/mese) |
|---|---|---|---|
| Messaggi/giorno | 3 | 20 | 50 |
| Messaggi/mese | ~90 | ~600 | ~1.500 |
| Contatti salvati | 5 | 50 | Illimitati |
| AI parsing (Groq) | Incluso | Incluso | Incluso + rewrite |
| Retry automatico | 1x | 3x | 3x + notifica errore |
| Cool-down anti-ban | Aggressivo | Moderato | Leggero |
| Supporto | FAQ | Email | WhatsApp prioritario |
| Storico messaggi | 7 giorni | 30 giorni | 90 giorni + export |

### Logica dei tier

- **Free (3/giorno):** sufficiente per uso personale. Crea abitudine e passaparola senza rischio ban. Limite basso = upsell naturale per professionisti.
- **Personal (€4.99):** un medico che manda 5-10 promemoria/giorno ci sta comodamente. Meno di un caffè al giorno.
- **Business (€19.99):** un ristorante con 20-30 prenotazioni/giorno copre il caso d'uso. Irrisorio vs Brevo (€19-49) o WATI (€50+).

### Sistema anti-ban (cool-down automatico)

- Max 3 messaggi allo stesso destinatario per 24h (tutti i tier)
- Oltre 10 messaggi in 10 minuti: rallentamento a 1 msg/minuto
- All'80% del limite giornaliero: warning WhatsApp automatico
- Solo contatti salvati via vCard (nessun messaggio a numeri sconosciuti)

### Upsell naturali

- Free → Personal: "Hai raggiunto il limite di 3 messaggi oggi. Passa a Personal per 20/giorno a €4.99/mese"
- Personal → Business: "Hai raggiunto 20 messaggi. Passa a Business per 50/giorno"

### Downgrade al termine trial

- Trial scade → l'utente passa automaticamente a Free (3 msg/giorno)
- Messaggi in coda oltre il limite: messi in pausa, non cancellati
- Notifica WhatsApp: "Il tuo trial è scaduto. I tuoi messaggi sono in pausa. Passa a Personal per €4.99/mese."
- Nessuna carta richiesta per continuare con il piano Free

### Piano White Label (futuro — dopo 200+ utenti)

- €99/mese per agenzie: branding proprio, gestione multi-cliente, dashboard admin
- Da valutare solo dopo validazione del modello B2C diretto

---

## 3. Go-to-Market — Primi 100 Utenti Paganti

### Fase 1: Validazione e primi 20 utenti (Mese 1-2) — Budget €0

**Canale #1 — Outreach diretto (WhatsApp e di persona)**
- Contattare 100+ professionisti locali: medici, dentisti, personal trainer, estetiste, parrucchieri, ristoratori
- Messaggio: "Ho creato un servizio che ti permette di mandare promemoria appuntamenti ai clienti dal tuo WhatsApp, senza installare nulla. Ti faccio vedere come funziona in 2 minuti?"
- Setup gratuito + 30 giorni trial esteso
- Target: 10-20 utenti attivi
- Il prodotto si demo da solo — il setup è veramente 2 minuti

**Canale #2 — Gruppi Facebook di settore**
- Gruppi: "Medici e dentisti italiani", "Parrucchieri Italia", "Ristoratori italiani", "Professionisti e Partite IVA", "Personal Trainer Italia", "Estetiste e centri estetici"
- Post non-spam: racconta il problema, offri la soluzione
- Target: 5-10 utenti

**Canale #3 — LinkedIn per professionisti**
- Post in italiano: "Come ridurre i no-show del 40% con un promemoria WhatsApp automatico"
- Target: 5-10 utenti

### Fase 2: Scaling a 100 utenti (Mese 3-4) — Budget €100-300/mese

**Canale #4 — SEO Landing page italiana**
- Keyword ad alta conversione e bassa concorrenza:
  - "programmare messaggi WhatsApp" (~1.5K ricerche/mese)
  - "schedulare messaggi WhatsApp" (~500/mese)
  - "promemoria WhatsApp automatici" (~300/mese)
  - "inviare messaggi WhatsApp programmati" (~800/mese)
- Ottimizzare landing page: meta tag, H1/H2 targettizzati, schema markup, sitemap
- Blog: 5-10 articoli SEO ("Come ridurre i no-show con WhatsApp", "Alternative gratuite a WATI")
- Timeline: 3-6 mesi per risultati organici, costo €0

**Canale #5 — TikTok/Instagram Reels**
- Video 30-60s: setup in tempo reale, QR code, messaggio programmato
- Base: contenuto esistente su /tutorial
- Budget: €0 organico → €100-200/mese boost video migliori
- Il prodotto è visivamente impressionante per i social

**Canale #6 — Referral program**
- "Invita un collega → entrambi avete 1 mese gratis"
- Professionisti parlano con altri professionisti — passaparola in studi e saloni
- Implementazione: link con codice referral tracciato in DB
- Da implementare subito, non dopo il lancio

### Canali da evitare

- Google Ads su keyword WhatsApp — CPC €2-5, brucia budget senza ROI a questi volumi
- Cold email — bassa conversione, rischio spam
- ProductHunt — audience internazionale, prodotto italiano

### Metriche target

| Mese | Utenti Free | Utenti Paganti | MRR |
|------|------------|----------------|-----|
| 1 | 20 | 5 | €40 |
| 2 | 50 | 15 | €115 |
| 3 | 100 | 30 | €230 |
| 4 | 200 | 60 | €470 |
| 6 | 500 | 100 | €800+ |

---

## 4. Rischi e Mitigazioni

### Matrice rischi

| Rischio | Probabilità | Impatto | Priorità |
|---------|------------|---------|----------|
| WhatsApp ban utenti | Media | Catastrofico | Pre-lancio |
| Evolution API si rompe | Media | Critico | Monitoraggio continuo |
| GDPR non-compliance | Certa | Alto | Pre-lancio paganti |
| API non ufficiali (legale) | Bassa | Alto | ToS + comunicazione |
| Infrastruttura SPOF | Media | Alto | Pre-100 utenti |
| Stripe non attivo | Certa | Bloccante | Pre-lancio paganti |

### Rischio 1 — WhatsApp Ban (CRITICO)

L'utente connette il proprio numero personale. Un uso eccessivo può portare a restrizioni o ban da parte di WhatsApp. Questo è il rischio reputazionale più grave.

**Mitigazioni in produzione:**
- Rate limit: 15 msg/min, 100/giorno per utente
- Retry max 3x poi stop
- Jitter 200-400ms tra invii

**Mitigazioni da implementare:**
- Cool-down per destinatario: max 3 msg stesso numero in 24h
- Disclaimer all'onboarding: "WhatsLater invia messaggi dal tuo numero personale. Un uso eccessivo può comportare restrizioni da WhatsApp. Consigliamo max 20-30 messaggi mirati al giorno."
- ToS: l'utente è responsabile del proprio utilizzo
- Alert automatico se un utente supera 50 msg/giorno per 3 giorni consecutivi

### Rischio 2 — Evolution API / Baileys (CRITICO)

WhatsLater si connette tramite la funzionalità "Dispositivi collegati" di WhatsApp. Meta aggiorna regolarmente il protocollo e potrebbe rompere la compatibilità.

**Mitigazioni:**
- Monitorare il repo GitHub di Evolution API per breaking changes
- Aggiornare Evolution API tempestivamente
- Piano B a lungo termine: WhatsApp Cloud API (ufficiale) per il tier Business
- Non promettere "100% uptime" — comunicare "best effort" con supporto rapido

### Rischio 3 — GDPR e Compliance Italia (BLOCCANTE)

Obbligatorio prima del lancio con utenti paganti.

**Necessario:**
1. **Privacy Policy** (/privacy): dati raccolti, base giuridica, data processor (Supabase EU, Vercel, Stripe), periodo conservazione (90 giorni dopo invio), diritti utente
2. **ToS** (/terms): responsabilità utente sui contenuti, disclaimer ban, non affiliazione a Meta, diritto di sospensione per abuso
3. **Cookie banner informativo**: solo cookie tecnici (localStorage), nessun tracking
4. **Endpoint cancellazione dati**: "Cancella tutti i miei dati" come richiesto da GDPR
5. **DPA** con Supabase e Vercel (offrono DPA standard)

### Rischio 4 — Uso API non ufficiali (MEDIO)

WhatsApp ToS vietano client non ufficiali. In pratica Meta preferisce bloccare tecnicamente piuttosto che fare causa.

**Mitigazioni:**
- Non menzionare MAI "API non ufficiale" nel marketing o documentazione pubblica
- Posizionarsi come "servizio di scheduling", non "WhatsApp automation"
- ToS: "WhatsLater si connette tramite la funzionalità Dispositivi collegati di WhatsApp"
- Piano migrazione a WhatsApp Cloud API per tier Business a lungo termine

### Rischio 5 — Single Point of Failure (MEDIO)

Un VPS, un'istanza Evolution API, un database.

**Mitigazioni breve termine (pre-100 utenti):**
- Health check ogni 5 minuti con alert
- Backup settimanale DB
- Procedura di recovery documentata

**Mitigazioni medio termine (100+ utenti):**
- Supabase Pro ($25/mese)
- Secondo VPS cold standby (~$6/mese)
- Vercel Pro ($20/mese) per limiti superiori

### Rischio 6 — Stripe non attivo (BLOCCANTE)

Stripe è integrato nel codice ma non configurato. Nessun prodotto o prezzo creato.

**Azioni:**
1. Creare account Stripe con dati P.IVA
2. Creare prodotti Personal (€4.99) e Business (€19.99)
3. Configurare price ID nel codice
4. Testare flusso completo in modalità test
5. Attivare modalità live + webhook

---

## 5. Scalabilità Tecnica e Roadmap

### Architettura attuale e limiti

| Componente | Piano attuale | Limite critico | Si rompe a |
|-----------|--------------|----------------|------------|
| Vercel Hobby | $0 | 100K req/mese, 10s timeout | ~50-100 utenti |
| Supabase Free | $0 | 500MB DB, 50K auth req/mese | ~100-200 utenti |
| VPS DigitalOcean | ~$6-12/mese | ~100-150MB RAM per istanza | ~30-50 istanze |
| Groq Free | $0 | 30 req/min, 14.4K req/giorno | ~200 msg AI/giorno |
| Cron (cron-job.org) | $0 | Affidabilità esterna | Qualsiasi momento |

### Upgrade path per milestone

**Pre-lancio (0-20 utenti) — ~€12/mese**
- Nessun upgrade necessario
- Focus: Stripe, Privacy Policy, ToS, cool-down

**20-100 utenti — ~€55/mese**
- Supabase Pro ($25/mese)
- VPS 4GB RAM ($24/mese): ~25-30 istanze
- Break-even: 12 utenti Personal

**100-500 utenti — ~€120/mese**
- VPS 8GB RAM ($48/mese): ~50-60 istanze
- Secondo VPS standby ($12/mese)
- Vercel Pro ($20/mese)
- Break-even: 25 utenti Personal o 7 Business

**500-1000 utenti — ~€250-400/mese**
- 2-3 VPS con load balancing
- Supabase Pro con compute add-on
- Coda messaggi dedicata per gestire picchi
- Monitoring dedicato

### Roadmap tecnica e di business

#### FASE 0 — Pre-lancio (2-3 settimane)

| # | Task | Priorità | Effort |
|---|------|----------|--------|
| 0.1 | Attivare Stripe: prodotti, price ID, checkout, webhook | Bloccante | 2-3 giorni |
| 0.2 | Implementare tier Free/Personal/Business con limiti | Bloccante | 2-3 giorni |
| 0.3 | Downgrade automatico trial → Free | Bloccante | 1-2 giorni |
| 0.4 | Privacy Policy + ToS in italiano (/privacy, /terms) | Bloccante | 1 giorno |
| 0.5 | Cool-down per destinatario (max 3 msg stesso numero/24h) | Bloccante | 1 giorno |
| 0.6 | Disclaimer onboarding + checkbox accettazione ToS | Alto | 0.5 giorni |
| 0.7 | Referral system (link codice, 30 giorni gratis entrambi) | Alto | 2 giorni |
| 0.8 | SEO landing page (meta tag, H1/H2, schema, sitemap) | Medio | 1 giorno |

#### FASE 1 — Lancio e primi 100 utenti (Mese 1-3)

| # | Task | Priorità | Effort |
|---|------|----------|--------|
| 1.1 | Outreach diretto: 100+ professionisti locali | Alto | Continuo |
| 1.2 | 5 video TikTok/Reels demo prodotto | Alto | 1 settimana |
| 1.3 | Post su 10+ gruppi Facebook di settore | Medio | 1 settimana |
| 1.4 | LinkedIn: 3 post su riduzione no-show | Medio | 3 giorni |
| 1.5 | Blog SEO: 5 articoli targettizzati | Medio | 2 settimane |
| 1.6 | Upgrade Supabase a Pro | A ~50 utenti | 1 ora |
| 1.7 | Upgrade VPS a 4GB RAM | A ~30 istanze | 1 ora |
| 1.8 | Endpoint cancellazione dati GDPR | Alto | 1 giorno |

#### FASE 2 — Crescita a 500 utenti (Mese 4-8)

| # | Task | Priorità | Effort |
|---|------|----------|--------|
| 2.1 | Dashboard: modifica messaggi, calendario, filtri | Alto | 1-2 settimane |
| 2.2 | Piano Free pubblico per crescita virale | Alto | 2-3 giorni |
| 2.3 | Notifiche email (conferma scheduling, report) | Medio | 1 settimana |
| 2.4 | Multi-lingua (inglese) | Medio | 1 settimana |
| 2.5 | Secondo VPS standby + monitoring | Medio | 1 giorno |
| 2.6 | Vercel Pro upgrade | A limiti Hobby | 1 ora |
| 2.7 | Messaggi ricorrenti ("ogni lunedì alle 9...") | Alto | 1 settimana |

#### FASE 3 — Scaling 1000+ utenti (Mese 9-12)

| # | Task | Priorità | Effort |
|---|------|----------|--------|
| 3.1 | Piano White Label per agenzie (€99/mese) | Alto | 3-4 settimane |
| 3.2 | API pubblica per integrazioni | Medio | 2-3 settimane |
| 3.3 | WhatsApp Cloud API per tier Business | Medio | 2-3 settimane |
| 3.4 | Load balancing multi-VPS | Alto | 1 settimana |
| 3.5 | Analytics dashboard (tasso successo, no-show) | Alto | 2 settimane |

### Stima costi vs revenue

| Milestone | Costo/mese | Utenti paganti | MRR | Margine |
|-----------|-----------|----------------|-----|---------|
| Pre-lancio | €12 | 0 | €0 | -€12 |
| 50 utenti | €50 | 20 | €150 | +€100 |
| 100 utenti | €55 | 40 | €320 | +€265 |
| 500 utenti | €120 | 150 | €1.200 | +€1.080 |
| 1.000 utenti | €350 | 350 | €3.000 | +€2.650 |

Ipotesi: 30-35% utenti attivi paganti, mix 70% Personal / 30% Business.

---

## 6. Prossimi 30 Giorni

Azioni concrete in ordine di priorità per il lancio.

### Settimana 1 — Billing e Legal (BLOCCANTI)

- [ ] **Giorno 1-2:** Creare account Stripe, configurare prodotti Personal (€4.99) e Business (€19.99), testare checkout in modalità test
- [ ] **Giorno 2-3:** Implementare tier system nel codice — limiti messaggi/giorno per piano Free (3), Personal (20), Business (50)
- [ ] **Giorno 3-4:** Implementare downgrade automatico: trial scade → piano Free, messaggi in pausa, notifica WhatsApp
- [ ] **Giorno 4-5:** Scrivere e pubblicare Privacy Policy (/privacy) e Termini di Servizio (/terms) in italiano

### Settimana 2 — Anti-ban e Onboarding

- [ ] **Giorno 6:** Cool-down per destinatario: max 3 messaggi allo stesso numero in 24h
- [ ] **Giorno 7:** Disclaimer onboarding con checkbox accettazione ToS
- [ ] **Giorno 8-9:** Referral system: generazione link, tracking in DB, 30 giorni gratis per chi invita e chi viene invitato
- [ ] **Giorno 10:** Attivare Stripe in modalità live, testare flusso completo end-to-end

### Settimana 3 — SEO e Contenuti

- [ ] **Giorno 11:** Ottimizzare landing page SEO: meta tag, H1/H2, Open Graph, schema markup, sitemap.xml
- [ ] **Giorno 12-13:** Scrivere 2 articoli blog SEO: "Come ridurre i no-show con WhatsApp" e "Alternative gratuite a WATI per piccole imprese"
- [ ] **Giorno 14-15:** Creare 2 video TikTok/Reels: demo setup 30 secondi, demo scheduling completo 60 secondi (base: contenuto /tutorial)

### Settimana 4 — Outreach e Primi Utenti

- [ ] **Giorno 16-20:** Contattare 50 professionisti locali: medici, dentisti, personal trainer, estetiste, parrucchieri
- [ ] **Giorno 21-23:** Postare su 5 gruppi Facebook di settore
- [ ] **Giorno 24-25:** Pubblicare 2 post LinkedIn su riduzione no-show
- [ ] **Giorno 26-28:** Raccogliere feedback dai primi utenti, iterare su UX
- [ ] **Giorno 29-30:** Primo report: utenti attivi, conversione trial → pagante, messaggi inviati, problemi segnalati

### Obiettivo fine mese 1

- 20+ utenti attivi (mix free e trial)
- 5+ utenti paganti
- €40+ MRR
- Zero problemi di ban WhatsApp
- Privacy Policy e ToS pubblicati
- Stripe attivo e funzionante

---

*Documento generato il 17 Marzo 2026. Da aggiornare mensilmente con metriche reali.*
