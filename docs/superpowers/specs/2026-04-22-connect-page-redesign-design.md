# /connect Page Redesign — Design

> **Spec data**: 2026-04-22
> **Codename**: Connect Redesign
> **Versione**: v1
> **Mockup visivo**: `screenshots/connect-final.html` (committed alongside this spec)

---

## 1. Sommario

Redesign della pagina `/connect` (login phone-first post-C1) per:
- **Brand continuity totale** con la landing page (teal gradient + pattern WhatsApp, logo, tipografia)
- **Guida visiva del pairing** via stepper 3-step sempre visibile, numerazione passi WhatsApp, countdown TTL
- **Consistency con modal dashboard** (placeholder `3331234567`, hint "IT senza prefisso · estero con '+'")

Zero cambi di logica (auth flow esistente intatto), solo presentazione. Rimane un singolo file `app/connect/page.tsx` con un helper component `ConnectStepper` estratto (usato 3 volte).

---

## 2. Contesto e motivazione

### 2.1 Stato attuale (pre-redesign)

`app/connect/page.tsx` (~160 righe) presenta una pagina centrata su sfondo bianco neutro, con una piccola icona smartphone + titolo "Connetti WhatsApp" + card bianca minimale per il form. Nessun navbar, nessun footer, nessun pattern, nessuna guida al pairing oltre a una linea di testo piatto.

### 2.2 Problemi concreti identificati

1. **Rottura di coerenza**: l'utente che clicca "Inizia gratis" dalla landing (dark teal con pattern) atterra su una pagina bianca senza logo né navbar — sembra un'altra app.
2. **Label + placeholder obsoleti**: `"Numero WhatsApp (con prefisso, es. 393331234567)"` e placeholder `393331234567`. Il modal dashboard (fixato 2026-04-22) ora usa `"Numero"` + placeholder `3331234567`. Due messaggi opposti nello stesso prodotto.
3. **Pairing phase ambigua**: solo testo inline "Apri WhatsApp → Impostazioni → Dispositivi collegati → Collega un dispositivo" + QR 256px. Utente che non sa dove si trovi "Dispositivi collegati" su WhatsApp è perso.
4. **Error phase barebones**: solo messaggio + bottone Riprova. Nessuna indicazione di *cosa* è andato storto a livello visivo.
5. **Zero trust cues**: mancano "2 minuti", "cifrato", "no carta" che la landing page usa per convertire.

### 2.3 Target utente

Nuovo utente post-landing che clicca "Inizia gratis". Mobile-first (verosimilmente mobile su un dispositivo, scansione QR su un secondo dispositivo... ma spesso è UN solo device: il telefono di Marco). Target tempo totale: ≤60 secondi dal click CTA landing alla dashboard connessa.

---

## 3. Scope

### 3.1 In scope (v1)

- Redesign completo di `app/connect/page.tsx` (solo UI/UX, logica auth invariata)
- Nuovo component `components/ConnectStepper.tsx` per il progress 3-step
- Sfondo teal + pattern + navbar slim + footer-cues (fase 1)
- 4 fasi distinte: input, pairing, connecting, error — ognuna con il suo stato visivo dello stepper
- Copy migliorato in tutte le fasi
- Allineamento con design system esistente (tokens `primary`/`accent`/`text-primary`, font Space Grotesk + Inter)

### 3.2 Out of scope (v1.5+)

- **Animazioni transizione fase→fase** (es. crossfade card) — stateless phase swap è sufficiente per v1
- **Illustrazioni custom** dei passi WhatsApp (screenshot/sketch del menu "Dispositivi collegati") — testo numerato basta
- **Countdown visivo a barra** (oggi è testo "scade in 10 min") — aggiunge complessità, non serve
- **Localizzazione EN/altre lingue** — solo italiano in v1
- **Dark mode** — non in scope
- **Refactor `Navbar` per renderla riusabile su /connect** — duplichiamo un pezzo inline (è slim e diverso dalla landing Navbar)

---

## 4. Architettura

### 4.1 Layout comune (tutte le fasi)

