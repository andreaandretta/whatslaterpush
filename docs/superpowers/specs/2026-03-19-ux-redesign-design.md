# WhatsLater — UX Redesign per Professionisti

**Data:** 19 Marzo 2026
**Obiettivo:** Rendere WhatsLater comprensibile e usabile da un professionista 55enne (dentista, parrucchiere, estetista) senza aiuto esterno.
**Principio guida:** "Premium per un professionista = chiarezza e affidabilita, non animazioni."

---

## 1. Hero Section (Landing Page)

### Decisione: Headline basata su risultato + urgenza emotiva (C+D)

**Prima:**
- Headline: "Scrivi Ora. Invia Dopo."
- Sub: "Programma i messaggi WhatsApp semplicemente chattando a te stesso. Nessuna complicazione. A partire da €1.99/mese."
- CTA: "Connetti WhatsApp"

**Dopo:**
- Headline: "I tuoi clienti non dimenticano piu l'appuntamento."
- Sub: "Il promemoria parte da WhatsApp, dal tuo numero, in automatico."
- Sotto il sub: "Setup in 2 minuti · Nessuna app da installare"
- CTA: "Prova gratis 7 giorni" (bottone primario)
- Sotto CTA: "Nessuna carta richiesta" (testo piccolo, trust signal)

### Motivazione
Il meccanismo tecnico ("scrivi a te stesso") non appare nel hero. Il hero vende il RISULTATO (clienti che non dimenticano) e il BENEFICIO (dal tuo numero, in automatico). Il "come" viene spiegato nella sezione "Come Funziona".

---

## 2. Semplificazione Design Visivo

### 2.1 Font: da 4 a 2

**Eliminati:**
- Playfair Display (serif per accenti italici)
- JetBrains Mono (monospace per codice)

**Mantenuti:**
- Inter — body text, tutto il contenuto
- Space Grotesk — solo titoli principali (h1, h2)

### 2.2 Animazioni: semplificazione radicale

**Eliminate:**
- Bubbles fluttuanti nel hero
- Parallax scroll su testi
- Text morphing nelle feature card (GSAP TextPlugin)
- Scroll-pinning sulle card "Come Funziona" (ScrollTrigger pin)

**Mantenute:**
- Fade-in on-scroll: `opacity: 0 → 1`, `translateY: 20px → 0`, `duration: 400ms`
- Animazione telefono nel hero (semplificata se necessario)

**Criterio:** la pagina deve sembrare veloce e solida su un Android medio.

### 2.3 Sezione Filosofia: eliminata

**Prima:** Sezione full-screen dark con "Dimenticare costa caro. Essere presenti non ha prezzo."

**Dopo:** Sostituita con una barra di 3 numeri concreti:
- "2 minuti per iniziare"
- "0 app da installare"
- "100% dal tuo numero WhatsApp"

### 2.4 Sezione "Come Funziona": da 4 step con scroll-pin a 3 step semplici

**Prima:** 4 card con scroll-pinning, animazioni complesse, 2 colonne per card.

**Dopo:** 3 step semplici, icone grandi, testo cortissimo, nessun scroll-pinning:
1. **Connetti WhatsApp** (30 secondi) — icona: link/catena
2. **Scrivi il messaggio e l'orario** — icona: messaggio/orologio
3. **Il tuo cliente riceve il promemoria** — icona: check/campanella

### 2.5 Mobile First

- Ogni sezione testata su viewport 390px (iPhone 14)
- Bottoni: minimum 48px height
- Testo body: minimum 16px
- Touch target minimi: 44x44px

---

## 3. Onboarding: Approccio Ibrido

### 3.1 Flusso connessione

**Default: Pairing code** (no scelta QR/pairing code — il pairing code e piu semplice da spiegare).

Link secondario: "Preferisci inquadrare un codice? Clicca qui" per utenti tech che preferiscono QR.

### 3.2 Screenshot inline

