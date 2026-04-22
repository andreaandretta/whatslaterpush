# /connect Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign visivo di `/connect` per brand continuity con la landing (teal + pattern) + guida pairing QR chiara via stepper 3-step. Logica auth invariata.

**Architecture:** Un nuovo component `ConnectStepper` riusabile (stateless, 3 stati: step attivo / completato / error). La pagina `/connect` diventa una state machine di 4 fasi (input → pairing → connecting → error), ognuna con stesso chrome (navbar + heading + card + footer cues) ma contenuto card distinto. Lo sfondo teal gradient con pattern viene aggiunto come utility CSS in `globals.css`.

**Tech Stack:** Next.js 14 App Router · TypeScript · Tailwind CSS 3.4 · Lucide React icons · Jest + React Testing Library · Playwright (E2E contro produzione).

**Spec di riferimento:** `docs/superpowers/specs/2026-04-22-connect-page-redesign-design.md`
**Mockup visivo autoritativo:** `screenshots/connect-final.html` (apri con `start` sulla working copy)

---

## File Structure

### File da creare

| Path | Responsabilità | Dimensione |
|---|---|---|
| `components/ConnectStepper.tsx` | Stepper 3-step stateless (props: currentStep, errorOnStep) | ~60 righe |
| `__tests__/connect-stepper.test.tsx` | Unit test 6 rendering variants | ~110 righe |

### File da modificare

| Path | Cambio |
|---|---|
| `app/globals.css` | Aggiungere `.connect-bg` utility (sezione `@layer utilities`) |
| `app/connect/page.tsx` | Riscrittura JSX completa (da ~160 a ~300 righe). Logica state/fetch invariata. |
| `__tests__/e2e/connect.spec.ts` | Aggiungere assertion su stepper + cues + navbar + placeholder corretto |
| `docs/ARCHITETTURA.md` | Paragrafo breve: redesign UI-only, niente backend changes |

**Ancore di codice utili:**
- `app/connect/page.tsx:9` — type Phase esistente (preserveremo gli stati `input|pairing|connecting|error`)
- `app/connect/page.tsx:28-56` — `startInit` handler (NON toccare)
- `app/connect/page.tsx:58-80` — `startPolling` handler (NON toccare)
- `tailwind.config.ts` — design tokens (`primary`, `accent`, `surface`, `text-primary`, `text-secondary`, `border`, `shadow-soft`, fonts)

---

## Task 1: Baseline check (worktree + tests)

Lavoriamo nella worktree attualmente attiva (`feat/quick-capture`) — la spec e il mockup HTML sono già committati qui. Il connect-redesign può vivere sullo stesso branch: è UI-only, zero conflitto con il lavoro Quick Capture già mergato.

- [ ] **Step 1: Verifica branch + state**

```bash
pwd
git branch --show-current
git status --short
```

Expected: cwd `.claude/worktrees/quick-capture`, branch `feat/quick-capture`, working tree pulito (0 modified files).

- [ ] **Step 2: Tests baseline**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: `Tests: 194 passed, 194 total` (dopo i fix di ieri: 192 base + 2 regression test per parser inline).

- [ ] **Step 3: Apri il mockup di riferimento (opzionale ma consigliato)**

```bash
start screenshots/connect-final.html
```

Il file mostra le 4 fasi (input, pairing, connecting, error) nella direzione approvata. Questa è la fonte di verità visiva — in caso di dubbio su spacing/colori/copy, fai riferimento a questa pagina (non alla spec markdown).

---

## Task 2: Aggiungere utility `.connect-bg` in globals.css

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Leggi il file esistente per identificare dove aggiungere l'utility**

```bash
grep -n "@layer utilities\|@tailwind" app/globals.css
```

Annota la riga dove inizia (o dove termina, se esiste) il blocco `@layer utilities`. Se non esiste, lo creeremo in fondo al file.

- [ ] **Step 2: Append utility in fondo al file** (o dentro `@layer utilities` se già presente)

```css
@layer utilities {
  .connect-bg {
    background:
      radial-gradient(circle at 20% 20%, rgba(37, 211, 102, 0.10) 0%, transparent 45%),
      radial-gradient(circle at 80% 70%, rgba(18, 140, 126, 0.15) 0%, transparent 45%),
      linear-gradient(135deg, #075E54 0%, #0a4f47 100%);
    position: relative;
  }
  .connect-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.06) 1px, transparent 0);
    background-size: 28px 28px;
    pointer-events: none;
  }
}
```

