# WhatsApp-Native Visual Redesign — Design Spec

## Goal

Redesign WhatsLater's landing page visual identity to feel like a native WhatsApp feature. Every visual element should reinforce the association with WhatsApp — colors, patterns, mockups, and layout should make users feel "inside WhatsApp."

## Architecture

Pure frontend CSS/component changes across 8 existing files + Tailwind config + globals.css. No backend, API, or database changes. No new dependencies.

## Tech Stack

- Next.js 14 App Router (existing)
- Tailwind CSS with custom theme tokens (existing)
- Lucide React icons (existing) + 1 custom SVG (WhatsApp-style chat bubble for logo)
- CSS background pattern (new, inline SVG)

---

## Design Decisions

### Scelte confermate dall'utente:
1. **Mockup telefono**: Statico (screenshot fisso, no animazione)
2. **Pattern sfondo**: Si, pattern sottile WhatsApp (opacita 3-5%)
3. **Come Funziona**: Icone stilizzate con palette WhatsApp
4. **Approccio**: "WhatsApp Native" — trasformazione completa della palette

### Vincolo sfondo:
- Sfondo globale body: `#FFFFFF` (bianco) — NOT beige everywhere
- `#ECE5DD` (beige WhatsApp) ONLY inside: phone mockup chat area, "Come Funziona" section background
- All other sections (Pricing, FAQ): white background

---

## Section-by-Section Design

### 1. Design System (tailwind.config.ts + globals.css)

**Palette Tailwind — tokens to add/change:**