Mostrare screenshot di WhatsApp per guidare l'utente a "Dispositivi collegati":
- **Android:** tre puntini > Dispositivi collegati > Collega un dispositivo
- **iPhone:** Impostazioni > Dispositivi collegati > Collega un dispositivo

Rilevamento automatico piattaforma (`navigator.userAgent`) per mostrare lo screenshot giusto di default, con toggle "Usi iPhone/Android?" per cambiare manualmente.

### 3.3 Messaggio di benvenuto WhatsApp (dopo connessione)

Il bot invia automaticamente:

```
Benvenuto su WhatsLater! 🎉

Ecco come mandare il tuo primo promemoria in 2 passi:

1️⃣ Inviami il contatto di un tuo cliente (premi 📎 → Contatto)
2️⃣ Poi scrivi: "Ricorda a [nome] l'appuntamento di domani alle 15"

Il messaggio partira automaticamente all'orario che scegli! 📲

Hai bisogno di aiuto? Scrivi AIUTO
```

Questo sostituisce l'attuale onboarding modal nella dashboard (il messaggio WhatsApp e piu naturale per il target).

### 3.4 Disclaimer (invariato, inviato prima del benvenuto)

Il messaggio disclaimer su "Dispositivi Collegati" e uso responsabile resta invariato — e un requisito legale.

---

## 4. Dashboard: Lista Intelligente

### 4.1 Banner contestuale (in alto, uno alla volta, priorita decrescente)

| Condizione | Banner |
|-----------|--------|
| Limite giornaliero raggiunto | "⚠️ Hai usato 3/3 messaggi oggi — riparte domani o passa a Personal" |
| Trial attivo | "🎯 Trial: X giorni rimasti — Passa a Personal per continuare" |
| WhatsApp disconnesso | "🔴 WhatsApp scollegato — ricollegati per inviare i promemoria" |
| Tutto ok | Nessun banner (silenzio = tutto funziona) |

### 4.2 Lista messaggi — ogni riga

- **Nome contatto** — font grande, leggibile (16px bold)
- **Testo messaggio** — troncato a 50 caratteri, colore secondario
- **Countdown visivo** — "tra 2 ore" / "domani alle 15" / "fra 3 giorni" (colore primario)
- **Stato con colore:**
  - 🟡 In attesa di conferma
  - 🔵 Programmato (confermato, in attesa di invio)
  - 🟢 Inviato
  - 🔴 Non inviato — clicca per riprovare
  - ⚪ Annullato
- **Tasto "Annulla invio"** — icona cestino, richiede conferma

### 4.3 Istruzioni contestuali

- **Visibili** nei primi 7 giorni OPPURE se l'utente non ha ancora schedulato nessun messaggio
- **Dopo:** nascoste dietro un piccolo "?" in basso a destra (FAB)
- Contenuto: stesse istruzioni del messaggio di benvenuto WhatsApp

### 4.4 Mobile First

- Tutta la dashboard funziona con il pollice su 6 pollici
- Bottoni grandi (48px+), testo leggibile senza zoom
- Swipe-to-delete opzionale (ma non necessario per MVP)

---

## 5. Micro-copy Completo

### 5.1 Regole

1. **Zero gergo tecnico** — niente "vCard", "QR code" diventa "codice da inquadrare", niente "connessione", "generare"
2. **Ogni errore dice cosa fare** — azione chiara, mai codici HTTP o errori database
3. **Ogni bottone dice il risultato** — "Attiva i promemoria" non "Connetti WhatsApp"
4. **Sempre "tu" informale e presente** — "il messaggio parte alle 15:00" non "verra inviato"

### 5.2 Testi da cambiare