```
┌─────────────────────────────────────┐
│ bg: teal gradient + dot pattern     │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ [●] WhatsLater               │   │  ← slim navbar (logo + brand)
│  └──────────────────────────────┘   │
│                                     │
│      Heading bianco (Space Grot.)   │  ← phase-specific, SOPRA la card
│      subtitle bianco/70              │
│                                     │
│  ┌──────────────────────────────┐   │
│  │ ╌╌╌╌╌╌╌╌╌╌ STEPPER ╌╌╌╌╌╌╌  │   │  ← sempre presente, stato cambia
│  │                              │   │
│  │  CONTENUTO FASE              │   │  ← varia (input / QR / success / errore)
│  │                              │   │
│  └──────────────────────────────┘   │
│                                     │
│      (fase 1 only) cues footer      │  ← "⚡ 2 min · 🔒 Cifrato · 💳 No carta"
└─────────────────────────────────────┘
```

### 4.2 ConnectStepper component

Stateless, rieusato da tutte le fasi. Props:

```typescript
interface ConnectStepperProps {
  currentStep: 1 | 2 | 3 | 'done' | 'error';
  errorOnStep?: 1 | 2 | 3;  // solo quando currentStep === 'error'
}
```

Rendering:
- Labels: `1 · Numero` / `2 · QR` / `3 · Dashboard`
- Step completati: label in grigio con prefisso `✓`
- Step attivo: label verde `#25D366`, bold
- Step error: label rosso con prefisso `⚠`
- Progress bar sotto: riempita proporzionalmente al currentStep (1/3, 2/3, 3/3). Colore verde normale, rosso in fase error.

### 4.3 Phase-specific content

#### Fase 1 — `input`

- Heading (sul teal): `Collega WhatsApp` + subtitle `Il tuo numero, niente app da installare.`
- Card: stepper (currentStep=1) + label `Numero WhatsApp` + input `<tel>` placeholder `3331234567` + hint `Italiano senza prefisso · estero con "+"` + button "Procedi" (verde WhatsApp, rounded-full)
- Footer cues: `⚡ 2 min · 🔒 Cifrato · 💳 No carta` (white/70)
- Submit → POST `/api/auth/init` (logica invariata), su success → phase='pairing'

#### Fase 2 — `pairing`

- Heading (sul teal): `Scansiona il QR` + subtitle `Tieni il telefono sul QR per 2 secondi.`
- Card: stepper (currentStep=2, step 1 ✓) + QR da ~192px (w-48) con cornice verde tenue (border `#25D366/20`) + pairing-code box (bg `#ECE5DD/40`, font-mono, tracking-widest, colore `#075E54`) + 3 step numerati con pallini `#25D366/15` + status "In attesa del pairing... (scade in 10 min)" con spinner
- Sotto la card: link "Annulla e ricomincia" (bianco/70, underline)
- Polling `/api/auth/check?sessionId=...` ogni 2s (logica invariata), su success → phase='connecting', su 410 → phase='error' con errorOnStep=2

#### Fase 3 — `connecting`

- Heading: nessuno (tutto il messaggio è dentro la card)
- Card: stepper (currentStep='done', tutto verde) + cerchio verde con ✓ grande + heading `Connesso!` + subtitle `Ti stiamo portando alla dashboard...` + spinner micro "Un istante..."
- Auto-redirect a `/dashboard` (logica invariata, 1-2s dopo)

#### Fase 4 — `error`

- Heading: nessuno
- Card: stepper (currentStep='error', errorOnStep=<step dove è fallito>, progress bar rosso) + cerchio rosso con ⚠ + heading rosso (es. `QR scaduto` / `Numero non valido` / `Errore di rete`) + copy empatico + 2 button: `Riprova` (primary, resetta a fase 1) + `Torna al sito` (secondary ghost, `window.location.href = '/'`)

### 4.4 State machine

Invariata rispetto all'implementazione attuale:

```
input ─ submit ──▶ pairing ─ poll ack ──▶ connecting ─ timer ──▶ /dashboard
  ▲                  │                         │
  │                  │ 410/timeout              │
  │                  ▼                         │
  │               error (errorOnStep=2) ───────┤
  │ reset                                       │ push
  └─────────────────────────────────────────────┘
```

---

## 5. Riferimenti visivi

Il mockup HTML statico con tutte le 4 fasi è committato in:

```
screenshots/connect-final.html
```

Apri con `start screenshots/connect-final.html`. È la fonte di verità visiva per l'implementazione: riproduce palette, spacing, proporzioni, stepper states.

Il mockup delle 6 varianti originali (per riferimento) è in `screenshots/connect-designs.html`.

---

## 6. Design tokens / classi

Tutti già presenti in `tailwind.config.ts`:

| Token | Valore | Uso |
|---|---|---|
| `bg-primary` | `#25D366` | CTA, active step, QR corner accents |
| `hover:bg-primary-hover` | `#1DA851` | CTA hover |
| `bg-accent` | `#075E54` | Pairing code text color |
| `text-text-primary` | `#111B21` | Card text |
| `text-text-secondary` | `#667781` | Hint, secondary |
| `bg-surface` | white | Card bg |
| `border-border` | `#E9EDEF` | Card borders, input borders |
| `shadow-soft` | `0 8px 30px rgba(0,0,0,0.04)` | Card (o usare `shadow-2xl` per più drama) |
| `rounded-3xl` | — | Card corner |
| `font-heading` | Space Grotesk | H1/H2 |
| Default | Inter | Body |

**Custom per questa pagina** (inline o in globals.css):

```css
.connect-bg {
  background:
    radial-gradient(circle at 20% 20%, rgba(37, 211, 102, 0.10) 0%, transparent 45%),
    radial-gradient(circle at 80% 70%, rgba(18, 140, 126, 0.15) 0%, transparent 45%),
    linear-gradient(135deg, #075E54 0%, #0a4f47 100%);
  position: relative;
}
.connect-bg::before {
  content: '';
  position: absolute; inset: 0;
  background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0);
  background-size: 28px 28px;
  pointer-events: none;
}
```

Preferibile aggiungerlo come utility custom in `globals.css` (sezione `@layer utilities`) per manutenibilità.

---

## 7. Text/copy (IT)

| Fase | Elemento | Testo |
|---|---|---|
| 1 | H1 | `Collega WhatsApp` |
| 1 | Subtitle | `Il tuo numero, niente app da installare.` |
| 1 | Label | `Numero WhatsApp` |
| 1 | Placeholder | `3331234567` |
| 1 | Hint | `Italiano senza prefisso · estero con "+"` |
| 1 | CTA | `Procedi` |
| 1 | Footer cues | `⚡ 2 min · 🔒 Cifrato · 💳 No carta` |
| 2 | H1 | `Scansiona il QR` |
| 2 | Subtitle | `Tieni il telefono sul QR per 2 secondi.` |
| 2 | Pairing code label | `Oppure inserisci questo codice` |
| 2 | Step 1 | `Apri **WhatsApp** sul tuo telefono` |
| 2 | Step 2 | `Tocca **Impostazioni → Dispositivi collegati**` |
| 2 | Step 3 | `Scansiona il QR sopra 📱` |
| 2 | Status | `In attesa del pairing... (scade in 10 min)` |
| 2 | Cancel | `Annulla e ricomincia` |
| 3 | H1 | `Connesso!` |
| 3 | Subtitle | `Ti stiamo portando alla dashboard...` |
| 3 | Spinner | `Un istante...` |
| 4 (QR expired) | H1 | `QR scaduto` |
| 4 (QR expired) | Copy | `Il codice è valido solo 10 minuti. Nessun problema — riprova.` |
| 4 (other) | H1/copy | Estratto da response server (invariato da `/api/auth/init` response) |
| 4 | CTA primary | `Riprova` |
| 4 | CTA secondary | `Torna al sito` |

Lo stepper ha label fissi `1 · Numero` / `2 · QR` / `3 · Dashboard`.

---

## 8. Accessibility

- `<h1>` per heading principale di ogni fase (phase 1 e 2), `<h2>` per card-internal titles (phase 3 e 4)
- Input `<label>` associato tramite `htmlFor`
- Stepper: `<nav aria-label="Progresso connessione">`, ogni step ha `aria-current="step"` quando attivo
- Error state: `role="alert"` sul container error, così screen reader annuncia
- QR `<img alt="QR code per connessione WhatsApp">`
- Button "Annulla": `<button>` (non `<a>`), reset state
- Contrasto: testo bianco su teal (`#075E54`) passa WCAG AA. Testo `text-white/70` su teal è borderline — va testato, eventualmente forzato a `text-white/80` se fallisce.

---

## 9. Edge cases

