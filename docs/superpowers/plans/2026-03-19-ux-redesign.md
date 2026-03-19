# UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign WhatsLater's landing page and dashboard for a 55-year-old professional (dentist, hairdresser) who needs zero technical help to understand and use the product.

**Architecture:** Remove GSAP animations and complex UI, replace with CSS-only animations and simplified components. Update all micro-copy to plain Italian. Add welcome message and AIUTO handler in webhook. Rewrite landing page sections (Hero, StatsBar, HowItWorks) and dashboard (banner, status config, countdown).

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Supabase, Lucide React icons, CSS @keyframes + IntersectionObserver (replacing GSAP)

**Spec:** `docs/superpowers/specs/2026-03-19-ux-redesign-design.md`

---

## Chunk 1: Foundation — Layout, Config, Globals

### Task 1: Remove unused fonts from layout and Tailwind config

**Files:**
- Modify: `app/layout.tsx`
- Modify: `tailwind.config.ts`
- Modify: `app/dashboard/page.tsx` (font-mono usage at lines ~487, ~598)

- [ ] **Step 1: Remove Playfair and JetBrains font imports from layout.tsx**

In `app/layout.tsx`, remove the `Playfair_Display` and `JetBrains_Mono` imports and their variable declarations. Remove `${playfair.variable}` and `${jetbrainsMono.variable}` from the `<body>` className.

Keep only `Inter` and `Space_Grotesk`.

- [ ] **Step 2: Remove serif and mono from tailwind.config.ts**

In `tailwind.config.ts`, remove these lines from `fontFamily`:
```
serif: ['var(--font-playfair)', 'serif'],
mono: ['var(--font-jetbrains-mono)', 'monospace'],
```

Keep only `sans` and `heading`.

- [ ] **Step 3: Search and replace font-serif/font-mono usage**

Run: `grep -rn "font-serif\|font-mono\|font-playfair\|font-jetbrains" app/`

Known matches to fix:
- `app/dashboard/page.tsx` line ~487: pairing code display uses `font-mono` → replace with `font-sans tracking-widest`
- `app/dashboard/page.tsx` line ~598: inline instruction uses `font-mono` → replace with `font-sans`
- Any other matches: replace with `font-sans` or `font-heading` as appropriate.

- [ ] **Step 4: Update metadata in layout.tsx**

Replace the metadata object:
```typescript
export const metadata: Metadata = {
  title: 'WhatsLater - Promemoria WhatsApp automatici',
  description: 'I tuoi clienti non dimenticano piu l\'appuntamento. Promemoria automatici da WhatsApp, dal tuo numero.',
  keywords: ['WhatsApp', 'promemoria', 'appuntamenti', 'automatici', 'professionisti'],
}
```

- [ ] **Step 5: Remove noise overlay from layout.tsx**

Remove the `<div className="pointer-events-none fixed inset-0 z-50 ...">` element with the SVG noise background.

- [ ] **Step 6: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds with no font-related errors.

- [ ] **Step 7: Commit**

```bash
git add app/layout.tsx tailwind.config.ts app/dashboard/page.tsx
git commit -m "chore: remove unused fonts, noise overlay, update metadata"
```

---

### Task 2: Add CSS animations to globals.css

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Add fade-in-up and phone-frame keyframes**

Add to `app/globals.css`:
```css
/* Fade-in-up for scroll reveal (replaces GSAP fade animations) */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in-up {
  opacity: 0;
  animation: fadeInUp 0.4s ease-out forwards;
}

/* Phone mockup frame animation (3 frames, 6s loop) */
@keyframes phoneFrame {
  0%, 30% { opacity: 1; }
  33%, 97% { opacity: 0; }
  100% { opacity: 1; }
}

.phone-frame {
  position: absolute;
  inset: 0;
  opacity: 0;
}
.phone-frame:nth-child(1) { animation: phoneFrame 6s infinite; }
.phone-frame:nth-child(2) { animation: phoneFrame 6s infinite 2s; }
.phone-frame:nth-child(3) { animation: phoneFrame 6s infinite 4s; }
```

- [ ] **Step 2: Verify no build errors**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: add CSS animations replacing GSAP (fadeInUp, phoneFrame)"
```

---

## Chunk 2: Landing Page Components

### Task 3: Rewrite Navbar (remove GSAP)

**Files:**
- Modify: `app/components/Navbar.tsx`

- [ ] **Step 1: Rewrite Navbar.tsx**

Replace the entire component. Remove all GSAP imports. Use vanilla scroll listener for `.nav-scrolled` behavior. Update links:
- "Come Funziona" → `#come-funziona`
- "Prezzi" → `#prezzi`
- "FAQ" → `#faq`
- CTA button: text "Attiva i promemoria gratis", `href="/dashboard"`

