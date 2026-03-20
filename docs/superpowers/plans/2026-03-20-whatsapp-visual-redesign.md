# WhatsApp-Native Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the WhatsLater landing page to look and feel like a native WhatsApp feature using WhatsApp's real color palette, patterns, and UI conventions.

**Architecture:** Pure frontend changes across 10 existing files. No backend, API, or database changes. Each task modifies one file independently. Tasks 1-3 are foundational (design tokens, CSS, layout), tasks 4-10 are component-level and can be done in any order after 1-3.

**Tech Stack:** Next.js 14, Tailwind CSS, Lucide React icons, custom SVG

---

## Chunk 1: Foundation

### Task 1: Update Tailwind Design Tokens

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Add new color tokens and update background**

Replace the `colors` block in `tailwind.config.ts` (lines 11-21) with:

```typescript
colors: {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  primary: '#25D366',
  'primary-hover': '#1DA851',
  accent: '#075E54',
  teal: '#128C7E',
  'chat-green': '#DCF8C6',
  'chat-beige': '#ECE5DD',
  'wa-blue': '#53BDEB',
  'text-primary': '#111B21',
  'text-secondary': '#667781',
  'border-soft': '#E9EDEF',
  'soft-red': '#FF6B6B',
},
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat: add WhatsApp color tokens (teal, chat-green, chat-beige, wa-blue)"
```

---

### Task 2: Update Global CSS

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Remove phone animation keyframes and add WhatsApp pattern**

Replace the entire content of `app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  * {
    @apply border-border-soft;
  }

  body {
    @apply bg-white text-text-primary;
  }
}

@layer utilities {
  /* Smooth scrolling */
  html {
    scroll-behavior: smooth;
  }

  /* Custom scrollbar */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    @apply bg-transparent;
  }

  ::-webkit-scrollbar-thumb {
    @apply bg-text-secondary/20 rounded-full;
  }

  ::-webkit-scrollbar-thumb:hover {
    @apply bg-text-secondary/30;
  }

  /* Focus styles */
  .focus-ring {
    @apply focus:outline-none focus:ring-2 focus:ring-primary/20 focus:ring-offset-2 focus:ring-offset-white;
  }

  /* Animation utilities */
  .animate-in {
    animation: animateIn 0.3s ease-out;
  }

  @keyframes animateIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
}

/* Selection styles */
::selection {
  @apply bg-primary/20 text-text-primary;
}

/* Placeholder styles */
::placeholder {
  @apply text-text-secondary/50;
}

/* Fade-in-up for scroll reveal */
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

/* WhatsApp subtle background pattern */
.wa-pattern {
  position: relative;
}
.wa-pattern::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.04;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='1.5' opacity='1'%3E%3Ccircle cx='25' cy='25' r='6'/%3E%3Cpath d='M23 25h4'/%3E%3Cpath d='M25 22v3'/%3E%3Crect x='70' y='15' width='12' height='15' rx='2'/%3E%3Ccircle cx='76' cy='26' r='1.5'/%3E%3Cpath d='M140 20a5 5 0 1 1-10 0 5 5 0 0 1 10 0z'/%3E%3Cpath d='M135 17v3l2 1'/%3E%3Cpath d='M30 80l5 5 10-10'/%3E%3Ccircle cx='90' cy='75' r='6'/%3E%3Cpath d='M88 75h4'/%3E%3Cpath d='M90 72v3'/%3E%3Crect x='145' y='70' width='12' height='15' rx='2'/%3E%3Ccircle cx='151' cy='81' r='1.5'/%3E%3Cpath d='M50 140a5 5 0 1 1-10 0 5 5 0 0 1 10 0z'/%3E%3Cpath d='M45 137v3l2 1'/%3E%3Cpath d='M110 130l5 5 10-10'/%3E%3Ccircle cx='170' cy='135' r='6'/%3E%3Cpath d='M168 135h4'/%3E%3Cpath d='M170 132v3'/%3E%3Crect x='15' y='170' width='12' height='15' rx='2'/%3E%3Ccircle cx='21' cy='181' r='1.5'/%3E%3Cpath d='M85 175a5 5 0 1 1-10 0 5 5 0 0 1 10 0z'/%3E%3Cpath d='M80 172v3l2 1'/%3E%3Cpath d='M155 170l5 5 10-10'/%3E%3C/g%3E%3C/svg%3E");
  background-repeat: repeat;
  z-index: 0;
}
.wa-pattern > * {
  position: relative;
  z-index: 1;
}
```