| # | Caso | Comportamento |
|---|---|---|
| 1 | Utente inserisce numero con prefisso (`+39 333...` o `393...`) | Accettato. Client-side normalize tramite `normalizeClientPhone` (riusare da `QuickCaptureModal.tsx`) oppure passarlo raw al backend (che ha già `validatePhone`). Scelta: passarlo raw — il backend è già corretto, ridondanza client non serve. |
| 2 | Submit con numero invalido | Backend ritorna 400 con error body. Frontend mostra l'error come fase `error` (errorOnStep=1). Bottone Riprova torna a fase 1 preservando il numero digitato. |
| 3 | QR scade prima che utente scansiona | 410 da `/api/auth/check` → fase `error` (errorOnStep=2, copy `QR scaduto`). Riprova torna a fase 1 (devono nuovo init, nuovo QR). |
| 4 | Network glitch durante polling | Non fatal (continua a pollare). Documentato già nel codice esistente. |
| 5 | User clicca Annulla in fase 2 | Clear timer + torna a fase 1 (numero preservato). Non cancella la pending_auth_sessions row su server — scadrà da sola (TTL 10min, cleanup cron 1h grace). |
| 6 | User refresh della pagina durante fase 2 | Stato perso (client). QR/sessionId persi. Deve ricominciare da fase 1. Accettabile — rare edge. |
| 7 | User apre /connect già con cookie valido | Oggi: la pagina si mostra comunque (non fa redirect). **DECISIONE v1**: lasciamo così (utenti che vogliono ri-pairare per qualche motivo possono farlo). Nel footer si può aggiungere "Già connesso? [Vai alla dashboard]". v1.5. |

---

## 10. Tests

### 10.1 Unit / component (Jest)

- `ConnectStepper`: snapshot + rendering per ciascuno stato (step 1, step 2, step 3, done, error con errorOnStep=1/2/3). File: `__tests__/connect-stepper.test.tsx`.
  - Verifica che lo step attivo abbia classe/aria-current corretti.
  - Verifica che progress-bar width sia coerente (1/3, 2/3, 3/3).

### 10.2 E2E (Playwright)

Estendere `__tests__/e2e/connect.spec.ts` esistente:
- Fase 1 renders: titolo, stepper 1/3 attivo, input, cues footer
- Numero invalido → error banner + fase 4
- (Non E2E-testabile facilmente: fase 2/3 perché richiedono Evolution API live + webhook)

### 10.3 Visual regression (manuale)

Post-deploy: aprire production `/connect`, confrontare con `screenshots/connect-final.html`. Parità attesa (modulo font hinting del browser).

---

## 11. Files to create/modify

### Create

| File | Righe stimate | Responsabilità |
|---|---|---|
| `components/ConnectStepper.tsx` | ~50 | Stepper riusabile |
| `__tests__/connect-stepper.test.tsx` | ~80 | Unit test stepper |

### Modify

| File | Cambio |
|---|---|
| `app/connect/page.tsx` | Riscrittura completa del JSX (da ~80 a ~250 righe). Logica invariata. Import e uso di `ConnectStepper`. |
| `app/globals.css` | Aggiungere `.connect-bg` utility (sezione `@layer utilities`, ~15 righe) |
| `__tests__/e2e/connect.spec.ts` | Estendere con assertion su stepper + cues |
| `docs/ARCHITETTURA.md` | Paragrafo nella sezione flussi: il redesign è solo UI, niente cambi backend |

---

## 12. Stima effort

| Pezzo | Ore |
|---|---|
| `ConnectStepper` component + unit test | 1.5-2h |
| Redesign `app/connect/page.tsx` (tutte le 4 fasi) | 4-5h |
| Utility CSS `connect-bg` + applicazione | 0.5h |
| Estensione E2E test | 1h |
| Smoke test produzione + screenshot comparison | 0.5h |
| Buffer | 1-1.5h |
| **Totale** | **8.5-10.5h** (~1 giornata piena) |

---

## 13. Out of scope esplicito / future work

- **Illustrazioni screenshot WhatsApp** per i 3 step (icona app, screenshot menu Impostazioni, etc.) — rende guida ancora più chiara ma richiede asset grafici. v1.5.
- **Dark mode** — bassa priorità, l'app è già prevalentemente "light".
- **Animazioni fase→fase** — crossfade o slide tra card. Nice-to-have.
- **Copertura EN/multilang** — servirà al momento dell'espansione internazionale.
- **Audio/vibrazione feedback** su fase 3 success (subtle haptic su mobile) — oltre scope UI.

---

## 14. Riferimenti

- Landing attuale: `app/components/{Navbar,HeroSection}.tsx`
- Design system: `tailwind.config.ts`
- Auth logica (invariata): `app/api/auth/init/route.ts`, `app/api/auth/check/route.ts`, `app/lib/auth-cookie.ts`
- Spec correlata: `docs/superpowers/specs/2026-04-19-phone-first-cookie-auth-design.md` (C1)
- Mockup visivo autoritativo: `screenshots/connect-final.html`