```tsx
'use client';
import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import Link from 'next/link';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
      scrolled
        ? 'bg-white/90 backdrop-blur-md shadow-sm'
        : 'bg-white/50 backdrop-blur-sm'
    }`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-accent font-heading font-bold text-lg">
          <Calendar className="w-5 h-5" />
          WhatsLater
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#come-funziona" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Come Funziona</a>
          <a href="#prezzi" className="text-sm text-text-secondary hover:text-text-primary transition-colors">Prezzi</a>
          <a href="#faq" className="text-sm text-text-secondary hover:text-text-primary transition-colors">FAQ</a>
        </div>

        <Link
          href="/dashboard"
          className="bg-primary text-white px-5 h-12 flex items-center rounded-full text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Attiva i promemoria gratis
        </Link>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/components/Navbar.tsx
git commit -m "refactor: rewrite Navbar without GSAP, update CTA and links"
```

---

### Task 4: Rewrite HeroSection (remove GSAP, new copy)

**Files:**
- Modify: `app/components/HeroSection.tsx`

- [ ] **Step 1: Rewrite HeroSection.tsx**

Replace the entire component. Remove all GSAP imports, bubble animations, and complex phone timeline. New structure:
- Headline: "I tuoi clienti non dimenticano piu l'appuntamento."
- Sub: "Il promemoria parte da WhatsApp, dal tuo numero, in automatico."
- Trust line: "Setup in 2 minuti · Nessuna app da installare"
- CTA button: "Attiva i promemoria gratis" → `/dashboard`
- Under CTA: "Nessuna carta richiesta"
- Phone mockup with 3-frame CSS animation

```tsx
'use client';
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-accent to-text-primary overflow-hidden pt-16">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Text */}
        <div className="text-center md:text-left">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
            I tuoi clienti non dimenticano piu l&apos;appuntamento.
          </h1>
          <p className="mt-4 text-lg text-primary font-medium leading-relaxed">
            Il promemoria parte da WhatsApp, dal tuo numero, in automatico.
          </p>
          <p className="mt-3 text-sm text-white/50">
            Setup in 2 minuti &middot; Nessuna app da installare
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary/90 transition-colors"
            >
              Attiva i promemoria gratis
            </Link>
          </div>
          <p className="mt-3 text-xs text-white/40">Nessuna carta richiesta</p>
        </div>

        {/* Phone mockup */}
        <div className="flex justify-center">
          <div className="w-[220px] h-[440px] bg-[#1a1a1a] rounded-[2rem] border-2 border-white/10 overflow-hidden relative p-3">
            {/* Frame 1: Chat screen */}
            <div className="phone-frame flex flex-col h-full bg-[#0b141a] rounded-2xl p-3">
              <div className="text-xs text-white/50 mb-2">WhatsApp</div>
              <div className="mt-auto">
                <div className="bg-[#005c4b] rounded-lg p-2 text-xs text-white/90 max-w-[80%] ml-auto">
                  Ricorda appuntamento domani alle 15
                </div>
              </div>
            </div>
            {/* Frame 2: Message visible */}
            <div className="phone-frame flex flex-col h-full bg-[#0b141a] rounded-2xl p-3">
              <div className="text-xs text-white/50 mb-2">Marco Rossi</div>
              <div className="mt-auto space-y-2">
                <div className="bg-[#005c4b] rounded-lg p-2 text-xs text-white/90 max-w-[80%] ml-auto">
                  Ciao Marco! Ti ricordo l&apos;appuntamento di domani alle 15:00
                </div>
                <div className="text-[10px] text-white/30 text-right">14:59</div>
              </div>
            </div>
            {/* Frame 3: Sent check */}
            <div className="phone-frame flex flex-col items-center justify-center h-full bg-[#0b141a] rounded-2xl">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-3">
                <svg className="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-white font-medium">Inviato</p>
              <p className="text-xs text-white/40 mt-1">Promemoria consegnato</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/components/HeroSection.tsx