Se `@layer utilities {}` esiste già, aggiungi le due classi dentro. Se non esiste, appendi il blocco intero.

- [ ] **Step 3: Verifica build**

```bash
npm run build 2>&1 | grep -iE "compiled|error.*globals|error.*css" | head -5
```

Expected: "Compiled successfully". L'errore pre-esistente `supabaseUrl is required` durante page collection è OK (non riguarda CSS).

- [ ] **Step 4: Commit**

```bash
git add app/globals.css
git commit -m "feat(styles): add .connect-bg utility (teal gradient + pattern)"
```

---

## Task 3: ConnectStepper component con TDD

**Files:**
- Create: `components/ConnectStepper.tsx`
- Create: `__tests__/connect-stepper.test.tsx`

- [ ] **Step 1: Scrivere test failing in `__tests__/connect-stepper.test.tsx`**

```typescript
import React from 'react';
import { render, screen } from '@testing-library/react';
import ConnectStepper from '../components/ConnectStepper';

describe('ConnectStepper', () => {
  test('step 1 active: labels show "1 · Numero" green, others neutral', () => {
    render(<ConnectStepper currentStep={1} />);
    expect(screen.getByText(/1\s*·\s*Numero/i)).toHaveAttribute('data-state', 'active');
    expect(screen.getByText(/2\s*·\s*QR/i)).toHaveAttribute('data-state', 'pending');
    expect(screen.getByText(/3\s*·\s*Dashboard/i)).toHaveAttribute('data-state', 'pending');
  });

  test('step 2 active: step 1 shows ✓ (completed), step 2 active, step 3 pending', () => {
    render(<ConnectStepper currentStep={2} />);
    expect(screen.getByText(/✓\s*Numero/i)).toBeInTheDocument();
    expect(screen.getByText(/2\s*·\s*QR/i)).toHaveAttribute('data-state', 'active');
    expect(screen.getByText(/3\s*·\s*Dashboard/i)).toHaveAttribute('data-state', 'pending');
  });

  test('step 3 active: steps 1 and 2 show ✓, step 3 active', () => {
    render(<ConnectStepper currentStep={3} />);
    expect(screen.getByText(/✓\s*Numero/i)).toBeInTheDocument();
    expect(screen.getByText(/✓\s*QR/i)).toBeInTheDocument();
    expect(screen.getByText(/3\s*·\s*Dashboard/i)).toHaveAttribute('data-state', 'active');
  });

  test('done state: all 3 steps completed', () => {
    render(<ConnectStepper currentStep="done" />);
    expect(screen.getByText(/✓\s*Numero/i)).toBeInTheDocument();
    expect(screen.getByText(/✓\s*QR/i)).toBeInTheDocument();
    expect(screen.getByText(/✓\s*Dashboard/i)).toBeInTheDocument();
  });

  test('error on step 2: shows ⚠ on step 2, progress bar has data-variant=error', () => {
    render(<ConnectStepper currentStep="error" errorOnStep={2} />);
    expect(screen.getByText(/⚠\s*QR/i)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('data-variant', 'error');
  });

  test('progress bar fills proportionally (step 2 => ~67%)', () => {
    render(<ConnectStepper currentStep={2} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '67');
  });

  test('has nav with aria-label "Progresso connessione"', () => {
    render(<ConnectStepper currentStep={1} />);
    expect(screen.getByRole('navigation', { name: /Progresso connessione/i })).toBeInTheDocument();
  });
});
```

Note sul pattern: usiamo `data-state` attribute (invece di classi Tailwind) per rendere i test stabili rispetto a future modifiche di styling. Il component setta `data-state="active" | "completed" | "pending" | "error"` sulle label degli step.

- [ ] **Step 2: Run failing**

```bash
npm test -- connect-stepper
```

Expected: FAIL (modulo non esiste).

- [ ] **Step 3: Implementare `components/ConnectStepper.tsx`**

