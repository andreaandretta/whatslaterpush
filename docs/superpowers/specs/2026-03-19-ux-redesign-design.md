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
- CTA: nessun bottone CTA nel hero attuale (solo headline + sub + phone mockup)

**Dopo:**
- Headline: "I tuoi clienti non dimenticano piu l'appuntamento."
- Sub: "Il promemoria parte da WhatsApp, dal tuo numero, in automatico."
- Sotto il sub: "Setup in 2 minuti · Nessuna app da installare"
- CTA: "Attiva i promemoria gratis" (bottone primario, `href="/dashboard"`) — aggiungere bottone CTA
- Sotto CTA: "Nessuna carta richiesta" (testo piccolo, trust signal)

**File:** `app/components/HeroSection.tsx`

### Animazione telefono nel hero

L'animazione telefono attuale (timeline GSAP con lock screen → home → chats → message flow) viene **semplificata**: sostituire la timeline GSAP complessa con una sequenza CSS di 3 frame statici che mostrano:
1. Schermata chat WhatsApp con messaggio in arrivo
2. Messaggio "Ricorda appuntamento domani alle 15" visibile
3. Check verde "Inviato"

Implementazione: CSS `@keyframes` definiti in `app/globals.css` (dove gia esistono `fadeIn` e `slideUp`). Durata totale: 6s, loop infinito. Ogni frame visibile ~2s con crossfade 300ms. La struttura HTML del phone mockup viene ridotta a un container con 3 div frame, ciascuno con `animation-delay` progressivo. Rimuovere tutti i div lock/home/chats/inside-chat del mockup attuale.

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

**Modifiche tecniche:**
- `app/layout.tsx`: rimuovere gli import `Playfair_Display` e `JetBrains_Mono`, rimuovere le relative variabili CSS (`--font-playfair`, `--font-jetbrains-mono`) dal `<body>` className
- `tailwind.config.ts`: rimuovere `serif: ['var(--font-playfair)', 'serif']` e `mono: ['var(--font-jetbrains-mono)', 'monospace']` da `fontFamily`
- Cercare nel codebase ogni uso di `font-serif`, `font-mono`, `font-playfair`, `font-jetbrains` e sostituire con `font-sans` o `font-heading`

### 2.2 Animazioni: semplificazione radicale

**Eliminate:**
- Bubbles fluttuanti nel hero (`HeroSection.tsx`)
- Parallax scroll su testi (`PhilosophySection.tsx`)
- Text morphing nelle feature card — GSAP TextPlugin (`FeaturesSection.tsx`)
- Scroll-pinning sulle card "Come Funziona" — ScrollTrigger pin (`HowItWorksSection.tsx`)

**Mantenute:**
- Fade-in on-scroll: `opacity: 0 → 1`, `translateY: 20px → 0`, `duration: 400ms` — implementato con CSS `@keyframes` + `IntersectionObserver`, non GSAP. Keyframes in `app/globals.css` (riutilizzare `fadeIn`/`slideUp` gia definiti in `tailwind.config.ts` `keyframes`).
- Navbar scroll detection (`Navbar.tsx`): mantenere il comportamento `.nav-scrolled` ma reimplementare con vanilla `window.addEventListener('scroll', ...)` + `scrollY > 50` check invece di GSAP ScrollTrigger

**GSAP cleanup:**
- Dopo la migrazione a CSS animations, rimuovere `gsap` e `@gsap/react` da `package.json`
- Rimuovere tutti gli import `gsap`, `ScrollTrigger`, `TextPlugin` dai componenti
- Eseguire `npm install` dopo la rimozione per aggiornare il lockfile

**Criterio:** la pagina deve sembrare veloce e solida su un Android medio.

### 2.3 Noise overlay: rimosso

L'overlay SVG noise in `app/layout.tsx` (div con `opacity-[0.03]` e `mix-blend-overlay`) viene rimosso. Non aggiunge valore percepibile per il target e impatta il rendering su dispositivi lenti.