git commit -m "refactor: rewrite HeroSection - new copy, CSS animation, no GSAP"
```

---

### Task 5: Rewrite HowItWorksSection (remove GSAP)

**Files:**
- Modify: `app/components/HowItWorksSection.tsx`

- [ ] **Step 1: Rewrite HowItWorksSection.tsx**

Replace the entire component. Remove all GSAP imports and scroll-pinning. 3 simple steps with Lucide icons.

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { Link2, MessageSquare, Bell } from 'lucide-react';

const steps = [
  {
    icon: Link2,
    title: 'Connetti WhatsApp',
    time: '30 secondi',
    description: 'Collega il tuo numero in 30 secondi',
  },
  {
    icon: MessageSquare,
    title: 'Scrivi il messaggio e l\'orario',
    time: '',
    description: 'Manda un messaggio a te stesso con il testo e l\'ora',
  },
  {
    icon: Bell,
    title: 'Il tuo cliente riceve il promemoria',
    time: '',
    description: 'Il messaggio parte in automatico, dal tuo numero',
  },
];

export default function HowItWorksSection() {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('fade-in-up');
          }
        });
      },
      { threshold: 0.1 }
    );

    const cards = sectionRef.current?.querySelectorAll('.step-card');
    cards?.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="come-funziona" ref={sectionRef} className="py-24 bg-background">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary text-center mb-16">
          Come Funziona
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="step-card text-center opacity-0" style={{ animationDelay: `${i * 150}ms` }}>
              <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <step.icon className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold text-text-primary mb-1">{step.title}</h3>
              {step.time && (
                <span className="text-xs text-primary font-medium">{step.time}</span>
              )}
              <p className="text-sm text-text-secondary mt-2">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/components/HowItWorksSection.tsx
git commit -m "refactor: rewrite HowItWorksSection - 3 simple steps, no GSAP"
```

---

### Task 6: Rewrite page.tsx, create StatsBar, delete Features + Philosophy

This task is atomic: it updates `page.tsx` in the same commit as deleting/replacing components so the build stays green.