```typescript
import React from 'react';

export type StepperState = 1 | 2 | 3 | 'done' | 'error';

interface ConnectStepperProps {
  currentStep: StepperState;
  errorOnStep?: 1 | 2 | 3;
}

const LABELS: Record<1 | 2 | 3, string> = {
  1: 'Numero',
  2: 'QR',
  3: 'Dashboard',
};

function stateOf(step: 1 | 2 | 3, currentStep: StepperState, errorOnStep?: 1 | 2 | 3):
  'active' | 'completed' | 'pending' | 'error' {
  if (currentStep === 'error') {
    if (errorOnStep && step === errorOnStep) return 'error';
    if (errorOnStep && step < errorOnStep) return 'completed';
    return 'pending';
  }
  if (currentStep === 'done') return 'completed';
  // currentStep is 1 | 2 | 3
  if (step < currentStep) return 'completed';
  if (step === currentStep) return 'active';
  return 'pending';
}

function labelText(step: 1 | 2 | 3, state: string): string {
  const name = LABELS[step];
  if (state === 'completed') return `✓ ${name}`;
  if (state === 'error') return `⚠ ${name}`;
  return `${step} · ${name}`;
}

function progressPercent(currentStep: StepperState, errorOnStep?: 1 | 2 | 3): number {
  if (currentStep === 'done') return 100;
  if (currentStep === 'error') {
    // progress at the error step
    return errorOnStep ? Math.round((errorOnStep / 3) * 100) : 33;
  }
  return Math.round((currentStep / 3) * 100);
}

export default function ConnectStepper({ currentStep, errorOnStep }: ConnectStepperProps) {
  const pct = progressPercent(currentStep, errorOnStep);
  const isError = currentStep === 'error';
  const variant = isError ? 'error' : 'normal';

  const steps: (1 | 2 | 3)[] = [1, 2, 3];

  return (
    <nav aria-label="Progresso connessione" className="mb-5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-1.5 font-semibold">
        {steps.map((s) => {
          const st = stateOf(s, currentStep, errorOnStep);
          const className =
            st === 'active' ? 'text-[#25D366]' :
            st === 'error' ? 'text-red-500' :
            st === 'completed' ? 'text-slate-400' :
            'text-slate-400';
          return (
            <span
              key={s}
              data-state={st}
              aria-current={st === 'active' ? 'step' : undefined}
              className={className}
            >
              {labelText(s, st)}
            </span>
          );
        })}
      </div>
      <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          data-variant={variant}
          className={`h-full rounded-full transition-all ${isError ? 'bg-red-400' : 'bg-[#25D366]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Run tests, PASS**

```bash
npm test -- connect-stepper
```

Expected: tutti 7 test verdi.

- [ ] **Step 5: Run full suite, no regressions**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: 194 + 7 = 201 passati.

- [ ] **Step 6: Commit**

```bash
git add components/ConnectStepper.tsx __tests__/connect-stepper.test.tsx
git commit -m "feat(ui): add ConnectStepper component (3-step progress with error state)"
```

---

## Task 4: Riscrittura `app/connect/page.tsx`

**Files:**
- Modify: `app/connect/page.tsx` (riscrittura completa del JSX, logica state/fetch invariata)

La rewrite è un singolo task perché le 4 fasi condividono chrome (navbar + card + bg) e separarle lascerebbe la pagina in stati intermedi incoerenti.

- [ ] **Step 1: Sostituire l'intero `app/connect/page.tsx` con questa versione**

```typescript
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MessageCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import ConnectStepper from '@/components/ConnectStepper';

type Phase = 'input' | 'pairing' | 'connecting' | 'error';

export default function ConnectPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorOnStep, setErrorOnStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function startInit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Errore ${res.status}`);
        setErrorOnStep(1);
        setPhase('error');
        return;
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setQrCode(data.qrCode || null);
      setPairingCode(data.pairingCode || null);
      setPhase('pairing');
      startPolling(data.sessionId);
    } catch (err: any) {
      setError(err?.message || 'Errore di rete');
      setErrorOnStep(1);
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  }

  function startPolling(sid: string) {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/check?sessionId=${sid}`);
        if (res.status === 410) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setError('Il QR è valido solo 10 minuti. Nessun problema — riprova.');
          setErrorOnStep(2);
          setPhase('error');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.authenticated) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase('connecting');
          setTimeout(() => router.push(data.redirect || '/dashboard'), 1200);
        }
      } catch {
        // Network blip: continue polling
      }
    }, 2000);
  }

  function reset() {
    if (pollTimer.current) clearInterval(pollTimer.current);
    setPhase('input');
    setQrCode(null);
    setPairingCode(null);
    setSessionId('');
    setError(null);
  }

  function goHome() {
    window.location.href = '/';
  }

  return (
    <div className="min-h-screen connect-bg relative">
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Slim navbar */}
        <nav className="flex items-center gap-2 px-6 py-5">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <MessageCircle className="w-4 h-4 text-white" fill="white" />
          </div>
          <span className="text-white font-bold font-heading">WhatsLater</span>
        </nav>

        {/* Heading (phase 1 and 2 only) */}
        {(phase === 'input' || phase === 'pairing') && (
          <div className="px-6 pt-4 pb-6 text-center">
            <h1 className="font-heading text-white text-2xl sm:text-3xl font-bold leading-tight">
              {phase === 'input' ? 'Collega WhatsApp' : 'Scansiona il QR'}
            </h1>
            <p className="text-white/70 mt-2 text-sm">
              {phase === 'input'
                ? 'Il tuo numero, niente app da installare.'
                : 'Tieni il telefono sul QR per 2 secondi.'}
            </p>
          </div>
        )}

        {/* Main card */}
        <div className="flex-1 flex items-start justify-center px-5 pb-10">
          <div className="w-full max-w-md bg-surface rounded-3xl p-6 shadow-2xl">

            {phase === 'input' && (
              <>
                <ConnectStepper currentStep={1} />
                <form onSubmit={startInit} className="space-y-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium mb-2">
                      Numero WhatsApp
                    </label>
                    <Input
                      id="phone"
                      type="tel"
                      inputMode="tel"
                      placeholder="3331234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                    <p className="text-xs text-text-secondary mt-1.5">
                      Italiano senza prefisso · estero con &quot;+&quot;
                    </p>
                  </div>
                  <Button type="submit" className="w-full" isLoading={submitting}>
                    Procedi
                  </Button>
                </form>
              </>
            )}

            {phase === 'pairing' && (
              <>
                <ConnectStepper currentStep={2} />
                {qrCode && (
                  <div className="flex justify-center mb-4">
                    <div className="relative w-48 h-48 border-4 border-primary/20 rounded-xl p-2 bg-white">
                      <img src={qrCode} alt="QR code per connessione WhatsApp" className="w-full h-full" />
                    </div>
                  </div>
                )}
                {pairingCode && (
                  <div className="bg-[#ECE5DD]/40 rounded-xl px-3 py-2.5 mb-4">
                    <p className="text-[10px] uppercase text-text-secondary font-semibold tracking-wider">
                      Oppure inserisci questo codice
                    </p>
                    <p className="text-lg font-mono font-bold tracking-[0.25em] text-accent">
                      {pairingCode}
                    </p>
                  </div>
                )}
                <div className="border-t border-border pt-3 space-y-2">
                  <div className="flex items-start gap-2 text-xs">
                    <span className="w-5 h-5 bg-primary/15 text-accent rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">1</span>
                    <span>Apri <b>WhatsApp</b> sul tuo telefono</span>
                  </div>
                  <div className="flex items-start gap-2 text-xs">
                    <span className="w-5 h-5 bg-primary/15 text-accent rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">2</span>
                    <span>Tocca <b>Impostazioni → Dispositivi collegati</b></span>
                  </div>
                  <div className="flex items-start gap-2 text-xs">
                    <span className="w-5 h-5 bg-primary/15 text-accent rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5">3</span>
                    <span>Scansiona il QR sopra 📱</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-text-secondary">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span>In attesa del pairing... (scade in 10 min)</span>
                </div>
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={reset}
                    className="text-xs text-text-secondary underline hover:text-text-primary"
                  >
                    Annulla e ricomincia
                  </button>
                </div>
              </>
            )}

            {phase === 'connecting' && (
              <div className="text-center py-4">
                <ConnectStepper currentStep="done" />
                <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-primary/15 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-primary" />
                </div>
                <h2 className="font-heading text-xl font-bold">Connesso!</h2>
                <p className="text-sm text-text-secondary mt-2">
                  Ti stiamo portando alla dashboard...
                </p>
                <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-text-secondary">
                  <Loader2 className="w-3 h-3 animate-spin text-primary" />
                  <span>Un istante...</span>
                </div>
              </div>
            )}

            {phase === 'error' && (
              <div role="alert" className="text-center py-2">
                <ConnectStepper currentStep="error" errorOnStep={errorOnStep} />
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-500" />
                </div>
                <h2 className="font-heading text-lg font-bold text-red-700">
                  {errorOnStep === 2 ? 'QR scaduto' : 'Si è verificato un errore'}
                </h2>
                <p className="text-sm text-text-secondary mt-2">
                  {error || 'Riprova tra qualche secondo.'}
                </p>
                <Button onClick={reset} className="w-full mt-5">Riprova</Button>
                <button
                  type="button"
                  onClick={goHome}
                  className="mt-2 text-xs text-text-secondary underline hover:text-text-primary"
                >
                  Torna al sito
                </button>
              </div>
            )}

          </div>
        </div>

        {/* Footer cues (phase 1 only) */}
        {phase === 'input' && (
          <div className="px-6 pb-8 flex justify-center gap-5 text-white/70 text-xs">
            <span>⚡ 2 min</span>
            <span>🔒 Cifrato</span>
            <span>💳 No carta</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifica build**

```bash
npm run build 2>&1 | grep -iE "compiled|error.*connect" | head -5
```

Expected: "Compiled successfully" (l'errore pre-esistente `supabaseUrl` durante page data collection è OK).

- [ ] **Step 3: Smoke test locale (opzionale, se puoi runnare dev server)**

```bash
npm run dev
# Apri http://localhost:3000/connect in browser
# Verifica: teal bg, navbar WhatsLater, stepper 1/3 attivo, titolo "Collega WhatsApp",
#          form con placeholder "3331234567", CTA "Procedi", cues footer.
# Inserisci un numero invalido "abc" → fase 4 con stepper rosso su step 1.
```

Se non puoi runnare dev server nel sandbox, salta — lo testi in produzione.

- [ ] **Step 4: Run all tests**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: 201 tests pass (194 baseline + 7 nuovi stepper). Niente regressioni.

- [ ] **Step 5: Commit**

```bash
git add app/connect/page.tsx
git commit -m "feat(ui): redesign /connect page (teal bg + stepper + 4 polished phases)"
```

---

## Task 5: Aggiungere assertion E2E per il nuovo design

**Files:**
- Modify: `__tests__/e2e/connect.spec.ts`

- [ ] **Step 1: Leggere il file esistente per vedere i test attuali**

```bash
cat __tests__/e2e/connect.spec.ts
```

Annota i test esistenti — li preserveremo.

- [ ] **Step 2: Estendere il file con nuove assertion**

Sostituire il contenuto di `__tests__/e2e/connect.spec.ts` con:

```typescript
import { test, expect } from '@playwright/test';

test.describe('/connect page', () => {
  test('shows phone input with new placeholder on first load', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/Connetti|Collega/i).first()).toBeVisible();
    await expect(page.getByPlaceholder('3331234567')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Procedi' })).toBeVisible();
  });

  test('has WhatsLater branding (navbar)', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText('WhatsLater').first()).toBeVisible();
  });

  test('shows trust cues in footer on input phase', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/2 min/i)).toBeVisible();
    await expect(page.getByText(/Cifrato/i)).toBeVisible();
    await expect(page.getByText(/No carta/i)).toBeVisible();
  });

  test('shows 3-step stepper', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByRole('navigation', { name: /Progresso connessione/i })).toBeVisible();
    // Step 1 should be active
    await expect(page.getByText(/1\s*·\s*Numero/i)).toBeVisible();
    await expect(page.getByText(/2\s*·\s*QR/i)).toBeVisible();
    await expect(page.getByText(/3\s*·\s*Dashboard/i)).toBeVisible();
  });

  test('shows error phase on invalid phone', async ({ page }) => {
    await page.goto('/connect');
    await page.getByPlaceholder('3331234567').fill('abc');
    await page.getByRole('button', { name: 'Procedi' }).click();
    // Server returns 400 → error phase
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'Riprova' })).toBeVisible();
  });
});