### 2.4 Sezione Filosofia: eliminata, sostituita con barra "Numeri"

**Prima:** Sezione full-screen dark con "Dimenticare costa caro. Essere presenti non ha prezzo." (`PhilosophySection.tsx`)

**Dopo:** `PhilosophySection.tsx` viene rinominato/riscritto come `StatsBar.tsx` — una barra orizzontale con 3 numeri concreti:
- "2 minuti per iniziare"
- "0 app da installare"
- "100% dal tuo numero WhatsApp"

**Layout:** flexbox row su desktop (3 colonne uguali, divisi da bordi verticali `border-r border-white/20`), stack verticale su mobile (`flex-col` sotto `sm:` breakpoint, 640px). Background `bg-[#111B21]` (colore `text-primary` dal tema — il dark background di WhatsApp), testo bianco, numeri grandi (`text-3xl font-bold`), label sotto (`text-sm text-white/70`).

### 2.5 Sezione Features: eliminata

`FeaturesSection.tsx` viene eliminato (file cancellato). Le 3 feature card animate con GSAP TextPlugin non servono — il valore si comunica gia nel hero + Come Funziona.

**File:** rimuovere `FeaturesSection` dall'import e dal JSX in `app/page.tsx`.

### 2.6 Sezione `#connetti`: eliminata

La sezione mid-page `<section id="connetti">` in `app/page.tsx` ("Pronto a iniziare?" con CTA "Connetti WhatsApp") viene rimossa.

**Riferimenti da aggiornare:**
- `Navbar.tsx` (linea ~34): l'attuale CTA "Connetti Ora" con `href="#connetti"` → cambiare href a `/dashboard`
- `PricingSection.tsx` (linea ~12): `window.location.href = '#connetti'` fallback → cambiare a `window.location.href = '/dashboard'`
- Verificare `Footer.tsx` per eventuali link a `#connetti`

### 2.7 Sezione "Come Funziona": da 4 step con scroll-pin a 3 step semplici

**Prima:** 3 card visibili + 1 step implicito ("Rilassati") con scroll-pinning e animazioni GSAP (`HowItWorksSection.tsx`).

**Dopo:** Riscrivere completamente il contenuto e il layout. 3 step semplici, icone grandi (SVG inline o Lucide icons, 48px), testo cortissimo, nessun scroll-pinning:
1. **Connetti WhatsApp** (30 secondi) — icona: link/catena — "Collega il tuo numero in 30 secondi"
2. **Scrivi il messaggio e l'orario** — icona: messaggio/orologio — "Manda un messaggio a te stesso con il testo e l'ora"
3. **Il tuo cliente riceve il promemoria** — icona: check/campanella — "Il messaggio parte in automatico, dal tuo numero"

**Layout:** `grid grid-cols-1 sm:grid-cols-3 gap-8` su desktop, stack verticale su mobile. Fade-in on-scroll con CSS (classe `.fade-in-up` + IntersectionObserver).

**File:** riscrivere `HowItWorksSection.tsx`, rimuovere tutto GSAP.

### 2.8 Mobile First

- Ogni sezione testata su viewport 390px (iPhone 14)
- Bottoni: minimum `h-12` (48px height)
- Testo body: minimum `text-base` (16px)
- Touch target minimi: 44x44px

---

## 3. Onboarding: Approccio Ibrido

### 3.1 Flusso connessione

**Default: Pairing code** (no scelta QR/pairing code — il pairing code e piu semplice da spiegare).

Link secondario: "Preferisci inquadrare un codice? Clicca qui" per utenti tech che preferiscono QR.

**File:** `app/dashboard/page.tsx` — la sezione connessione mostra il pairing code come default.

### 3.2 Screenshot inline

Mostrare istruzioni visive per guidare l'utente a "Dispositivi collegati":
- **Android:** tre puntini > Dispositivi collegati > Collega un dispositivo
- **iPhone:** Impostazioni > Dispositivi collegati > Collega un dispositivo