**Files:**
- Create: `app/components/StatsBar.tsx`
- Delete: `app/components/PhilosophySection.tsx`
- Delete: `app/components/FeaturesSection.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create StatsBar.tsx**

```tsx
export default function StatsBar() {
  const stats = [
    { number: '2', label: 'minuti per iniziare' },
    { number: '0', label: 'app da installare' },
    { number: '100%', label: 'dal tuo numero WhatsApp' },
  ];

  return (
    <section className="bg-[#111B21] py-10">
      <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-8">
        {stats.map((stat, i) => (
          <div
            key={i}
            className={`flex-1 text-center ${
              i < stats.length - 1 ? 'sm:border-r sm:border-white/20' : ''
            }`}
          >
            <div className="text-3xl font-bold text-white">{stat.number}</div>
            <div className="text-sm text-white/70 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Rewrite page.tsx**

Remove imports for `FeaturesSection` and `PhilosophySection`. Add import for `StatsBar`. Remove the inline `#connetti` section. New order:

```tsx
'use client';
import Navbar from './components/Navbar';
import HeroSection from './components/HeroSection';
import StatsBar from './components/StatsBar';
import HowItWorksSection from './components/HowItWorksSection';
import PricingSection from './components/PricingSection';
import FAQSection from './components/FAQSection';
import Footer from './components/Footer';

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <HeroSection />
      <StatsBar />
      <HowItWorksSection />
      <PricingSection />
      <FAQSection />
      <Footer />
    </main>
  );
}
```

- [ ] **Step 3: Delete PhilosophySection.tsx and FeaturesSection.tsx**

Run: `rm app/components/PhilosophySection.tsx app/components/FeaturesSection.tsx`

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds — page.tsx no longer references deleted components.

- [ ] **Step 5: Commit**

```bash
git add app/components/StatsBar.tsx app/page.tsx
git rm app/components/PhilosophySection.tsx app/components/FeaturesSection.tsx
git commit -m "refactor: simplify landing page - StatsBar replaces Philosophy, delete Features + #connetti"
```

---

### Task 7: Remove GSAP from package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Uninstall GSAP packages**

Run: `npm uninstall gsap @gsap/react`

- [ ] **Step 2: Search for remaining GSAP imports**

Run: `grep -rn "gsap\|ScrollTrigger\|TextPlugin" app/ --include="*.tsx" --include="*.ts"`

Expected: No matches. If any remain, remove them.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds with no GSAP-related errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove GSAP dependency (all animations now CSS-only)"
```

---

## Chunk 3: Micro-copy & Content Updates

### Task 8: Update PricingSection micro-copy and behavior

**Files:**
- Modify: `app/components/PricingSection.tsx`

- [ ] **Step 1: Update texts and behavior in PricingSection.tsx**

1. Replace `window.location.href = '#connetti'` (line ~12) with `window.location.href = '/dashboard'`
2. Replace all instances of "Gestisci abbonamento" with "Cambia piano"
3. For the "Cambia piano" button that already-subscribed users see, ensure the `onClick` handler opens `/#prezzi` in a new tab: `window.open('/#prezzi', '_blank')`

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/components/PricingSection.tsx
git commit -m "copy: update PricingSection - remove #connetti ref, update button text and behavior"
```

---

### Task 9: Update FAQSection micro-copy

**Files:**
- Modify: `app/components/FAQSection.tsx`

- [ ] **Step 1: Rewrite FAQ content**

Replace all FAQ items with non-technical language per spec section 5.3. Update questions and answers:

1. "E sicuro collegare WhatsApp?" → Keep question, rewrite answer: remove "Row Level Security" and "database PostgreSQL", replace with "I tuoi dati sono protetti con la massima sicurezza. Nessuno puo leggere i tuoi messaggi."
2. "Devo scansionare un QR Code?" → "Come collego WhatsApp?" — Answer: "Inserisci il tuo numero di telefono e segui le istruzioni. Ci vogliono 30 secondi."
3. "E se il telefono e spento?" → Keep, simplify answer: remove technical details, keep "I messaggi programmati partono anche se il telefono e spento."
4. "Posso annullare un messaggio programmato?" → Keep, simplify: "Si, dalla dashboard clicca 'Annulla invio' su qualsiasi messaggio non ancora inviato."
5. "Come funziona l'intelligenza artificiale?" → "Come capisce gli orari?" — Answer: "Scrivi normalmente: 'domani alle 15', 'lunedi mattina', 'tra 2 ore'. WhatsLater capisce automaticamente."

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/components/FAQSection.tsx
git commit -m "copy: rewrite FAQ - plain Italian, no technical jargon"
```

---

### Task 10: Update Footer micro-copy

**Files:**
- Modify: `app/components/Footer.tsx`

- [ ] **Step 1: Update Footer tagline**

Replace "Scrivi ora, invia dopo." with "Promemoria WhatsApp automatici, dal tuo numero."

Check for any `#connetti` links and update to `/dashboard`.

- [ ] **Step 2: Commit**

```bash
git add app/components/Footer.tsx
git commit -m "copy: update Footer tagline"
```

---

### Task 11: Update Tutorial page micro-copy

**Files:**
- Modify: `app/tutorial/page.tsx`

- [ ] **Step 1: Update tutorial terminology**

1. Replace all instances of "vCard" with "contatto"
2. Replace "QR code" with "codice da inquadrare" if present
3. Remove custom `fadeInUp` keyframes (inline `<style>` tag in the component) — replace with the global `.fade-in-up` class from `globals.css`
4. Ensure all text follows the 4 micro-copy rules (informal "tu", present tense, no jargon, action-oriented)

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/tutorial/page.tsx
git commit -m "copy: update tutorial - plain Italian, use global animations"
```

---

### Task 12: Update error messages across the codebase

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/api/webhook/route.ts` (if user-facing error messages exist)

- [ ] **Step 1: Search for user-facing error messages**

Run: `grep -rn "alert\|toast\|error.*message\|Error\|errore" app/dashboard/page.tsx`

- [ ] **Step 2: Replace error messages**

Update any user-facing error strings in the dashboard to match the spec:

| Situation | Message |
|-----------|---------|
| Generic error (catch blocks, API failures) | "Qualcosa non ha funzionato. Riprova tra un momento — se il problema continua scrivi a supporto@whatslaterpush.vercel.app" |
| Connection expired | "Il collegamento e scaduto. Clicca qui per ricollegarti — ci vogliono 30 secondi" |
| Message failed (in list) | "Non inviato — clicca per riprovare" |
| Daily limit | "Hai usato tutti i messaggi di oggi. Riparte domani o passa a Personal per 20 al giorno" |
| Contact limit | "Hai raggiunto il massimo di contatti per il tuo piano. Passa a Personal per salvarne fino a 50" |
| Invalid number | "Questo numero non sembra corretto. Controlla e riprova" |
| WhatsApp disconnected | "WhatsApp si e scollegato. Ricollegati dalla dashboard — ci vogliono 30 secondi" |

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "copy: update error messages - actionable plain Italian"
```

---

## Chunk 4: Dashboard Redesign

### Task 13: Add formatCountdown utility and statusConfig

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Read the current dashboard to understand the statusColors and fmt() location**

Run: `grep -n "statusColors\|function fmt\|const fmt" app/dashboard/page.tsx`

- [ ] **Step 2: Replace statusColors with statusConfig**

Replace the existing `statusColors` map with:

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

Update all references from `statusColors[msg.status]` to `statusConfig[msg.status]?.color` and add the label display next to the color dot.

- [ ] **Step 3: Replace fmt() with formatCountdown**

Replace the existing `fmt()` function with:

```typescript
function formatCountdown(scheduledAt: string): { text: string; urgent: boolean } {
  const target = new Date(scheduledAt);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);

  if (diffMs < 0) return { text: 'scaduto', urgent: false };

  if (diffMin < 60) {
    return { text: `tra ${diffMin} minuti`, urgent: diffMin < 10 };
  }

  const hh = target.getHours().toString().padStart(2, '0');
  const mm = target.getMinutes().toString().padStart(2, '0');
  const time = `${hh}:${mm}`;

  if (diffHours < 24) {
    return { text: `oggi alle ${time}`, urgent: false };
  }
  if (diffHours < 48) {
    return { text: `domani alle ${time}`, urgent: false };
  }

  const days = ['domenica','lunedi','martedi','mercoledi','giovedi','venerdi','sabato'];
  if (diffHours < 168) {
    return { text: `${days[target.getDay()]} alle ${time}`, urgent: false };
  }

  const dd = target.getDate().toString().padStart(2, '0');
  const mo = (target.getMonth() + 1).toString().padStart(2, '0');
  return { text: `${dd}/${mo} alle ${time}`, urgent: false };
}
```

Update all `fmt(msg.scheduled_at)` calls to use `formatCountdown(msg.scheduled_at)`.

- [ ] **Step 4: Update message row rendering**

Update each message row in the list to display:

```tsx
{messages.map((msg) => {
  const countdown = formatCountdown(msg.scheduled_at);
  const status = statusConfig[msg.status] || { color: '#9CA3AF', label: msg.status };
  return (
    <div key={msg.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
      <div className="flex-1 min-w-0">
        <div className="text-base font-bold text-white truncate">{msg.recipient_name}</div>
        <div className="text-sm text-gray-400 truncate">{(msg.parsed_message || '').substring(0, 50)}</div>
        <div className={`text-sm mt-1 ${countdown.urgent ? 'text-red-400' : 'text-primary'}`}>
          {countdown.text}
        </div>
      </div>
      <div className="flex items-center gap-3 ml-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: status.color }} />
          <span className="text-xs text-gray-400">{status.label}</span>
        </div>
        {(msg.status === 'pending' || msg.status.startsWith('awaiting_')) && (
          <button
            onClick={() => { if (confirm('Vuoi annullare questo invio?')) cancelMessage(msg.id) }}
            className="p-2 text-gray-400 hover:text-red-400 transition-colors"
            title="Annulla invio"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
})}
```

Make sure `Trash2` is imported from `lucide-react`.

- [ ] **Step 5: Verify the app builds**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: add statusConfig, formatCountdown, and updated message row layout"
```

---

### Task 14: Dashboard micro-copy updates

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Update connection and UI text**

Search and replace these strings in `dashboard/page.tsx`:

| Find | Replace |
|------|---------|
| "Inserisci il tuo numero per generare il codice di collegamento" | "Collega il tuo WhatsApp in 30 secondi" |
| "Scansiona il QR code con WhatsApp" | "Inquadra questo codice con WhatsApp" |
| "In attesa di connessione..." | "Apri WhatsApp sul telefono e inserisci il codice 👆" |
| "Nessun messaggio." (and surrounding text about vCard) | "Nessun promemoria programmato. Apri WhatsApp e invia il primo!" |
| "Gestisci abbonamento" | "Cambia piano" |
| "Elimina" (delete button text) | "Annulla invio" |

- [ ] **Step 2: Update "Cambia piano" button behavior**

Find the "Gestisci abbonamento" / manage subscription button and change its `onClick` to:
```typescript
onClick={() => window.open('/#prezzi', '_blank')}
```

- [ ] **Step 3: Remove the first-time onboarding modal**

Find the onboarding/how-to-use modal that shows on first dashboard access. Remove the modal and its associated state (`showOnboarding` or similar). The welcome message now arrives via WhatsApp instead (Task 20).

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "copy: update dashboard micro-copy, remove onboarding modal"
```

---

### Task 15: Dashboard banner component

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Add DashboardBanner inline component**

Add this component inside `dashboard/page.tsx` (before the main page component):

```typescript
function DashboardBanner({
  connectionStatus,
  subscriptionPlan,
  trialEndsAt,
  messages,
  dailyLimit,
}: {
  connectionStatus: string;
  subscriptionPlan: string;
  trialEndsAt: string | null;
  messages: any[];
  dailyLimit: number;
}) {
  // Priority 1: Disconnected
  if (connectionStatus !== 'open') {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 text-sm text-red-200">
        🔴 WhatsApp scollegato — ricollegati per inviare i promemoria
      </div>
    );
  }

  // Priority 2: Daily limit
  const today = new Date().toISOString().slice(0, 10);
  const sentToday = messages.filter(
    (m) => m.status === 'sent' && m.updated_at?.startsWith(today)
  ).length;
  if (sentToday >= dailyLimit) {
    return (
      <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-3 text-sm text-yellow-200">
        ⚠️ Hai usato {sentToday}/{dailyLimit} messaggi oggi — riparte domani o passa a Personal
      </div>
    );
  }

  // Priority 3: Trial
  if (subscriptionPlan === 'trial' && trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86400000));
    return (
      <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-200">
        🎯 Trial: {daysLeft} giorni rimasti — Passa a Personal per continuare
      </div>
    );
  }

  return null;
}
```

- [ ] **Step 2: Render DashboardBanner in the dashboard**

Add `<DashboardBanner ... />` above the messages list, passing `connectionStatus`, `subscriptionPlan`, `trialEndsAt`, `messages`, and `dailyLimit` (from the tier config already in the component) as props.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: add contextual DashboardBanner (disconnect, limit, trial)"
```

---

### Task 16: Dashboard contextual instructions (FAB)

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Update HowToUseBox visibility logic**

Find the existing `HowToUseBox` component. Add logic to determine visibility:

```typescript
const createdAt = instanceData?.created_at;
const isNewUser = createdAt && (Date.now() - new Date(createdAt).getTime() < 7 * 24 * 60 * 60 * 1000);
const hasNoMessages = messages.length === 0;
const showInstructions = isNewUser || hasNoMessages;
```

- If `showInstructions` is true: render `HowToUseBox` inline (as currently done)
- If `showInstructions` is false: render a FAB button instead:

```tsx
{!showInstructions && (
  <button
    onClick={() => setShowHelp(!showHelp)}
    className="fixed bottom-4 right-4 w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center shadow-lg text-lg font-bold z-30"
    aria-label="Aiuto"
  >
    ?
  </button>
)}
{showHelp && !showInstructions && (
  <div className="fixed bottom-20 right-4 w-80 bg-white rounded-xl shadow-2xl p-4 z-30 text-sm text-text-primary">
    <button onClick={() => setShowHelp(false)} className="absolute top-2 right-2 text-gray-400">×</button>
    <p className="font-bold mb-2">Come funziona:</p>
    <ol className="list-decimal list-inside space-y-1 text-text-secondary">
      <li>Invia il contatto di un tuo cliente (📎 → Contatto)</li>
      <li>Scrivi: &quot;Ricorda a [nome] l&apos;appuntamento di domani alle 15&quot;</li>
    </ol>
  </div>
)}
```

Add `const [showHelp, setShowHelp] = useState(false);` to the component state.

- [ ] **Step 2: Verify the app builds**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: contextual instructions - inline for new users, FAB for returning"
```

---

### Task 17: Dashboard onboarding — pairing code default + SVG instructions

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Read the current connection flow in dashboard**

Run: `grep -n "pairing\|qr\|QR\|connessione\|collegamento" app/dashboard/page.tsx -i`

Understand the current connection UI structure.

- [ ] **Step 2: Set pairing code as default**

In the connection section, make the pairing code input the primary/default view. Move the QR code to a secondary option with a link: "Preferisci inquadrare un codice? Clicca qui" that toggles to the QR code view.

- [ ] **Step 3: Add SVG inline platform instructions**

Add a visual guide above the pairing code input showing how to reach "Dispositivi Collegati" in WhatsApp. Use simple styled divs (not actual screenshots) showing the 3-tap path:

```tsx
function PlatformGuide() {
  const [platform, setPlatform] = useState<'android' | 'iphone'>(
    typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent) ? 'iphone' : 'android'
  );

  return (
    <div className="mb-4">
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setPlatform('android')}
          className={`px-3 py-1 rounded-full text-xs ${platform === 'android' ? 'bg-primary text-white' : 'bg-white/10 text-gray-400'}`}
        >
          Android
        </button>
        <button
          onClick={() => setPlatform('iphone')}
          className={`px-3 py-1 rounded-full text-xs ${platform === 'iphone' ? 'bg-primary text-white' : 'bg-white/10 text-gray-400'}`}
        >
          iPhone
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {platform === 'android' ? (
          <>
            <span className="bg-white/10 rounded px-2 py-1">⋮</span>
            <span>→</span>
            <span className="bg-white/10 rounded px-2 py-1">Dispositivi collegati</span>
            <span>→</span>
            <span className="bg-white/10 rounded px-2 py-1">Collega un dispositivo</span>
          </>
        ) : (
          <>
            <span className="bg-white/10 rounded px-2 py-1">Impostazioni</span>
            <span>→</span>
            <span className="bg-white/10 rounded px-2 py-1">Dispositivi collegati</span>
            <span>→</span>
            <span className="bg-white/10 rounded px-2 py-1">Collega un dispositivo</span>
          </>
        )}
      </div>
    </div>
  );
}
```

Render `<PlatformGuide />` above the pairing code input in the connection section.

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat: pairing code as default, add platform-aware connection guide"
```

---

## Chunk 5: Backend — Webhook & DB

### Task 18: DB migration — add welcome_sent column

**Files:**
- None (Supabase SQL)

- [ ] **Step 1: Run migration in Supabase**

Execute in Supabase SQL editor (or via CLI):
```sql
ALTER TABLE user_instances
ADD COLUMN IF NOT EXISTS welcome_sent BOOLEAN DEFAULT false;
```

- [ ] **Step 2: Verify migration**

Run: `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'user_instances' AND column_name = 'welcome_sent';`

Expected: One row with `boolean` type and `false` default.

---

### Task 19: Add AIUTO handler in webhook

**Files:**
- Modify: `app/api/webhook/route.ts`
- Modify: `__tests__/webhook.integration.test.ts`

- [ ] **Step 1: Read existing test helpers to understand patterns**

Run: `grep -n "function call\|function create\|function make\|function build" __tests__/webhook.integration.test.ts`

Understand which helper functions exist (`callWebhook`, `createWebhookPayload`, `makeWebhookBody`, etc.) and their signatures, so the new test matches existing patterns.

- [ ] **Step 2: Write the failing test**

Add to `__tests__/webhook.integration.test.ts`, using the existing test helpers discovered in Step 1:

```typescript
test('AIUTO keyword triggers welcome message response', async () => {
  // Use existing helpers to create a self-chat webhook payload with text "AIUTO"
  // Set remoteJid to ownerPhone@s.whatsapp.net (self-chat)
  // Set fromMe: true

  const res = await callWebhook(payload);
  const body = await res.json();

  expect(body.ok).toBe(true);
  // Verify notifyOwner was called with welcome message
  const sendCalls = fetchMock.calls.filter((c: any) => c.url.includes('/message/sendText/'));
  expect(sendCalls.length).toBeGreaterThanOrEqual(1);
  const sentText = JSON.parse(sendCalls[0].options.body as string).text;
  expect(sentText).toContain('Benvenuto su WhatsLater');
});
```

Adapt the payload creation to match the exact helpers used in the existing tests.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest __tests__/webhook.integration.test.ts -t "AIUTO" --no-coverage`
Expected: FAIL — AIUTO is currently processed as a normal message.

- [ ] **Step 4: Add AIUTO handler in webhook/route.ts**

Add a constant at the top of the file:

```typescript
const WELCOME_MESSAGE = `Benvenuto su WhatsLater! 🎉

Ecco come mandare il tuo primo promemoria in 2 passi:

1️⃣ Inviami il contatto di un tuo cliente (premi 📎 → Contatto)
2️⃣ Poi scrivi: "Ricorda a [nome] l'appuntamento di domani alle 15"

Il messaggio partira automaticamente all'orario che scegli! 📲

Hai bisogno di aiuto? Scrivi AIUTO`;
```

Add the check **before** the AI parsing (before the Groq/OpenAI call), after extracting `messageText`:

```typescript
if (messageText.trim().toUpperCase() === 'AIUTO') {
  await notifyOwner(instanceName, ownerPhone, WELCOME_MESSAGE);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest __tests__/webhook.integration.test.ts -t "AIUTO" --no-coverage`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/webhook/route.ts __tests__/webhook.integration.test.ts
git commit -m "feat: add AIUTO handler - sends welcome message on keyword"
```

---

### Task 20: Add welcome message on first connection

**Files:**
- Modify: `app/api/webhook/route.ts`
- Modify: `__tests__/webhook.integration.test.ts`

- [ ] **Step 1: Read the existing connection.update handler**

Run: `grep -n "connection.update\|connection_update\|status.*open" app/api/webhook/route.ts`

Understand how the webhook currently handles connection status changes to know where to add the welcome logic.

- [ ] **Step 2: Read existing test structure for connection events**

Run: `grep -n "connection\|CONNECTION" __tests__/webhook.integration.test.ts`

Check if connection event tests exist. If not, understand how to create the payload from the webhook handler code.

- [ ] **Step 3: Write the failing test**

Add to `__tests__/webhook.integration.test.ts`. Create the test helper if needed:

```typescript
// Helper to create a connection.update webhook payload
function createConnectionPayload(instanceName: string, status: string) {
  return {
    event: 'connection.update',
    instance: instanceName,
    data: { state: status },
  };
}

test('first connection sends disclaimer + welcome message', async () => {
  const payload = createConnectionPayload('SchedWhats-393501234567', 'open');

  // Mock: user_instances has welcome_sent = false
  mockSupa.setResponse('user_instances:select', [{
    id: 'ui-1',
    phone_number: '393501234567',
    instance_name: 'SchedWhats-393501234567',
    welcome_sent: false,
  }]);
  mockSupa.setResponse('user_instances:update', [{ id: 'ui-1' }]);

  const res = await callWebhook(payload);
  const body = await res.json();
  expect(body.ok).toBe(true);

  // Should send 2 messages: disclaimer + welcome
  const sendCalls = fetchMock.calls.filter((c: any) => c.url.includes('/message/sendText/'));
  expect(sendCalls.length).toBeGreaterThanOrEqual(2);
});
```

Adapt to match the actual webhook payload structure discovered in Step 1-2.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest __tests__/webhook.integration.test.ts -t "first connection" --no-coverage`
Expected: FAIL

- [ ] **Step 5: Add welcome message logic in webhook connection.update handler**

In `webhook/route.ts`, find the `connection.update` handler (where `status === 'open'` is processed). Add:

```typescript
// After connection is confirmed open:
const { data: instance } = await supabase
  .from('user_instances')
  .select('welcome_sent, phone_number')
  .eq('instance_name', instanceName)
  .single();

if (instance && !instance.welcome_sent) {
  // Send disclaimer first
  await notifyOwner(instanceName, instance.phone_number, DISCLAIMER_MESSAGE);
  // Wait 1 second to ensure order
  await new Promise(r => setTimeout(r, 1000));
  // Send welcome message
  await notifyOwner(instanceName, instance.phone_number, WELCOME_MESSAGE);
  // Mark as sent
  await supabase
    .from('user_instances')
    .update({ welcome_sent: true })
    .eq('instance_name', instanceName);
}
```

Add the `DISCLAIMER_MESSAGE` constant (next to `WELCOME_MESSAGE`):
```typescript
const DISCLAIMER_MESSAGE = `⚠️ Importante: WhatsLater usa la funzione "Dispositivi Collegati" di WhatsApp.
Un uso responsabile protegge il tuo numero.

• Max 20-30 messaggi mirati al giorno
• Solo a contatti che ti conoscono
• Nessun invio massivo o spam

Leggi i termini completi: https://whatslaterpush.vercel.app/terms

WhatsLater non e affiliato a Meta/WhatsApp.`;
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest __tests__/webhook.integration.test.ts -t "first connection" --no-coverage`
Expected: PASS

- [ ] **Step 7: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass (88+ tests).

- [ ] **Step 8: Commit**

```bash
git add app/api/webhook/route.ts __tests__/webhook.integration.test.ts
git commit -m "feat: send disclaimer + welcome on first WhatsApp connection"
```

---

## Chunk 6: Final Verification

### Task 21: Full build and test verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All tests pass.

- [ ] **Step 2: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Search for remaining old copy**

Run these searches to verify all micro-copy is updated:
```bash
# Should return NO matches:
grep -rn "Scrivi Ora" app/components/ --include="*.tsx"
grep -rn "Invia Dopo" app/components/ --include="*.tsx"
grep -rn "vCard" app/components/ app/tutorial/ --include="*.tsx"
grep -rn "Gestisci abbonamento" app/ --include="*.tsx"
grep -rn "#connetti" app/ --include="*.tsx"
grep -rn "gsap\|ScrollTrigger\|TextPlugin" app/ --include="*.tsx" --include="*.ts"
grep -rn "Connetti Ora" app/ --include="*.tsx"

# May have LEGITIMATE matches (not errors):
# - "Connetti WhatsApp" in HowItWorksSection (step title) — OK
# - "SchedWhats" in webhook/route.ts (instance names) — OK
# - "QR" in dashboard (secondary option label) — OK if in "Preferisci inquadrare un codice?" context
```

- [ ] **Step 4: Mobile first audit**

Run: `npm run dev`
Open `http://localhost:3000` at 390px viewport width and verify:
- All buttons are minimum 48px height (`h-12`)
- Body text is minimum 16px (`text-base`)
- Touch targets are at least 44x44px
- No horizontal scrolling
- StatsBar stacks vertically on mobile
- HowItWorks steps stack vertically on mobile

Fix any violations found.

- [ ] **Step 5: Visual smoke test**

At both mobile (390px) and desktop viewports verify:
- Landing page loads with new hero copy and phone animation
- StatsBar shows 3 numbers
- How It Works shows 3 simple steps
- No Features or Philosophy sections
- No `#connetti` section
- FAQ has plain Italian, no jargon
- Footer has updated tagline
- Dashboard loads with updated micro-copy
- Status colors show correctly for all states
- Banner shows for disconnect/limit/trial conditions
- FAB "?" shows for returning users, inline instructions for new users

- [ ] **Step 6: Final commit (if any remaining fixes)**

```bash
git add -A
git commit -m "fix: final UX redesign cleanup"
```