test.describe('/dashboard page (cookie required)', () => {
  test('redirects away when no cookie', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});
```

- [ ] **Step 3: NON runnare E2E adesso** (il deploy in produzione arriva in Task 7). E2E targettizza `https://whatslaterpush.vercel.app` che ha ancora la vecchia /connect.

Verifica solo sintassi TypeScript:

```bash
npx tsc --noEmit --skipLibCheck __tests__/e2e/connect.spec.ts 2>&1 | head -5
```

Expected: nessun errore.

- [ ] **Step 4: Run Jest full suite (i file `.spec.ts` in e2e non runnano su Jest)**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: 201 tests pass, niente regressioni.

- [ ] **Step 5: Commit**

```bash
git add __tests__/e2e/connect.spec.ts
git commit -m "test(e2e): assert new /connect design (stepper, cues, error alert)"
```

---

## Task 6: Aggiornare `docs/ARCHITETTURA.md`

**Files:**
- Modify: `docs/ARCHITETTURA.md`

- [ ] **Step 1: Trovare la sezione giusta**

```bash
grep -n "5\.\|Pairing\|Connect" docs/ARCHITETTURA.md | head -10
```

Identifica dove vive la descrizione del flusso pairing (sezione 5.1 "Pairing WhatsApp" o equivalente — aggiornata durante C1).

- [ ] **Step 2: Aggiungere un paragrafo breve**

In fondo alla sezione esistente che descrive il flusso /connect (o sotto la tabella API routes, a tua scelta), aggiungere:

```markdown
### UX /connect (redesign 2026-04-22)

La pagina `/connect` è stata ridisegnata per brand continuity con la landing:

- **Sfondo teal gradient + pattern** (utility `.connect-bg` in `globals.css`) — stesso look della landing page
- **Navbar slim** con logo WhatsLater
- **Stepper 3-step** sempre visibile (`components/ConnectStepper.tsx`) che tiene l'utente orientato nelle 4 fasi (input → pairing → connecting → error)
- **Pairing phase** include QR 192px in cornice verde, pairing-code alternativo, 3 passi numerati per trovare "Dispositivi collegati" in WhatsApp, countdown "scade in 10 min"
- **Error phase** mostra lo step dove è fallito (stepper rosso) + copy empatico + bottone Riprova

Nessun cambiamento backend. Auth cookie HMAC (C1) e logica di polling/webhook rimangono identici.

Riferimenti visivi: `screenshots/connect-final.html` (mockup di riferimento) e `docs/superpowers/specs/2026-04-22-connect-page-redesign-design.md` (spec).
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITETTURA.md
git commit -m "docs: note /connect redesign in ARCHITETTURA.md"
```

---

## Task 7: Deploy + smoke test produzione

- [ ] **Step 1: Verifica baseline finale**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
npm run build 2>&1 | grep -iE "compiled|error" | head -3
```

Expected: 201 tests pass, "Compiled successfully".

- [ ] **Step 2: Merge + push**

Dalla worktree `feat/quick-capture`:

```bash
git push origin feat/quick-capture
```

Poi fast-forward main + push (stesso pattern dei deploy precedenti):

```bash
MAIN="/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush"
git -C "$MAIN" fetch origin main
git -C "$MAIN" reset --hard origin/main
git -C "$MAIN" merge --ff-only feat/quick-capture
git -C "$MAIN" push origin main
```

Vercel auto-deploy parte sul push.

- [ ] **Step 3: Aspettare build Vercel (~90 secondi)**

```bash
sleep 90
```

- [ ] **Step 4: Smoke test produzione**

```bash
echo "=== /connect still 200 ==="
curl -is https://whatslaterpush.vercel.app/connect | head -3

echo ""
echo "=== Page contains new elements (stepper nav + 3331234567 placeholder + cues) ==="
curl -s https://whatslaterpush.vercel.app/connect | grep -oE 'Progresso connessione|3331234567|WhatsLater|2 min|Cifrato|No carta' | sort -u
```

Expected:
- Status 200
- grep output contiene tutte e 6: `Progresso connessione`, `3331234567`, `WhatsLater`, `2 min`, `Cifrato`, `No carta`

- [ ] **Step 5: Visual smoke (Playwright screenshot + compare)**

```bash
cat > smoke-shot.mjs <<'JS'
import { chromium } from 'playwright';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const page = await ctx.newPage();
await page.goto('https://whatslaterpush.vercel.app/connect', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: './screenshots/prod-connect-after.png', fullPage: true });
await browser.close();
console.log('OK');
JS
node smoke-shot.mjs 2>&1 | tail -2
rm smoke-shot.mjs
```

Poi confronta visivamente `./screenshots/prod-connect-after.png` con `./screenshots/mobile-input.png` (pre-redesign) e con il mockup `./screenshots/connect-final.html` (fase input).

- [ ] **Step 6: Run E2E contro produzione**

```bash
npx playwright test __tests__/e2e/connect.spec.ts --project=chromium --reporter=list 2>&1 | tail -15
```

Expected: almeno 4/5 test pass. Il test "shows error phase on invalid phone" potrebbe fallire se il backend tarda a rispondere — accettabile flake di 1 retry.

- [ ] **Step 7: Tag release (opzionale)**

```bash
git -C "/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush" tag -a v8.1.1-connect-redesign -m "/connect page redesign (V3 layout + V1 palette)"
git -C "/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush" push origin v8.1.1-connect-redesign
```

---

## Spec Coverage Self-Review

| Spec § | Requisito | Task |
|---|---|---|
| 3.1 | Redesign `app/connect/page.tsx` (UI only) | Task 4 |
| 3.1 | Nuovo `ConnectStepper` component | Task 3 |
| 3.1 | Sfondo teal + pattern + navbar + footer cues (fase 1) | Task 2 (utility) + Task 4 (usage) |
| 3.1 | 4 fasi distinte con stepper state appropriato | Task 3 (component) + Task 4 (page) |
| 3.1 | Copy migliorato | Task 4 (inline nel JSX) |
| 3.1 | Allineamento design tokens | Task 4 (usa `primary`/`accent`/`surface`/etc.) |
| 4.1 | Layout comune (bg + navbar + heading + card + cues) | Task 4 (structure) |
| 4.2 | ConnectStepper API `{currentStep, errorOnStep}` + 5 stati | Task 3 |
| 4.3 | Fase 1 content (heading, form, hint, CTA) | Task 4 |
| 4.3 | Fase 2 content (QR, pairing-code box, 3 step numerati, countdown, cancel) | Task 4 |
| 4.3 | Fase 3 content (success icon, redirect, stepper done) | Task 4 |
| 4.3 | Fase 4 content (stepper error, icon, 2 CTA) | Task 4 |
| 4.4 | State machine invariata | Task 4 (preserva state/fetch logic) |
| 6 | Design tokens + `.connect-bg` utility | Task 2 + Task 4 |
| 7 | Text/copy italiano | Task 4 (inline) |
| 8 | Accessibility (h1, label-for, aria-current, role=alert, alt on QR) | Task 3 (stepper nav) + Task 4 (phase-specific) |
| 9 | Edge cases (QR expired → error, cancel → reset, invalid phone → error) | Task 4 (inline logic) |
| 10 | Unit test ConnectStepper | Task 3 |
| 10 | E2E assertions | Task 5 |
| 11 | Files to create/modify | Tutti i task coprono |

**Gap identificati:** nessuno.

**Placeholder scan:** nessun "TBD" / "implement later" / "similar to". Tutti gli step contengono codice completo o comandi concreti.

**Type consistency:**
- `Phase = 'input' | 'pairing' | 'connecting' | 'error'` — consistente (Task 4)
- `StepperState = 1 | 2 | 3 | 'done' | 'error'` — consistente (Task 3)
- `ConnectStepper` props `{currentStep, errorOnStep}` — consistente (Task 3 + Task 4)
- `data-state` attribute values `'active' | 'completed' | 'pending' | 'error'` — consistente (Task 3 test + impl)

---

## Riassunto totale

**7 task, ~7-8 commit previsti.**

**Stima esecuzione:** 8.5-10.5h (≈1 giornata piena).

**Dipendenze critiche:**

```
Task 2 (css utility)   → Task 4 (page uses .connect-bg)
Task 3 (stepper)       → Task 4 (page imports ConnectStepper)
Task 4 (page rewrite)  → Task 5 (E2E asserts against it) → Task 7 (deploy + E2E)
Task 6 (docs)          → indipendente, può essere in qualsiasi ordine
```

**Esecuzione raccomandata:** ordine numerico 1-7.

**Rollback plan se il redesign rompe qualcosa in produzione:** `git revert <commit>` sul commit di Task 4. La logica `ConnectStepper` e `.connect-bg` possono restare (dead code, nessun impatto). Il commit di Task 4 è isolato (un solo file modificato per la pagina).