Implementazione: **illustrazioni SVG inline** (non screenshot reali — evita problemi di copyright e risoluzioni). Icone stilizzate che mostrano i 3 tap necessari. Rilevamento automatico piattaforma (`navigator.userAgent`) per mostrare la guida giusta di default, con bottone toggle "Usi iPhone?" / "Usi Android?" per cambiare manualmente.

**File:** `app/dashboard/page.tsx` — aggiungere nella sezione connessione, sopra il pairing code.

### 3.3 Messaggio di benvenuto WhatsApp (dopo connessione)

**File:** `app/api/webhook/route.ts` — nel handler `connection.update`.

Il webhook gia gestisce `connection.update` events. Aggiungere logica: quando `status === 'open'`, controllare se `user_instances.welcome_sent` e `false` (nuovo campo boolean, default `false`). Se non ancora inviato:
1. Inviare disclaimer (sezione 3.5)
2. Inviare messaggio benvenuto (sotto)
3. Aggiornare `user_instances.welcome_sent = true`

Questo previene l'invio ripetuto ad ogni riconnessione.

```
Benvenuto su WhatsLater! 🎉

Ecco come mandare il tuo primo promemoria in 2 passi:

1️⃣ Inviami il contatto di un tuo cliente (premi 📎 → Contatto)
2️⃣ Poi scrivi: "Ricorda a [nome] l'appuntamento di domani alle 15"

Il messaggio partira automaticamente all'orario che scegli! 📲

Hai bisogno di aiuto? Scrivi AIUTO
```

L'invio usa la funzione `notifyOwner(instanceName, ownerPhone, text)` gia esistente in `webhook/route.ts` (che chiama `POST /message/sendText/{instanceName}` su Evolution API).

Questo sostituisce l'attuale onboarding modal nella dashboard. La dashboard non mostrera piu il modal "come funziona" al primo accesso — le istruzioni arrivano direttamente su WhatsApp, dove l'utente le usera.

**DB migration:** aggiungere colonna `welcome_sent BOOLEAN DEFAULT false` alla tabella `user_instances`.

### 3.4 "AIUTO" handler nel webhook

Quando l'utente invia "AIUTO" (case-insensitive) nella self-chat, il webhook risponde con lo stesso messaggio di benvenuto (sezione 3.3).

**File:** `app/api/webhook/route.ts` — aggiungere un check **prima** del parsing AI (prima della chiamata a Groq/OpenAI):
```
if (messageText.trim().toUpperCase() === 'AIUTO') {
  await notifyOwner(instanceName, ownerPhone, WELCOME_MESSAGE);
  return NextResponse.json({ ok: true });
}
```

`notifyOwner` e la funzione gia esistente che chiama `POST {EVOLUTION_API_URL}/message/sendText/{instanceName}` con `{ number, text }`.

### 3.5 Disclaimer (invariato, inviato prima del benvenuto)

Il messaggio disclaimer su "Dispositivi Collegati" e uso responsabile resta invariato — e un requisito legale.

---

## 4. Dashboard: Lista Intelligente

**File principale:** `app/dashboard/page.tsx`

### 4.1 Banner contestuale (in alto, uno alla volta, priorita decrescente)

Aggiungere un componente `DashboardBanner` (inline in `dashboard/page.tsx` o come componente separato) renderizzato sopra la lista messaggi.