| Token | Value | Use |
|-------|-------|-----|
| `primary` | `#25D366` | Buttons, CTA, accents (unchanged) |
| `primary-hover` | `#1DA851` | Button hover (unchanged) |
| `accent` | `#075E54` | Navbar, header, hero (unchanged) |
| `teal` | `#128C7E` | **NEW** — Hero gradient end, secondary elements |
| `background` | `#FFFFFF` | Global background (changed from #F3F5F7) |
| `surface` | `#FFFFFF` | Cards, containers (unchanged) |
| `chat-green` | `#DCF8C6` | **NEW** — User chat bubbles, highlights |
| `chat-beige` | `#ECE5DD` | **NEW** — Chat background, Come Funziona bg |
| `text-primary` | `#111B21` | Main text (unchanged) |
| `text-secondary` | `#667781` | Secondary text (unchanged) |
| `border-soft` | `#E9EDEF` | Subtle borders (unchanged) |
| `wa-blue` | `#53BDEB` | **NEW** — Blue checkmarks |

**WhatsApp background pattern:**
- CSS class `.wa-pattern` in globals.css
- Inline SVG background-image with small icons (clock, lock, note) at 3-5% opacity
- Applied to: hero section, "Come Funziona" section

**Body class change:**
- From: `bg-[#F3F5F7]`
- To: `bg-white`

**Animation cleanup:**
- Remove `phoneFrame4` keyframes from globals.css
- Remove `.phone-frame` CSS rules
- Keep `fadeInUp`, `animateIn` (used elsewhere)

### 2. Navbar (Navbar.tsx)

**Before:** White/transparent bg, blur on scroll, Calendar icon, gray links, green CTA.

**After:**
- Background: `bg-[#075E54]` fixed (no transparency/blur)
- Scroll: adds `shadow-md` after scrollY > 50px, color stays same
- Logo: Custom SVG chat bubble (WhatsApp-style) white + "WhatsLater" text white
- Nav links: `text-white/70 hover:text-white transition-colors`
- CTA button: `bg-[#25D366] text-white border border-white/20 rounded-full`
  - Desktop: "Programma i messaggi gratis"
  - Mobile: "Inizia gratis"
- Height: `h-16` (unchanged)
- Remove: Calendar import from lucide-react

### 3. Hero Section (HeroSection.tsx)

**Before:** Gradient `#075E54` to `#111B21`, 4-frame animated phone mockup.

**After:**

**Background:** `bg-gradient-to-b from-[#075E54] to-[#128C7E]` with `.wa-pattern` overlay.

**Text column (left):**
- H1: "I tuoi clienti non dimenticano piu l'appuntamento." — `text-white font-heading`
- Subtitle: "Il promemoria parte da WhatsApp, dal tuo numero, in automatico." — `text-[#25D366]`
- Sub-subtitle: "Setup in 2 minuti · Nessuna app da installare" — `text-white/50`
- CTA: "Inizia a programmare i messaggi" — `bg-[#25D366] text-white rounded-full shadow-lg shadow-[#25D366]/30`
- Under CTA: "Nessuna carta richiesta" — `text-white/40`

**Phone mockup (right) — STATIC:**
- Phone frame: dark rounded corners (`rounded-[2rem]`, `border-2 border-white/10`)
- Chat header: `bg-[#075E54]`, round green profile pic with "W", name "WhatsLater", status "online" in light green
- Chat background: `bg-[#ECE5DD]`
- **Bubble 1 (user, right):** `bg-[#DCF8C6]` rounded WhatsApp-style. Text: "Invia a Marco domani alle 15: Ricorda l'appuntamento! 📅". Timestamp "10:23" + blue checkmarks.
- **Bubble 2 (bot reply, left):** `bg-white` rounded. Text: "✅ Perfetto! Invierò a Marco domani alle 15:00: \"Ricorda l'appuntamento!\"". Timestamp "10:23" + blue checkmarks.
- **Bubble 3 (Marco receives, left):** Mini header "Marco Rossi" above bubble to indicate chat switch. `bg-white` rounded. Text: "Ciao! Ricorda l'appuntamento di domani alle 15 🗓️". Timestamp "15:00" + blue checkmarks.
- **Input bar:** Gray bg, white rounded input "Scrivi un messaggio", green mic button.

**Removals:** All 4 `.phone-frame` divs, all animation logic. Single static block.

### 4. Stats Bar (StatsBar.tsx)

**Before:** `bg-text-primary` (#111B21 dark).

**After:**
- Background: `bg-[#25D366]` (WhatsApp green)
- Numbers: `text-white font-bold text-3xl`
- Labels: `text-white/80 text-sm`
- Dividers: `border-white/30`
- Metrics unchanged: "2 minuti per iniziare", "0 app da installare", "100% dal tuo numero WhatsApp"

### 5. Come Funziona (HowItWorksSection.tsx)

**Before:** White background, Lucide icons.

**After:**
- Background: `bg-[#ECE5DD]` (beige WhatsApp) with `.wa-pattern` overlay
- Title: "Come Funziona" — `font-heading text-3xl sm:text-4xl font-bold text-[#111B21]`
- Subtitle: "3 passi e sei operativo" — `text-[#667781]`

**3 Cards** (grid 3 cols desktop, 1 col mobile):
- `bg-white rounded-2xl p-6 shadow-soft`
- Icon: Circle `bg-[#25D366]/12` with SVG icon `stroke-[#25D366]`
  - Step 1: LogIn icon (arrow right)
  - Step 2: MessageSquare icon (chat bubble)
  - Step 3: Check icon (checkmark)
- Number: Small circle `bg-[#25D366] text-white`
- Title: `text-[#111B21] font-bold`
- Description: `text-[#667781] text-sm`

**Content (updated copy):**
1. "Collega il tuo WhatsApp" — "Inserisci il codice a 8 cifre su WhatsApp — ci vogliono 30 secondi"
2. "Scrivi il Comando" — "Manda un messaggio a te stesso: 'Invia a Marco domani alle 15...'"
3. "Consegnato" — "Il messaggio parte all'ora giusta, dal tuo numero, in automatico"

### 6. Pricing (PricingSection.tsx)

**Before:** `bg-background` (#F3F5F7), Business button `bg-gray-900`.

**After:**
- Background: `bg-white`
- Title: `font-heading text-3xl sm:text-4xl font-bold text-[#111B21]`

**Cards:**
- Free: `border border-[#E9EDEF] shadow-soft`, checklist icons `text-[#667781]`
- Personal: `border-2 border-[#25D366] shadow-lg`, badge `bg-[#25D366]`, checklist icons `text-[#25D366]`, CTA `bg-[#25D366] text-white`
- Business: `border border-[#E9EDEF] shadow-soft`, checklist icons `text-[#25D366]`, CTA `bg-[#075E54] text-white` (changed from gray-900)

### 7. FAQ (FAQSection.tsx)

**Before:** White bg, black text for all questions, gray chevron.

**After:**
- Background: `bg-white` (unchanged)
- Title: `font-heading text-3xl sm:text-4xl font-bold text-[#111B21]` (unchanged)
- Question (closed): `text-[#111B21] font-medium`, chevron `text-[#667781]`
- Question (open): `text-[#075E54] font-medium`, chevron rotated `text-[#25D366]`
- Answer: `text-[#667781] text-sm`

### 8. Footer (Footer.tsx)

**Before:** `bg-text-primary` (#111B21), Calendar icon.

**After:**
- Background: `bg-[#075E54]` (matches navbar — visual frame)
- Rounded top: `rounded-t-[4rem]` (unchanged)
- Logo: Same SVG chat bubble as navbar + "WhatsLater" — `text-white font-heading font-bold`
- Tagline: "Promemoria WhatsApp automatici, dal tuo numero." — `text-white/50`
- Links: `text-white/60 hover:text-white transition-colors`
- Bottom: "Made in Italy - Hosted on EU servers" + copyright — `text-white/30`
- Remove: Calendar import from lucide-react

---

## Files to Modify

1. `tailwind.config.ts` — Add teal, chat-green, chat-beige, wa-blue tokens; change background to #FFFFFF
2. `app/globals.css` — Add .wa-pattern class; remove phoneFrame4 keyframes and .phone-frame rules
3. `app/layout.tsx` — Change body class from bg-[#F3F5F7] to bg-white
4. `app/components/Navbar.tsx` — Full restyle: dark bg, SVG logo, white links
5. `app/components/HeroSection.tsx` — New gradient, static phone mockup with 3 bubbles, remove animation
6. `app/components/StatsBar.tsx` — bg change to #25D366
7. `app/components/HowItWorksSection.tsx` — Beige bg, wa-pattern, updated icons and copy
8. `app/components/PricingSection.tsx` — bg-white, Business button color
9. `app/components/FAQSection.tsx` — Open question color changes
10. `app/components/Footer.tsx` — bg-[#075E54], SVG logo

## Out of Scope

- No backend/API changes
- No new npm dependencies
- No dashboard changes
- No mobile app changes
- No Stripe/payment flow changes