Key changes:
- Removed `phoneFrame4` keyframes (lines 88-103 of old file)
- Removed `.phone-frame` rules (lines 95-103 of old file)
- Changed `bg-background` to `bg-white` in body rule
- Changed `focus:ring-offset-background` to `focus:ring-offset-white`
- Added `.wa-pattern` class with SVG background at 4% opacity

- [ ] **Step 2: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: add WhatsApp background pattern, remove phone animation CSS"
```

---

### Task 3: Update Root Layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Change body background class**

In `app/layout.tsx` line 28, change:
```tsx
<body className="font-sans antialiased bg-[#F3F5F7] text-[#111B21] selection:bg-[#25D366]/20 selection:text-[#075E54]">
```
to:
```tsx
<body className="font-sans antialiased bg-white text-[#111B21] selection:bg-[#25D366]/20 selection:text-[#075E54]">
```

- [ ] **Step 2: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: change body background from gray to white"
```

---

## Chunk 2: Navigation & Hero

### Task 4: Redesign Navbar

**Files:**
- Modify: `app/components/Navbar.tsx`

- [ ] **Step 1: Rewrite Navbar.tsx**

Replace the entire content of `app/components/Navbar.tsx` with:

```tsx
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`fixed top-0 left-0 right-0 z-40 bg-[#075E54] transition-shadow duration-300 ${
      scrolled ? 'shadow-md' : ''
    }`}>
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-white font-heading font-bold text-lg">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="#25D366" stroke="#25D366" strokeWidth="0.5"/>
          </svg>
          WhatsLater
        </Link>

        <div className="hidden md:flex items-center gap-8">
          <a href="#come-funziona" className="text-sm text-white/70 hover:text-white transition-colors">Come Funziona</a>
          <a href="#prezzi" className="text-sm text-white/70 hover:text-white transition-colors">Prezzi</a>
          <a href="#faq" className="text-sm text-white/70 hover:text-white transition-colors">FAQ</a>
        </div>

        <Link
          href="/dashboard"
          className="bg-primary text-white px-5 h-12 flex items-center rounded-full text-sm font-semibold border border-white/20 hover:bg-primary-hover transition-colors"
        >
          <span className="hidden sm:inline">Programma i messaggi gratis</span>
          <span className="sm:hidden">Inizia gratis</span>
        </Link>
      </div>
    </nav>
  );
}
```

Key changes:
- Removed `Calendar` import from lucide-react
- Background: fixed `bg-[#075E54]`, no blur/transparency
- Scroll: only adds `shadow-md`, no background change
- Logo: custom SVG chat bubble (WhatsApp style) + white text
- Nav links: `text-white/70 hover:text-white`
- CTA: added `border border-white/20`

- [ ] **Step 2: Verify visually in dev**

Run: `npx next dev` and check http://localhost:3000
Expected: Dark green navbar, white logo/links, green CTA button

- [ ] **Step 3: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 4: Commit**

```bash
git add app/components/Navbar.tsx
git commit -m "feat: redesign navbar with WhatsApp dark green theme"
```

---

### Task 5: Redesign Hero Section

**Files:**
- Modify: `app/components/HeroSection.tsx`

- [ ] **Step 1: Rewrite HeroSection.tsx with static phone mockup**

Replace the entire content of `app/components/HeroSection.tsx` with:

```tsx
'use client';
import Link from 'next/link';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-b from-[#075E54] to-[#128C7E] overflow-hidden pt-16 wa-pattern">
      <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        {/* Text */}
        <div className="text-center md:text-left">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white leading-tight">
            I tuoi clienti non dimenticano piu l&apos;appuntamento.
          </h1>
          <p className="mt-4 text-lg text-[#25D366] font-medium leading-relaxed">
            Il promemoria parte da WhatsApp, dal tuo numero, in automatico.
          </p>
          <p className="mt-3 text-sm text-white/50">
            Setup in 2 minuti &middot; Nessuna app da installare
          </p>
          <div className="mt-8">
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center bg-primary text-white px-8 h-14 rounded-full text-base font-bold shadow-lg shadow-primary/30 hover:bg-primary-hover transition-colors"
            >
              Inizia a programmare i messaggi
            </Link>
          </div>
          <p className="mt-3 text-xs text-white/40">Nessuna carta richiesta</p>
        </div>

        {/* Phone mockup — static WhatsApp chat */}
        <div className="flex justify-center">
          <div className="w-[260px] bg-[#0b141a] rounded-[2rem] border-2 border-white/10 overflow-hidden p-3">
            <div className="rounded-2xl overflow-hidden">
              {/* Chat header */}
              <div className="bg-[#075E54] px-3 py-2.5 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center">
                  <span className="text-white text-xs font-bold">W</span>
                </div>
                <div className="flex-1">
                  <div className="text-white text-xs font-semibold">WhatsLater</div>
                  <div className="text-[#93cfc4] text-[9px]">online</div>
                </div>
              </div>

              {/* Chat area */}
              <div className="bg-[#ECE5DD] p-3 space-y-2.5" style={{ minHeight: '320px' }}>
                {/* User bubble (right) */}
                <div className="flex justify-end">
                  <div className="bg-[#DCF8C6] rounded-lg rounded-tr-none px-2.5 py-1.5 max-w-[85%]">
                    <p className="text-[11px] text-[#111B21] leading-relaxed">
                      Invia a Marco domani alle 15: Ricorda l&apos;appuntamento! 📅
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[8px] text-[#667781]">10:23</span>
                      <span className="text-[8px] text-[#53BDEB]">✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Bot reply (left) */}
                <div className="flex justify-start">
                  <div className="bg-white rounded-lg rounded-tl-none px-2.5 py-1.5 max-w-[85%]">
                    <p className="text-[11px] text-[#111B21] leading-relaxed whitespace-pre-line">{`✅ Perfetto! Invierò a Marco\ndomani alle 15:00:\n"Ricorda l'appuntamento!"`}</p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[8px] text-[#667781]">10:23</span>
                      <span className="text-[8px] text-[#53BDEB]">✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Separator — Marco receives */}
                <div className="flex justify-center">
                  <div className="bg-[#E2F7CB] rounded-md px-3 py-0.5">
                    <span className="text-[9px] text-[#667781]">📨 Messaggio per Marco Rossi</span>
                  </div>
                </div>

                {/* Marco's received message (left) */}
                <div className="flex justify-start">
                  <div className="bg-white rounded-lg rounded-tl-none px-2.5 py-1.5 max-w-[85%]">
                    <p className="text-[11px] text-[#111B21] leading-relaxed">
                      Ciao! Ricorda l&apos;appuntamento di domani alle 15 🗓️
                    </p>
                    <div className="flex items-center justify-end gap-1 mt-0.5">
                      <span className="text-[8px] text-[#667781]">15:00</span>
                      <span className="text-[8px] text-[#53BDEB]">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Input bar */}
              <div className="bg-[#f0f0f0] px-2.5 py-1.5 flex items-center gap-2">
                <div className="flex-1 bg-white rounded-full px-3 py-1.5">
                  <span className="text-[10px] text-[#999]">Scrivi un messaggio</span>
                </div>
                <div className="w-7 h-7 rounded-full bg-[#25D366] flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

Key changes:
- Gradient: `from-[#075E54] to-[#128C7E]` (was `from-accent to-text-primary`)
- Added `wa-pattern` class for subtle background
- Phone mockup: completely rewritten as static WhatsApp chat
  - Light theme (beige bg, green/white bubbles)
  - 3 bubbles: user command, bot confirmation, Marco receives
  - Separator badge between bot reply and Marco's message
  - Input bar with mic button
- Removed all 4 `.phone-frame` divs and animation logic

- [ ] **Step 2: Verify visually in dev**

Run: `npx next dev` and check http://localhost:3000
Expected: Teal gradient hero, static phone with 3 WhatsApp bubbles, pattern overlay

- [ ] **Step 3: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 4: Commit**

```bash
git add app/components/HeroSection.tsx
git commit -m "feat: redesign hero with static WhatsApp chat mockup"
```

---

## Chunk 3: Content Sections

### Task 6: Update Stats Bar

**Files:**
- Modify: `app/components/StatsBar.tsx`

- [ ] **Step 1: Change background color**

In `app/components/StatsBar.tsx` line 9, change:
```tsx
<section className="bg-text-primary py-10">
```
to:
```tsx
<section className="bg-[#25D366] py-10">
```

- [ ] **Step 2: Update label text opacity**

In `app/components/StatsBar.tsx` line 19, change:
```tsx
<div className="text-sm text-white/70 mt-1">{stat.label}</div>
```
to:
```tsx
<div className="text-sm text-white/80 mt-1">{stat.label}</div>
```

- [ ] **Step 3: Update divider border color**

In `app/components/StatsBar.tsx` line 15, change:
```tsx
i < stats.length - 1 ? 'sm:border-r sm:border-white/20' : ''
```
to:
```tsx
i < stats.length - 1 ? 'sm:border-r sm:border-white/30' : ''
```

- [ ] **Step 4: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 5: Commit**

```bash
git add app/components/StatsBar.tsx
git commit -m "feat: stats bar green WhatsApp background"
```

---

### Task 7: Redesign How It Works Section

**Files:**
- Modify: `app/components/HowItWorksSection.tsx`

- [ ] **Step 1: Rewrite HowItWorksSection.tsx**

Replace the entire content of `app/components/HowItWorksSection.tsx` with:

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { LogIn, MessageSquare, Check } from 'lucide-react';

const steps = [
  {
    icon: LogIn,
    number: 1,
    title: 'Collega il tuo WhatsApp',
    description: 'Inserisci il codice a 8 cifre su WhatsApp — ci vogliono 30 secondi',
  },
  {
    icon: MessageSquare,
    number: 2,
    title: 'Scrivi il Comando',
    description: "Manda un messaggio a te stesso: 'Invia a Marco domani alle 15...'",
  },
  {
    icon: Check,
    number: 3,
    title: 'Consegnato',
    description: 'Il messaggio parte all\'ora giusta, dal tuo numero, in automatico',
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
    <section id="come-funziona" ref={sectionRef} className="py-24 bg-[#ECE5DD] wa-pattern">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary">
            Come Funziona
          </h2>
          <p className="text-text-secondary mt-2">3 passi e sei operativo</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="step-card bg-white rounded-2xl p-6 text-center shadow-soft opacity-0" style={{ animationDelay: `${i * 150}ms` }}>
              <div className="w-14 h-14 mx-auto rounded-full bg-[#25D366]/12 flex items-center justify-center mb-3">
                <step.icon className="w-7 h-7 text-[#25D366]" />
              </div>
              <div className="w-6 h-6 mx-auto rounded-full bg-[#25D366] text-white text-xs font-bold flex items-center justify-center mb-3">
                {step.number}
              </div>
              <h3 className="text-base font-bold text-text-primary mb-1">{step.title}</h3>
              <p className="text-sm text-text-secondary">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

Key changes:
- Background: `bg-[#ECE5DD] wa-pattern` (beige with subtle pattern)
- Icons: `LogIn`, `MessageSquare`, `Check` (was `Link2`, `MessageSquare`, `Bell`)
- Added step numbers (green circles)
- Cards: `bg-white rounded-2xl shadow-soft`
- Updated copy: Step 1 title/description per user feedback
- Added subtitle "3 passi e sei operativo"
- Icon containers: circular (`rounded-full`) with green tint bg

- [ ] **Step 2: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 3: Commit**

```bash
git add app/components/HowItWorksSection.tsx
git commit -m "feat: redesign Come Funziona with beige bg and WhatsApp icons"
```

---

### Task 8: Update Pricing Section

**Files:**
- Modify: `app/components/PricingSection.tsx`

- [ ] **Step 1: Change section background**

In `app/components/PricingSection.tsx` line 53, change:
```tsx
<section id="prezzi" className="py-24 bg-background">
```
to:
```tsx
<section id="prezzi" className="py-24 bg-white">
```

- [ ] **Step 2: Change Free and Business card borders**

In `app/components/PricingSection.tsx` line 60, change:
```tsx
<div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
```
to:
```tsx
<div className="bg-white rounded-2xl p-6 border border-[#E9EDEF] shadow-sm">
```

In `app/components/PricingSection.tsx` line 107, change:
```tsx
<div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
```
to:
```tsx
<div className="bg-white rounded-2xl p-6 border border-[#E9EDEF] shadow-sm">
```

- [ ] **Step 3: Change Business button color**

In `app/components/PricingSection.tsx` line 124, change:
```tsx
<button onClick={() => handleCheckout('business')} className="w-full bg-gray-900 text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-md">
```
to:
```tsx
<button onClick={() => handleCheckout('business')} className="w-full bg-[#075E54] text-white py-2.5 rounded-xl font-semibold hover:scale-[1.02] transition-transform shadow-md">
```

- [ ] **Step 3: Change Free card checklist icon color**

In `app/components/PricingSection.tsx`, the Free card uses `text-gray-400` for CheckCircle2 icons (lines 67-70). Change all four instances from:
```tsx
<CheckCircle2 className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
```
to:
```tsx
<CheckCircle2 className="w-4 h-4 text-[#667781] mt-0.5 shrink-0" />
```

- [ ] **Step 5: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 6: Commit**

```bash
git add app/components/PricingSection.tsx
git commit -m "feat: pricing white bg, Business button #075E54"
```

---

### Task 9: Update FAQ Section

**Files:**
- Modify: `app/components/FAQSection.tsx`

- [ ] **Step 1: Update section background and question colors**

Replace the entire content of `app/components/FAQSection.tsx` with:

```tsx
'use client';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

const faqs = [
  { q: "E sicuro collegare WhatsApp?", a: "I tuoi dati sono protetti con la massima sicurezza. Nessuno puo leggere i tuoi messaggi." },
  { q: "Come collego WhatsApp?", a: "Inserisci il tuo numero di telefono e segui le istruzioni. Ci vogliono 30 secondi." },
  { q: "E se il telefono e spento?", a: "I messaggi programmati partono anche se il telefono e spento." },
  { q: "Posso annullare un messaggio programmato?", a: "Si, dalla dashboard clicca 'Annulla invio' su qualsiasi messaggio non ancora inviato." },
  { q: "Come capisce gli orari?", a: "Scrivi normalmente: 'domani alle 15', 'lunedi mattina', 'tra 2 ore'. WhatsLater capisce automaticamente." },
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <section id="faq" className="py-24 bg-white">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="font-heading text-3xl sm:text-4xl font-bold text-text-primary mb-12 text-center">Domande Frequenti</h2>
        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm border border-[#E9EDEF] overflow-hidden">
              <button
                className={cn(
                  "w-full px-6 py-5 text-left font-semibold flex justify-between items-center focus:outline-none transition-colors",
                  openIndex === i ? "text-[#075E54]" : "text-[#111B21]"
                )}
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
              >
                {faq.q}
                <ChevronDown className={cn(
                  "w-5 h-5 transition-all duration-300",
                  openIndex === i ? "rotate-180 text-[#25D366]" : "text-[#667781]"
                )} />
              </button>
              <div
                className={cn("px-6 overflow-hidden transition-all duration-300 ease-in-out", openIndex === i ? "max-h-40 pb-5 opacity-100" : "max-h-0 opacity-0")}
              >
                <p className="text-text-secondary text-sm leading-relaxed">{faq.a}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

Key changes:
- Section background: `bg-white` (was `bg-background`)
- Card border: `border-[#E9EDEF]` (was `border-gray-100`)
- Open question text: `text-[#075E54]` (was same as closed)
- Open chevron: `text-[#25D366]` (was `text-gray-400`)
- Closed chevron: `text-[#667781]` (was `text-gray-400`)

- [ ] **Step 2: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 3: Commit**

```bash
git add app/components/FAQSection.tsx
git commit -m "feat: FAQ green accent on open questions"
```

---

## Chunk 4: Footer & Final

### Task 10: Redesign Footer

**Files:**
- Modify: `app/components/Footer.tsx`

- [ ] **Step 1: Rewrite Footer.tsx**

Replace the entire content of `app/components/Footer.tsx` with:

```tsx
'use client';

export default function Footer() {
  return (
    <footer className="bg-[#075E54] text-white rounded-t-[4rem] pt-20 pb-10 px-6 mt-20">
      <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
        <div className="flex items-center gap-2 font-heading font-bold text-2xl tracking-tight mb-4">
          <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" fill="#25D366" stroke="#25D366" strokeWidth="0.5"/>
          </svg>
          <span>WhatsLater</span>
        </div>
        <p className="text-white/50 mb-12">Promemoria WhatsApp automatici, dal tuo numero.</p>

        <div className="flex flex-wrap justify-center gap-8 text-sm font-medium text-white/60 mb-16">
          <a href="/privacy" className="hover:text-white transition-colors">Privacy Policy</a>
          <a href="/terms" className="hover:text-white transition-colors">Termini di Servizio</a>
          <a href="mailto:supporto@whatslaterpush.vercel.app" className="hover:text-white transition-colors">Contatti</a>
        </div>

        <div className="text-xs text-white/30 space-y-2">
          <p>Made in Italy - Hosted on EU servers</p>
          <p>Copyright &copy; 2026 WhatsLater</p>
        </div>
      </div>
    </footer>
  );
}
```

Key changes:
- Background: `bg-[#075E54]` (was `bg-text-primary` / #111B21)
- Logo: SVG chat bubble (same as navbar) instead of Calendar
- Removed Calendar import from lucide-react
- Tagline color: `text-white/50` (was `text-gray-400`)
- Links: `text-white/60 hover:text-white` (was `text-gray-300`)
- Bottom text: `text-white/30` (was `text-gray-500`)

- [ ] **Step 2: Run tests**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 3: Commit**

```bash
git add app/components/Footer.tsx
git commit -m "feat: footer WhatsApp green theme with chat bubble logo"
```

---

### Task 11: Final Verification & Deploy

**Files:**
- None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx jest --no-coverage`
Expected: All 88 tests pass

- [ ] **Step 2: Run build**

Run: `npx next build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Visual check all sections**

Run: `npx next dev` and verify at http://localhost:3000:
- Navbar: dark green #075E54, chat bubble logo, white links
- Hero: teal gradient, static phone with 3 bubbles, wa-pattern
- Stats bar: green #25D366
- Come Funziona: beige bg, white cards, green icons, wa-pattern
- Pricing: white bg, Business button #075E54
- FAQ: green accent on open questions
- Footer: dark green #075E54, chat bubble logo

- [ ] **Step 4: Push to deploy**

```bash
git push
```

Expected: Vercel auto-deploys from main branch