| Priorita | Condizione | Come rilevarla | Banner | Stile |
|----------|-----------|----------------|--------|-------|
| 1 | WhatsApp disconnesso | `connectionStatus !== 'open'` (gia disponibile nello state) | "🔴 WhatsApp scollegato — ricollegati per inviare i promemoria" | `bg-red-900/20 border border-red-500/30 rounded-lg p-3` |
| 2 | Limite giornaliero raggiunto | Contare i messaggi con `status='sent'` e `sent_at` di oggi nella lista gia caricata | "⚠️ Hai usato X/Y messaggi oggi — riparte domani o passa a Personal" | `bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3` |
| 3 | Trial attivo | `subscriptionPlan === 'trial'` (gia disponibile nello state) | "🎯 Trial: X giorni rimasti — Passa a Personal per continuare" | `bg-blue-900/20 border border-blue-500/30 rounded-lg p-3` |
| — | Tutto ok | nessuna condizione attiva | Nessun banner | — |

I banner non sono dismissibili — scompaiono solo quando la condizione si risolve. Un solo banner visibile alla volta, quello con priorita piu alta.

### 4.2 Lista messaggi — ogni riga

Aggiornare il componente lista messaggi esistente in `dashboard/page.tsx`. Modificare la mappa `statusColors` (attualmente linee ~318-323) per includere tutti gli stati:

```typescript
const statusConfig: Record<string, { color: string; label: string }> = {
  awaiting_confirm:  { color: '#EAB308', label: 'In attesa di conferma' },
  awaiting_contact:  { color: '#EAB308', label: 'In attesa del contatto' },
  awaiting_datetime: { color: '#EAB308', label: 'In attesa della data' },
  awaiting_message:  { color: '#EAB308', label: 'In attesa del messaggio' },
  pending:           { color: '#3B82F6', label: 'Programmato' },
  sending:           { color: '#3B82F6', label: 'In invio...' },
  sent:              { color: '#22C55E', label: 'Inviato' },
  failed:            { color: '#EF4444', label: 'Non inviato' },
  cancelled:         { color: '#9CA3AF', label: 'Annullato' },
};
```

Ogni riga mostra:
- **Nome contatto** — `text-base font-bold`
- **Testo messaggio** — troncato a 50 caratteri, `text-sm text-gray-400`
- **Countdown visivo** — `text-sm text-whatsapp` (colore primario), calcolato con una funzione `formatCountdown(scheduledAt: string)`:
  - < 1 ora: "tra X minuti" (aggiungere `text-red-400` se < 10 min)
  - < 24 ore: "oggi alle HH:MM"
  - < 48 ore: "domani alle HH:MM"
  - < 7 giorni: nome giorno + "alle HH:MM" (es. "mercoledi alle 15:00")
  - >= 7 giorni: "DD/MM alle HH:MM"

  Sostituisce la funzione `fmt()` attuale (linea ~313) che usa solo `toLocaleString`.
- **Stato** — pallino colorato + label da `statusConfig`
- **Tasto "Annulla invio"** — icona cestino, `confirm('Vuoi annullare questo invio?')`. Visibile solo se `status === 'pending' || status.startsWith('awaiting_')`.

### 4.3 Istruzioni contestuali

- **Visibili** nei primi 7 giorni OPPURE se l'utente non ha ancora schedulato nessun messaggio
- **Dopo:** nascoste dietro un piccolo "?" in basso a destra (`fixed bottom-4 right-4 w-12 h-12 rounded-full bg-whatsapp`)
- Contenuto: stesse istruzioni del messaggio di benvenuto WhatsApp
- Il flag "primi 7 giorni": la dashboard gia carica `user_instances` — usare `created_at` dal record. Confrontare `Date.now() - new Date(createdAt).getTime() < 7 * 24 * 60 * 60 * 1000`.
- Per "nessun messaggio schedulato": controllare se la lista messaggi e vuota.

### 4.4 Bottone "Cambia piano"

Il bottone "Cambia piano" nella dashboard (attualmente "Gestisci abbonamento") apre `/#prezzi` in una nuova tab (`window.open('/#prezzi', '_blank')`). Non c'e un portale Stripe self-service nel redesign — il cambio piano passa dalla landing page CTA → Stripe Checkout.

### 4.5 Mobile First