| Dove | Prima | Dopo |
|------|-------|------|
| Hero CTA | "Connetti WhatsApp" | "Attiva i promemoria gratis" |
| Dashboard titolo connessione | "Inserisci il tuo numero per generare il codice di collegamento" | "Collega il tuo WhatsApp in 30 secondi" |
| QR code istruzioni | "Scansiona il QR code con WhatsApp" | "Inquadra questo codice con WhatsApp" |
| Stato connessione | "In attesa di connessione..." | "Apri WhatsApp sul telefono e inserisci il codice" |
| Messaggi vuoti | "Nessun messaggio. Invia una vCard a 'Te Stesso' su WhatsApp!" | "Nessun promemoria programmato. Apri WhatsApp e invia il primo!" |
| Bottone piano | "Gestisci abbonamento" | "Cambia piano" |
| Bottone cancella | "Elimina" | "Annulla invio" |
| Metadata titolo | "SchedWhats - Scrivi Ora. Invia Dopo." | "WhatsLater - Promemoria WhatsApp automatici" |
| Metadata descrizione | "Schedula messaggi WhatsApp dal telefono. Nessun QR Code. Nessuna complicazione." | "I tuoi clienti non dimenticano piu l'appuntamento. Promemoria automatici da WhatsApp, dal tuo numero." |

### 5.3 Messaggi di errore

| Situazione | Messaggio |
|-----------|----------|
| Errore generico (500, DB, API) | "Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app" |
| Connessione scaduta | "Il collegamento e scaduto. Clicca qui per ricollegarti — ci vogliono 30 secondi" |
| Messaggio fallito (dashboard) | "Non inviato — clicca per riprovare" |
| Limite giornaliero | "Hai usato tutti i messaggi di oggi. Riparte domani o passa a Personal per 20 al giorno" |
| Limite contatti | "Hai raggiunto il massimo di contatti per il tuo piano. Passa a Personal per salvarne fino a 50" |
| Numero non valido | "Questo numero non sembra corretto. Controlla e riprova" |
| WhatsApp disconnesso | "WhatsApp si e scollegato. Ricollegati dalla dashboard — ci vogliono 30 secondi" |

### 5.4 Messaggio di benvenuto WhatsApp (post-connessione)

```
Benvenuto su WhatsLater! 🎉

Ecco come mandare il tuo primo promemoria in 2 passi:

1️⃣ Inviami il contatto di un tuo cliente (premi 📎 → Contatto)
2️⃣ Poi scrivi: "Ricorda a [nome] l'appuntamento di domani alle 15"

Il messaggio partira automaticamente all'orario che scegli! 📲

Hai bisogno di aiuto? Scrivi AIUTO
```

### 5.5 Disclaimer WhatsApp (inviato prima del benvenuto, invariato)

```
⚠️ Importante: WhatsLater usa la funzione "Dispositivi Collegati" di WhatsApp.
Un uso responsabile protegge il tuo numero.

• Max 20-30 messaggi mirati al giorno
• Solo a contatti che ti conoscono
• Nessun invio massivo o spam

Leggi i termini completi: https://whatslaterpush.vercel.app/terms

WhatsLater non e affiliato a Meta/WhatsApp.
```

---

## 6. Sezioni Landing Page (ordine finale)

1. **Navbar** — logo + "Come Funziona" / "Prezzi" / "FAQ" + CTA "Attiva i promemoria gratis"
2. **Hero** — headline C+D + CTA + animazione telefono
3. **Numeri** — "2 minuti per iniziare — 0 app da installare — 100% dal tuo numero WhatsApp"
4. **Come Funziona** — 3 step semplici con icone
5. **Pricing** — 3 tier (Free / Personal / Business) con CTA
6. **FAQ** — 5 domande frequenti (accordion)
7. **Footer** — link legali, status, "Made in Italy"

Sezione Features (3 card animate) e sezione Philosophy: **eliminate**.

---

## 7. Fuori scope (non in questo redesign)

- C1: Autenticazione reale dashboard (progetto separato)
- Stripe live mode (dipende da verifica account)
- Localizzazione multilingua
- Video tutorial embeddato (valutare dopo il lancio beta)
- Dark mode