- Tutta la dashboard funziona con il pollice su 6 pollici
- Bottoni grandi (`h-12`+), testo leggibile senza zoom
- Swipe-to-delete opzionale (ma non necessario per MVP)

---

## 5. Micro-copy Completo

### 5.1 Regole

1. **Zero gergo tecnico** — niente "vCard", "QR code" diventa "codice da inquadrare", niente "connessione", "generare"
2. **Ogni errore dice cosa fare** — azione chiara, mai codici HTTP o errori database
3. **Ogni bottone dice il risultato** — "Attiva i promemoria" non "Connetti WhatsApp"
4. **Sempre "tu" informale e presente** — "il messaggio parte alle 15:00" non "verra inviato"

### 5.2 Testi da cambiare

| Dove | File | Prima | Dopo |
|------|------|-------|------|
| Hero CTA | `HeroSection.tsx` | (nessun CTA attuale) | Aggiungere bottone "Attiva i promemoria gratis" con `href="/dashboard"` |
| Navbar CTA | `Navbar.tsx` | "Connetti Ora" (`href="#connetti"`) | "Attiva i promemoria gratis" (`href="/dashboard"`) |
| Dashboard titolo connessione | `dashboard/page.tsx` | "Inserisci il tuo numero per generare il codice di collegamento" | "Collega il tuo WhatsApp in 30 secondi" |
| QR code istruzioni | `dashboard/page.tsx` | "Scansiona il QR code con WhatsApp" | "Inquadra questo codice con WhatsApp" |
| Stato connessione | `dashboard/page.tsx` | "In attesa di connessione..." | "Apri WhatsApp sul telefono e inserisci il codice 👆" |
| Messaggi vuoti | `dashboard/page.tsx` | "Nessun messaggio. Invia una vCard a 'Te Stesso' su WhatsApp!" | "Nessun promemoria programmato. Apri WhatsApp e invia il primo!" |
| Bottone piano (dashboard) | `dashboard/page.tsx` | "Gestisci abbonamento" | "Cambia piano" |
| Bottone piano (pricing) | `PricingSection.tsx` | "Gestisci abbonamento" (linee ~91, ~115) | "Cambia piano" |
| Bottone cancella | `dashboard/page.tsx` | "Elimina" | "Annulla invio" |
| Pricing CTA fallback | `PricingSection.tsx` | `window.location.href = '#connetti'` (linea ~12) | `window.location.href = '/dashboard'` |
| Footer tagline | `Footer.tsx` | "Scrivi ora, invia dopo." (linea ~12) | "Promemoria WhatsApp automatici, dal tuo numero." |
| Metadata titolo | `layout.tsx` | "SchedWhats - Scrivi Ora. Invia Dopo." | "WhatsLater - Promemoria WhatsApp automatici" |
| Metadata descrizione | `layout.tsx` | "Schedula messaggi WhatsApp dal telefono. Nessun QR Code. Nessuna complicazione." | "I tuoi clienti non dimenticano piu l'appuntamento. Promemoria automatici da WhatsApp, dal tuo numero." |
| Metadata keywords | `layout.tsx` | `['WhatsApp', 'scheduler', 'messaging', 'automation', 'productivity']` | `['WhatsApp', 'promemoria', 'appuntamenti', 'automatici', 'professionisti']` |

### 5.3 FAQ: aggiornamento testi

`FAQSection.tsx` — aggiornare tutti i testi per rispettare le regole micro-copy (sezione 5.1):
- "Devo scansionare un QR Code?" → "Come collego WhatsApp?"
- Rimuovere riferimenti a "QR code", "Row Level Security", "database PostgreSQL", "GPT-4o Mini"
- Riscrivere le risposte in linguaggio semplice, senza gergo tecnico
- Esempio: "I tuoi dati sono protetti con la massima sicurezza" invece di "Usiamo Row Level Security su database PostgreSQL"

### 5.4 Messaggi di errore

| Situazione | Messaggio |
|-----------|----------|
| Errore generico (500, DB, API) | "Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app" |
| Connessione scaduta | "Il collegamento e scaduto. Clicca qui per ricollegarti — ci vogliono 30 secondi" |
| Messaggio fallito (dashboard) | "Non inviato — clicca per riprovare" |
| Limite giornaliero | "Hai usato tutti i messaggi di oggi. Riparte domani o passa a Personal per 20 al giorno" |
| Limite contatti | "Hai raggiunto il massimo di contatti per il tuo piano. Passa a Personal per salvarne fino a 50" |
| Numero non valido | "Questo numero non sembra corretto. Controlla e riprova" |
| WhatsApp disconnesso | "WhatsApp si e scollegato. Ricollegati dalla dashboard — ci vogliono 30 secondi" |

**Nota:** l'indirizzo `supporto@whatslaterpush.vercel.app` e un indirizzo Vercel — verificare che sia configurato per ricevere email, altrimenti sostituire con un indirizzo reale prima del lancio.

### 5.5 Messaggio di benvenuto WhatsApp (post-connessione)

```
Benvenuto su WhatsLater! 🎉

Ecco come mandare il tuo primo promemoria in 2 passi:

1️⃣ Inviami il contatto di un tuo cliente (premi 📎 → Contatto)
2️⃣ Poi scrivi: "Ricorda a [nome] l'appuntamento di domani alle 15"

Il messaggio partira automaticamente all'orario che scegli! 📲

Hai bisogno di aiuto? Scrivi AIUTO
```

### 5.6 Disclaimer WhatsApp (inviato prima del benvenuto, invariato)

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

| # | Sezione | Componente | Anchor |
|---|---------|-----------|--------|
| 1 | Navbar | `Navbar.tsx` | — |
| 2 | Hero | `HeroSection.tsx` | — |
| 3 | Numeri | `StatsBar.tsx` (nuovo, sostituisce `PhilosophySection.tsx`) | — |
| 4 | Come Funziona | `HowItWorksSection.tsx` (riscritto) | `#come-funziona` |
| 5 | Pricing | `PricingSection.tsx` | `#prezzi` |
| 6 | FAQ | `FAQSection.tsx` | `#faq` |
| 7 | Footer | `Footer.tsx` | — |

**Navbar links:** "Come Funziona" → `#come-funziona`, "Prezzi" → `#prezzi`, "FAQ" → `#faq`, CTA → `/dashboard`

**Sezioni eliminate:**
- `FeaturesSection.tsx` — file cancellato
- `PhilosophySection.tsx` — file rinominato/riscritto come `StatsBar.tsx`
- Sezione `#connetti` inline in `page.tsx` — codice rimosso

**File `app/page.tsx`:** aggiornare imports e ordine JSX per riflettere la nuova struttura.

---

## 7. Tutorial page

La pagina `app/tutorial/page.tsx` viene mantenuta ma aggiornata:
- Rimuovere le animazioni CSS custom (keyframes `fadeInUp` inline) e semplificare con la classe `.fade-in-up` globale
- Aggiornare i testi per allinearsi alle regole micro-copy (sezione 5.1)
- Aggiornare la terminologia: "vCard" → "contatto", "QR code" → "codice da inquadrare"
- Se il link alla tutorial page esiste nel footer o altrove, mantenerlo

---

## 8. DB Migrations

| Tabella | Modifica | Motivo |
|---------|---------|--------|
| `user_instances` | Aggiungere colonna `welcome_sent BOOLEAN DEFAULT false` | Prevenire invio ripetuto del messaggio di benvenuto (sezione 3.3) |

---

## 9. Fuori scope (non in questo redesign)

- C1: Autenticazione reale dashboard (progetto separato)
- Stripe live mode (dipende da verifica account)
- Localizzazione multilingua
- Video tutorial embeddato (valutare dopo il lancio beta)
- Dark mode
- Screenshot reali di WhatsApp (usiamo illustrazioni SVG inline)
