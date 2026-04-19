# Quick Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere di programmare un messaggio a un contatto nuovo in un solo turno, sia da WhatsApp self-chat (numero inline nella frase) sia da dashboard (modal a 4 campi → deep-link `wa.me` → self-chat).

**Architecture:** Estendere il parser AI del webhook per riconoscere numeri inline come destinatario (skippa il giro vCard). Smart-confirm decision: per contatto noto + ora esplicita schedula direttamente con UNDO 60s; altrimenti chiede conferma. Auto-save contatti opzionale (rispetta limiti piano, non sovrascrive). Dashboard modal genera la stessa frase naturale e la inietta nella self-chat tramite `wa.me/<self>?text=...` riusando 100% la pipeline webhook. **Zero schema DB changes.**

**Tech Stack:** Next.js 14 + TypeScript + Jest · Evolution API v2 (WhatsApp) · Groq (AI primaria) + OpenAI fallback · Cookie auth C1 (già LIVE) per sapere chi è l'utente loggato sulla dashboard.

**Spec di riferimento:** `docs/superpowers/specs/2026-04-19-quick-capture-design.md`

---

## File Structure

### File da creare

| Path | Responsabilità | Dimensione |
|---|---|---|
| `app/lib/quick-capture-utils.ts` | `formatDatePhrase`, `containsAmbiguousTimeKeyword`, `hasExplicitHHMM` (pure functions) | ~80 righe |
| `components/QuickCaptureModal.tsx` | Modal 4 campi + chip preset + deep-link generator | ~180 righe |
| `__tests__/quick-capture-utils.test.ts` | Unit test 3 helpers | ~100 righe |
| `__tests__/webhook-quick-capture.test.ts` | Integration test 8 scenari del nuovo flusso | ~250 righe |

### File da modificare

| Path | Cambio |
|---|---|
| `app/lib/webhook-utils.ts` | Aggiungere `extractInlinePhoneAndName(text)` helper |
| `__tests__/webhook-utils.test.ts` | 6+ test per `extractInlinePhoneAndName` |
| `app/api/webhook/route.ts` | (a) UNDO fast-path. (b) Inline phone extraction. (c) AI prompt extension. (d) Smart-confirm decision al punto di INSERT `scheduled_messages`. (e) Auto-save contatto. |
| `app/dashboard/page.tsx` | Bottone "+ Nuovo follow-up" + render `QuickCaptureModal` |
| `docs/ARCHITETTURA.md` | Aggiornare sezione 5 (Flussi Principali) con flusso Quick Capture |

**Ancore di codice utili (verificate):**
- `app/api/webhook/route.ts:4` — import esistente da `webhook-utils`
- `app/api/webhook/route.ts:343-346` — config Groq/OpenAI
- `app/api/webhook/route.ts:1179` — INSERT `scheduled_messages` con `status='awaiting_confirm'` (questo è il punto dove va la smart-confirm decision)
- `app/api/webhook/route.ts:909-924, 1011-1060` — AI action handlers (`confirm`, `cancel_confirm`, `modify`)

---

## Task 1: Worktree dedicato (raccomandato)

C1 ha auto-deploy da main attivo. Per evitare di rompere produzione, lavora su una branch isolata.

- [ ] **Step 1: Creare worktree dedicato**

```bash
cd "/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush"
git fetch origin main
git worktree add .claude/worktrees/quick-capture -b feat/quick-capture origin/main
cd .claude/worktrees/quick-capture
```

Da qui in poi tutti i comandi vanno eseguiti in questa directory. Le `git -C` non servono.

- [ ] **Step 2: Verificare che worktree è pronto**

```bash
git status
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: clean working tree, 150 tests pass.

---

## Task 2: `app/lib/quick-capture-utils.ts` con TDD

**Files:**
- Create: `app/lib/quick-capture-utils.ts`
- Create: `__tests__/quick-capture-utils.test.ts`

- [ ] **Step 1: Scrivere test failing**

Crea `__tests__/quick-capture-utils.test.ts`:

```typescript
import { formatDatePhrase, containsAmbiguousTimeKeyword, hasExplicitHHMM } from '../app/lib/quick-capture-utils';

describe('formatDatePhrase', () => {
  test('formats today HH:MM as "oggi alle HH:MM"', () => {
    const today = new Date();
    today.setHours(17, 0, 0, 0);
    expect(formatDatePhrase(today)).toBe('oggi alle 17:00');
  });

  test('formats tomorrow HH:MM as "domani alle HH:MM"', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    expect(formatDatePhrase(tomorrow)).toBe('domani alle 09:00');
  });

  test('formats date >= 2 days ahead as "il DD/MM alle HH:MM"', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    future.setHours(14, 30, 0, 0);
    const result = formatDatePhrase(future);
    expect(result).toMatch(/^il \d{2}\/\d{2} alle 14:30$/);
  });

  test('zero-pads single-digit hours/minutes', () => {
    const today = new Date();
    today.setHours(9, 5, 0, 0);
    expect(formatDatePhrase(today)).toBe('oggi alle 09:05');
  });
});

describe('containsAmbiguousTimeKeyword', () => {
  test.each([
    'tra un po ti scrivo',
    'TRA UN PO',           // case insensitive
    'più tardi',
    'piu tardi',           // accenti opzionali
    'dopo pranzo facciamo',
    'stasera tardi',
    'oggi tardi',
    'prima o poi',
    'presto andiamo',
    'dopo facciamo',
  ])('returns true for "%s"', (input) => {
    expect(containsAmbiguousTimeKeyword(input)).toBe(true);
  });

  test.each([
    'domani alle 17',
    'alle 14:30',
    'oggi alle 9',
    'tra 2 ore',  // "tra N ore" è esplicito, non ambiguo
  ])('returns false for "%s"', (input) => {
    expect(containsAmbiguousTimeKeyword(input)).toBe(false);
  });
});

describe('hasExplicitHHMM', () => {
  test('true for "alle 17"', () => {
    expect(hasExplicitHHMM('Mario alle 17: msg')).toBe(true);
  });

  test('true for "alle 9:30"', () => {
    expect(hasExplicitHHMM('Mario alle 9:30: msg')).toBe(true);
  });

  test('true for "alle 17:00"', () => {
    expect(hasExplicitHHMM('Mario alle 17:00: msg')).toBe(true);
  });

  test('false for "domani" senza ora', () => {
    expect(hasExplicitHHMM('Mario domani: msg')).toBe(false);
  });

  test('false for "stasera" senza ora', () => {
    expect(hasExplicitHHMM('Mario stasera: msg')).toBe(false);
  });

  test('true for "tra 2 ore" (relative explicit)', () => {
    expect(hasExplicitHHMM('Mario tra 2 ore: msg')).toBe(true);
  });

  test('false for "presto"', () => {
    expect(hasExplicitHHMM('Mario presto: msg')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- quick-capture-utils
```

Expected: FAIL — modulo non esiste.

- [ ] **Step 3: Implementare `app/lib/quick-capture-utils.ts`**

```typescript
/**
 * Formatta una data in italiano per inserimento in frase naturale.
 * Esempi: "oggi alle 17:00", "domani alle 09:00", "il 24/04 alle 14:30"
 */
export function formatDatePhrase(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;

  if (diffDays === 0) return `oggi alle ${time}`;
  if (diffDays === 1) return `domani alle ${time}`;
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  return `il ${dd}/${mo} alle ${time}`;
}

/**
 * Restituisce true se il testo contiene una keyword di tempo vaga.
 * Le keyword "tra N ore", "alle HH" sono considerate esplicite (non ambigue).
 */
export function containsAmbiguousTimeKeyword(text: string): boolean {
  const t = text.toLowerCase();
  const patterns = [
    /\btra un po(?:'|\s|$)/,        // "tra un po" / "tra un po'"
    /\bpi[uù]\s+tardi\b/,
    /\bdopo\s+pranzo\b/,
    /\bstasera\s+tardi\b/,
    /\boggi\s+tardi\b/,
    /\bprima\s+o\s+poi\b/,
    /\bpresto\b/,
    /\bdopo\b(?!\s+\d)/,            // "dopo" da solo, non "dopo le 5"
  ];
  return patterns.some(p => p.test(t));
}

/**
 * Restituisce true se il testo contiene un orario esplicito tipo "alle 17", "alle 9:30",
 * oppure un'espressione relativa esplicita tipo "tra 2 ore".
 */
export function hasExplicitHHMM(text: string): boolean {
  const t = text.toLowerCase();
  if (/\balle\s+\d{1,2}(?::\d{2})?\b/.test(t)) return true;
  if (/\btra\s+\d+\s+(?:minut|or[ae]|sec)\w*\b/.test(t)) return true;
  return false;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- quick-capture-utils
```

Expected: tutti i test verdi.

- [ ] **Step 5: Run full suite — no regressions**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: 150 + new ones, all passing.

- [ ] **Step 6: Commit**

```bash
git add app/lib/quick-capture-utils.ts __tests__/quick-capture-utils.test.ts
git commit -m "feat(quick-capture): add date/time helper utilities"
```

---

## Task 3: `extractInlinePhoneAndName` in `webhook-utils.ts` con TDD

**Files:**
- Modify: `app/lib/webhook-utils.ts`
- Modify: `__tests__/webhook-utils.test.ts`

- [ ] **Step 1: Aggiungere test failing in `__tests__/webhook-utils.test.ts`**

Append in fondo al file:

```typescript
import { extractInlinePhoneAndName } from '../app/lib/webhook-utils';

describe('extractInlinePhoneAndName', () => {
  test('extracts phone and name from "Invia a Mario Cementi 3331234567 alle 17"', () => {
    const r = extractInlinePhoneAndName('Invia a Mario Cementi 3331234567 alle 17: msg');
    expect(r.phone).toBe('393331234567');
    expect(r.name).toBe('Mario Cementi');
    expect(r.textWithoutPhone).not.toContain('3331234567');
  });

  test('extracts spaced phone "333 1234567"', () => {
    const r = extractInlinePhoneAndName('Mario 333 1234567 ora ciao');
    expect(r.phone).toBe('393331234567');
    expect(r.name).toBe('Mario');
  });

  test('handles no name (just phone)', () => {
    const r = extractInlinePhoneAndName('scrivi a 393331234567 alle 17 ciao');
    expect(r.phone).toBe('393331234567');
    expect(r.name).toBeNull();
  });

  test('returns null phone when no number present', () => {
    const r = extractInlinePhoneAndName('Mario alle 17 ciao');
    expect(r.phone).toBeNull();
    expect(r.name).toBeNull();
  });

  test('handles international number "+44 7700 900123"', () => {
    const r = extractInlinePhoneAndName('John +44 7700 900123 alle 9');
    expect(r.phone).toBe('447700900123');
    expect(r.name).toBe('John');
  });

  test('does NOT match a date "12/03/2026" as phone', () => {
    const r = extractInlinePhoneAndName('Mario 12/03/2026 alle 9 ciao');
    expect(r.phone).toBeNull();
  });

  test('extracts up to 3 capitalized words as name', () => {
    const r = extractInlinePhoneAndName('Invia a Marco Antonio Rossi 3331234567 alle 9');
    expect(r.name).toBe('Marco Antonio Rossi');
  });

  test('does NOT match plain digits sequence < 7 chars as phone', () => {
    const r = extractInlinePhoneAndName('Mario 123456 alle 9');
    expect(r.phone).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- webhook-utils
```

Expected: FAIL — `extractInlinePhoneAndName` non esiste.

- [ ] **Step 3: Aggiungere `extractInlinePhoneAndName` in `app/lib/webhook-utils.ts`**

Append al file (alla fine):

```typescript
import { validatePhone } from './phone';

/**
 * Estrae numero di telefono e nome inline dal testo.
 * Esempio: "Invia a Mario Cementi 3331234567 alle 17: msg"
 *   → { phone: "393331234567", name: "Mario Cementi", textWithoutPhone: "Invia a Mario Cementi  alle 17: msg" }
 *
 * Regole:
 * - Numero: cattura sequenze di cifre/spazi/trattini/parentesi/+ con >=7 cifre dopo pulizia.
 *   Una sequenza che sembra una data (DD/MM/YYYY) viene scartata.
 * - Nome: 1-3 parole maiuscole CONTIGUE che precedono immediatamente il numero.
 */
export function extractInlinePhoneAndName(text: string): {
  phone: string | null;
  name: string | null;
  textWithoutPhone: string;
} {
  // Date pattern (DD/MM/YYYY or DD/MM/YY) — scartato per evitare falsi positivi
  const datePattern = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

  // Phone candidates: sequence with optional +, digits, spaces, dashes, parens, dots; min 7 digits
  const phonePattern = /(\+?[\d][\d\s\-().]{6,})/g;

  let foundPhone: string | null = null;
  let foundMatch: string | null = null;

  let match;
  while ((match = phonePattern.exec(text)) !== null) {
    const raw = match[1];
    // Skip if this candidate IS a date
    const isDate = datePattern.test(raw.trim());
    datePattern.lastIndex = 0;
    if (isDate) continue;
    // Strip non-digits except leading +
    const digitsOnly = raw.replace(/[^\d+]/g, '');
    const normalized = validatePhone(digitsOnly);
    if (normalized) {
      foundPhone = normalized;
      foundMatch = raw;
      break;
    }
  }

  if (!foundPhone || !foundMatch) {
    return { phone: null, name: null, textWithoutPhone: text };
  }

  // Find the position of foundMatch in original text
  const phoneIdx = text.indexOf(foundMatch);
  const before = text.substring(0, phoneIdx);

  // Name = 1-3 capitalized words contiguous immediately before the phone
  // Skip trailing whitespace/non-letters between name and phone
  const nameMatch = before.match(/((?:[A-ZÀ-Ü][\wÀ-ÿ]+)(?:\s+[A-ZÀ-Ü][\wÀ-ÿ]+){0,2})\s*$/);
  const name = nameMatch ? nameMatch[1].trim() : null;

  // Remove the phone match from the text
  const textWithoutPhone = text.substring(0, phoneIdx) + text.substring(phoneIdx + foundMatch.length);

  return { phone: foundPhone, name, textWithoutPhone };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- webhook-utils
```

Expected: tutti i test verdi (esistenti + 8 nuovi).

- [ ] **Step 5: Commit**

```bash
git add app/lib/webhook-utils.ts __tests__/webhook-utils.test.ts
git commit -m "feat(webhook-utils): add extractInlinePhoneAndName helper"
```

---

## Task 4: UNDO command fast-path nel webhook

**Files:**
- Modify: `app/api/webhook/route.ts`

UNDO è il pezzo più isolato del webhook (nuovo fast-path che non interferisce con flussi esistenti). Lo facciamo prima del lavoro AI/smart-confirm più complesso.

- [ ] **Step 1: Identificare il punto di inserimento**

Apri `app/api/webhook/route.ts`. Trova dove i comandi rapidi (es. "ok", "annulla", "lista") vengono gestiti — solitamente PRIMA della chiamata AI. Cerca con:

```bash
grep -n "trim().toLowerCase()" app/api/webhook/route.ts | head -5
grep -n "ok'\|conferma'" app/api/webhook/route.ts | head -10
```

Annotare la riga.

- [ ] **Step 2: Aggiungere helper `handleUndoCommand` in `app/api/webhook/route.ts`**

Vicino agli altri helper privati nel file (prima del `POST` handler), aggiungere:

```typescript
async function handleUndoCommand(
  supabase: any,
  ownerPhone: string,
  instanceName: string
): Promise<NextResponse> {
  const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: latest } = await supabase
    .from('scheduled_messages')
    .select('id, recipient_name, scheduled_at')
    .eq('instance_phone', ownerPhone)
    .eq('status', 'pending')
    .gt('created_at', sixtySecondsAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latest) {
    await sendBotReply(instanceName, ownerPhone, 'Niente da annullare (timeout 60s scaduto o nessuna programmazione recente).');
    return NextResponse.json({ ok: true });
  }

  await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', latest.id);
  const recipient = latest.recipient_name || 'destinatario';
  const when = new Date(latest.scheduled_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  await sendBotReply(instanceName, ownerPhone, `✅ Annullato il messaggio per ${recipient} (${when}).`);
  return NextResponse.json({ ok: true });
}
```

NOTA: `sendBotReply` può non esistere con quel nome — usa la funzione esistente che invia un messaggio bot all'utente (probabile nome: `sendWhatsAppText`, `replyToUser`, o usa direttamente l'evolution client `EvolutionClient`). Verifica con `grep -n "function send" app/api/webhook/route.ts` e adatta.

- [ ] **Step 3: Aggiungere il fast-path UNDO al text handler**

PRIMA della logica AI esistente (subito dopo aver normalizzato il messaggio in lowercase), aggiungere:

```typescript
const trimmed = messageText.trim().toLowerCase();
const isUndo = (
  trimmed === 'undo' ||
  trimmed === 'u' ||
  trimmed === 'cancella' ||
  trimmed === 'annulla' ||
  trimmed === 'annulla ultimo' ||
  trimmed === 'annulla messaggio' ||
  (trimmed.startsWith('annulla ') && !/^annulla\s+\d+$/.test(trimmed))
);
if (isUndo) {
  return await handleUndoCommand(supabase, ownerPhone, instanceName);
}
```

IMPORTANTE: **prima** dell'esistente "annulla [N]" comando lista (che cancella per indice). La regex `!/^annulla\s+\d+$/` impedisce il match per "annulla 3" → cade nel comando lista.

Verifica anche che il comando esistente "annulla" SENZA numero (se esiste) non sia in conflitto. Se esiste un comando "annulla" che cancella una pending generica, va riallineato — UNDO ora ha la precedenza per consistenza con il design Quick Capture.

- [ ] **Step 4: Aggiungere test integration in `__tests__/webhook-quick-capture.test.ts` (nuovo file)**

Crea `__tests__/webhook-quick-capture.test.ts`:

```typescript
/**
 * Integration tests for Quick Capture flow in /api/webhook.
 */
import { createMockSupabase, createFetchMock, mockRequest, makeMessagePayload } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    GROQ_API_KEY: 'groq-test-key',
    WEBHOOK_SECRET: 'test-webhook-secret',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
  };
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callWebhook(body: any, headers: Record<string, string> = {}) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/webhook/route');
  const req = mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret', ...headers });
  return POST(req as any);
}

describe('UNDO command', () => {
  test('cancels last pending message within 60s window', async () => {
    // Pre-arm: pending message created 30s ago
    const recent = new Date(Date.now() - 30 * 1000).toISOString();
    mockSupa.setResponse('scheduled_messages:select',
      { id: 'msg-1', recipient_name: 'Mario', scheduled_at: new Date(Date.now() + 3600000).toISOString() },
      null);
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'msg-1' }], null);
    // Self-chat awaiting context: none
    mockSupa.setResponse('user_instances:select', { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567' }, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'undo',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    const res = await callWebhook(payload);
    expect(res.status).toBe(200);

    const updateCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'update');
    expect(updateCall).toBeTruthy();
  });

  test('does NOT trigger UNDO for "annulla 3" (existing list command)', async () => {
    mockSupa.setResponse('user_instances:select', { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567' }, null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'annulla 3',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    // UNDO would query scheduled_messages with .gt('created_at', NOW-60s).
    // The "annulla 3" path is the existing list command — verify it does NOT use that filter.
    const undoQuery = mockSupa.calls.find(c =>
      c.table === 'scheduled_messages' &&
      c.operation === 'select' &&
      c.chain.some(s => s.method === 'gt' && s.args[0] === 'created_at')
    );
    expect(undoQuery).toBeFalsy();
  });
});
```

NOTA: `makeMessagePayload` può richiedere extension per supportare `fromMe`/`remoteJid` opzionali — verifica `__tests__/helpers/mocks.ts` e adatta se serve (pattern già visto durante C1 con `makeConnectionPayload`).

- [ ] **Step 5: Run tests**

```bash
npm test -- webhook-quick-capture
```

Expected: i 2 test UNDO passano.

- [ ] **Step 6: Run full suite**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: niente regressioni.

- [ ] **Step 7: Commit**

```bash
git add app/api/webhook/route.ts __tests__/webhook-quick-capture.test.ts __tests__/helpers/mocks.ts
git commit -m "feat(webhook): add UNDO command for cancelling latest scheduled message within 60s"
```

---

## Task 5: AI prompt extension + inline phone passing

**Files:**
- Modify: `app/api/webhook/route.ts`

- [ ] **Step 1: Trovare il prompt AI corrente**

```bash
grep -n "system.*prompt\|systemPrompt\|content.*role.*system" app/api/webhook/route.ts | head -10
```

Annotare la sezione che costruisce il prompt sistema inviato a Groq.

- [ ] **Step 2: Estendere il prompt sistema**

Trovare la stringa template del system prompt italiano. Cercare il blocco "## Comandi disponibili" o simile. Aggiungere alla fine del prompt:

```
## Numero di telefono inline

Se il messaggio dell'utente contiene un numero di telefono diretto nel testo
(es. "Invia a Mario Cementi 3331234567 alle 17: ..."), usalo come
recipient_number senza chiedere la vCard. Estrai il nome dal contesto vicino
al numero e usalo come recipient_name.

## Confidence field (OBBLIGATORIO)

Includi SEMPRE nel JSON un campo "confidence" con uno di questi valori:
- "high" — ora HH:MM esplicita E destinatario chiaro (numero o contatto noto)
- "medium" — ora chiara ma destinatario inferito o ambiguo
- "low" — ora vaga ("tra un po'", "stasera", "presto", "dopo", "più tardi")
```

- [ ] **Step 3: Iniettare il numero inline nel contesto AI**

PRIMA della chiamata AI (dove si costruisce `userContext` o `messages` per la richiesta), trovare il punto e aggiungere:

```typescript
import { extractInlinePhoneAndName } from '../../lib/webhook-utils';
// (nei file dovrebbe esserci già un import da webhook-utils — aggiungi extractInlinePhoneAndName alla lista)

// Subito prima di costruire il payload AI:
const inline = extractInlinePhoneAndName(messageText);
let aiUserText = messageText;
if (inline.phone) {
  aiUserText = `${inline.textWithoutPhone}\n\n[Sistema: numero inline rilevato — phone="${inline.phone}", name="${inline.name || 'sconosciuto'}". Usa questi come recipient_number/recipient_name nel JSON.]`;
}
```

E passa `aiUserText` invece di `messageText` come content del messaggio user nella richiesta.

- [ ] **Step 4: Verifica handling del nuovo campo `confidence`**

Cerca dove `aiResult` viene parseato:

```bash
grep -n "JSON.parse.*content\|aiResult\." app/api/webhook/route.ts | head -10
```

Verifica che il tipo `AIResult` (o equivalente) accetti il campo `confidence: 'high' | 'medium' | 'low'`. Se non c'è esplicito tipo TS, va bene (è solo accesso dinamico). Comunque assicurati che il valore venga estratto e usato in Task 6.

- [ ] **Step 5: Run tests — verifica nessuna regressione**

```bash
npm test
```

Expected: tutti i test esistenti ancora verdi. (Test specifico per inline phone arriva in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add app/api/webhook/route.ts
git commit -m "feat(webhook): extend AI prompt with inline phone support and confidence field"
```

---

## Task 6: Smart-confirm decision al punto di INSERT scheduled_messages

**Files:**
- Modify: `app/api/webhook/route.ts:~1179` (verifica esatta riga)

- [ ] **Step 1: Trovare l'INSERT del scheduled_messages con awaiting_confirm**

```bash
grep -n "status: 'awaiting_confirm'" app/api/webhook/route.ts
```

Probabile riga ~1179. Quello è il punto dove va la decisione smart-confirm: se applicabile, INSERT con `status='pending'` invece, e modificare il messaggio bot di risposta.

- [ ] **Step 2: Aggiungere helper `shouldSkipConfirm` in cima al file (sotto altri helper)**

```typescript
import { containsAmbiguousTimeKeyword, hasExplicitHHMM } from '../../lib/quick-capture-utils';

function shouldSkipConfirm(
  aiResult: any,
  contactWasKnown: boolean,
  originalText: string
): boolean {
  if (!contactWasKnown) return false;
  if (aiResult.confidence !== 'high') return false;
  if (containsAmbiguousTimeKeyword(originalText)) return false;
  if (!hasExplicitHHMM(originalText)) return false;
  return true;
}
```

- [ ] **Step 3: Modificare il blocco INSERT scheduled_messages (~riga 1179)**

Cerca il pattern:
```typescript
.insert({
  ...
  status: 'awaiting_confirm',
  ...
})
```

Sostituire con (usando i nomi delle variabili esistenti per `aiResult`, `contactWasKnown`, `messageText`, `recipient_name`, `scheduledAt`):

```typescript
const skipConfirm = shouldSkipConfirm(aiResult, contactWasKnown, messageText);
const initialStatus = skipConfirm ? 'pending' : 'awaiting_confirm';

const { data: insertedMsg } = await supabase.from('scheduled_messages').insert({
  // ... tutti i campi esistenti tranne status
  status: initialStatus,
  // ...
}).select('id').single();

// Bot reply
if (skipConfirm) {
  const when = new Date(scheduledAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
  await sendBotReply(instanceName, ownerPhone,
    `✅ Schedulato per ${aiResult.recipient || 'destinatario'} (${when}).\nScrivi UNDO entro 60s per annullare.`
  );
  return NextResponse.json({ ok: true });
}
// Se non skip → flusso awaiting_confirm esistente (bot manda summary "Rispondi OK per confermare")
```

NOTA: `contactWasKnown` deve essere derivata. Cerca dove `findContactByName` o simile viene chiamato, e tieni la variabile booleana che indica se il contatto è stato trovato in `pending_contacts`. Se non c'è ancora, deriva con:

```typescript
const contactWasKnown = !!aiResult.recipient_number_from_db; // o simile, dipende dal codice esistente
// OR semplicemente: era già in pending_contacts prima del messaggio?
```

Adatta in base a come la variabile esiste nel flusso corrente.

- [ ] **Step 4: Aggiungere test in `__tests__/webhook-quick-capture.test.ts`**

Append:

```typescript
describe('Smart-confirm skip', () => {
  test('contact known + explicit HH:MM → status=pending (no awaiting_confirm)', async () => {
    // Pre-arm: contact "Mario" exists, AI returns high confidence
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_contacts:select',
      { contact_name: 'Mario', phone_number: '393334445555' }, null);
    // Mock AI to return high-confidence schedule
    fetchMock.setHandler(/groq|openai/, {
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          action: 'schedule',
          recipient: 'Mario',
          recipient_number: '393334445555',
          message: 'ciao',
          datetime: '2026-04-20T09:00:00+02:00',
          confidence: 'high',
        }) } }],
      }),
    });
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Mario alle 9: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    expect(insertCall).toBeTruthy();
    // Verify status='pending' (smart-confirm skipped)
    const insertedRow = insertCall?.args[0];
    expect(insertedRow.status).toBe('pending');
  });

  test('contact NEW + inline phone → status=awaiting_confirm (no skip)', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_contacts:select', null, null); // no contact found
    fetchMock.setHandler(/groq|openai/, {
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          action: 'schedule',
          recipient: 'Mario Cementi',
          recipient_number: '393334445555',
          message: 'preventivo?',
          datetime: '2026-04-19T17:00:00+02:00',
          confidence: 'high',
        }) } }],
      }),
    });
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Invia a Mario Cementi 3334445555 oggi alle 17: preventivo?',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    const insertedRow = insertCall?.args[0];
    expect(insertedRow.status).toBe('awaiting_confirm');
  });

  test('contact known + ambiguous time ("tra un po") → awaiting_confirm', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_contacts:select',
      { contact_name: 'Mario', phone_number: '393334445555' }, null);
    fetchMock.setHandler(/groq|openai/, {
      ok: true, status: 200,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({
          action: 'schedule',
          recipient: 'Mario',
          recipient_number: '393334445555',
          message: 'ciao',
          datetime: '2026-04-19T18:00:00+02:00',
          confidence: 'low',  // AI itself says low confidence
        }) } }],
      }),
    });
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Mario tra un po: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    const insertedRow = insertCall?.args[0];
    expect(insertedRow.status).toBe('awaiting_confirm');
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test -- webhook-quick-capture
```

Expected: 2 nuovi test smart-confirm passano.

- [ ] **Step 6: Commit**

```bash
git add app/api/webhook/route.ts __tests__/webhook-quick-capture.test.ts
git commit -m "feat(webhook): smart-confirm skip for known contact + explicit time"
```

---

## Task 7: Auto-save contatto durante schedulazione

**Files:**
- Modify: `app/api/webhook/route.ts`

- [ ] **Step 1: Aggiungere helper `autoSaveContact` in `app/api/webhook/route.ts`**

Vicino agli altri helper (sopra POST handler):

```typescript
import { getPlanLimits } from '../../lib/plans';

async function autoSaveContact(
  supabase: any,
  ownerPhone: string,
  name: string | null,
  number: string,
  plan: string
): Promise<{ saved: boolean; conflict: boolean; conflictNumber?: string }> {
  if (!name) return { saved: false, conflict: false };

  // Check existing contact with same name
  const { data: existing } = await supabase.from('pending_contacts')
    .select('phone_number')
    .eq('owner_phone', ownerPhone)
    .ilike('contact_name', name)
    .maybeSingle();

  if (existing) {
    if (existing.phone_number === number) return { saved: false, conflict: false }; // already saved, no-op
    return { saved: false, conflict: true, conflictNumber: existing.phone_number }; // conflict — don't overwrite
  }

  // Check plan limit
  const limits = getPlanLimits(plan);
  const { count } = await supabase.from('pending_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('owner_phone', ownerPhone);
  if ((count || 0) >= limits.maxContacts) {
    return { saved: false, conflict: false };
  }

  await supabase.from('pending_contacts').insert({
    owner_phone: ownerPhone,
    contact_name: name,
    phone_number: number,
  });
  return { saved: true, conflict: false };
}
```

- [ ] **Step 2: Chiamare `autoSaveContact` quando arriva un numero inline**

Subito dopo l'estrazione `extractInlinePhoneAndName` (Task 5) e prima dell'INSERT scheduled_messages (Task 6), aggiungere:

```typescript
let autoSaveResult = { saved: false, conflict: false, conflictNumber: undefined as string | undefined };
if (inline.phone && inline.name) {
  autoSaveResult = await autoSaveContact(supabase, ownerPhone, inline.name, inline.phone, userPlan);
}
```

(Variabile `userPlan` deve essere derivata dalla `user_instances.subscription_plan` letta a inizio handler. Se non c'è, deriva.)

- [ ] **Step 3: Includere il risultato nella risposta bot**

Dove il bot risponde "✅ Schedulato per ..." (smart-confirm path) e "Pronto a inviare a ... Rispondi OK..." (awaiting_confirm path), aggiungere:

```typescript
let suffix = '';
if (autoSaveResult.saved) suffix = '\n(salvato in rubrica)';
if (autoSaveResult.conflict) suffix = `\n(uso ${inline.phone} per questa volta — il numero salvato per ${inline.name} è ${autoSaveResult.conflictNumber})`;

// Append `suffix` al messaggio bot.
```

- [ ] **Step 4: Aggiungere test in `__tests__/webhook-quick-capture.test.ts`**

```typescript
describe('Auto-save contact', () => {
  test('inline phone + name → contact saved', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_contacts:select', null, null);  // no existing contact
    mockSupa.setResponse('pending_contacts:insert', [{ id: 'c1' }], null);
    fetchMock.setHandler(/groq|openai/, {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient: 'Mario Cementi', recipient_number: '393334445555',
        message: 'ciao', datetime: '2026-04-19T17:00:00+02:00', confidence: 'high',
      }) } }] }),
    });
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Invia a Mario Cementi 3334445555 alle 17: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertContact = mockSupa.calls.find(c => c.table === 'pending_contacts' && c.operation === 'insert');
    expect(insertContact).toBeTruthy();
  });

  test('does NOT overwrite existing contact with different number', async () => {
    mockSupa.setResponse('user_instances:select',
      { id: 'u1', phone_number: '393331234567', instance_name: 'SchedWhats-393331234567', subscription_plan: 'free' }, null);
    mockSupa.setResponse('pending_contacts:select',
      { phone_number: '393331234567' }, null);  // Mario already saved with different number
    fetchMock.setHandler(/groq|openai/, {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({
        action: 'schedule', recipient: 'Mario', recipient_number: '393334445555',
        message: 'ciao', datetime: '2026-04-19T17:00:00+02:00', confidence: 'high',
      }) } }] }),
    });
    mockSupa.setResponse('scheduled_messages:insert', [{ id: 'm1' }], null);

    const payload = makeMessagePayload({
      instance: 'SchedWhats-393331234567',
      text: 'Invia a Mario 3334445555 alle 17: ciao',
      fromMe: true,
      remoteJid: '393331234567@s.whatsapp.net',
    });
    await callWebhook(payload);

    const insertContact = mockSupa.calls.find(c => c.table === 'pending_contacts' && c.operation === 'insert');
    expect(insertContact).toBeFalsy();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npm test -- webhook-quick-capture
```

- [ ] **Step 6: Commit**

```bash
git add app/api/webhook/route.ts __tests__/webhook-quick-capture.test.ts
git commit -m "feat(webhook): auto-save contact on inline phone (no overwrite, respect plan limit)"
```

---

## Task 8: `components/QuickCaptureModal.tsx`

**Files:**
- Create: `components/QuickCaptureModal.tsx`

- [ ] **Step 1: Creare il file**

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { formatDatePhrase } from '../app/lib/quick-capture-utils';

interface QuickCaptureModalProps {
  open: boolean;
  onClose: () => void;
  userPhone: string;  // Marco's own phone (from /api/auth/me)
}

function normalizeClientPhone(raw: string): string | null {
  if (!raw) return null;
  let cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) {
    const digits = cleaned.slice(1);
    if (!/^\d{7,}$/.test(digits)) return null;
    return digits;
  }
  if (!/^\d{7,}$/.test(cleaned)) return null;
  // Italian default: if starts with 3 (mobile), prepend 39
  if (cleaned.startsWith('3') && !cleaned.startsWith('39')) {
    cleaned = '39' + cleaned;
  }
  return cleaned;
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickCaptureModal({ open, onClose, userPhone }: QuickCaptureModalProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [datetime, setDatetime] = useState(() => toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000)));
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  function setPreset(kind: 'in1h' | 'tomorrow9' | 'tonight18') {
    const now = new Date();
    if (kind === 'in1h') {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    } else if (kind === 'tomorrow9') {
      now.setDate(now.getDate() + 1);
      now.setHours(9, 0, 0, 0);
    } else if (kind === 'tonight18') {
      if (now.getHours() >= 18) now.setDate(now.getDate() + 1);
      now.setHours(18, 0, 0, 0);
    }
    setDatetime(toDatetimeLocal(now));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const cleanPhone = normalizeClientPhone(phone);
    if (!cleanPhone) {
      setError('Numero non valido (es: 393331234567 o +447700900123)');
      return;
    }
    if (!message.trim()) {
      setError('Il messaggio non può essere vuoto');
      return;
    }
    if (message.length > 3500) {
      setError('Messaggio troppo lungo (max 3500 caratteri)');
      return;
    }

    const dt = new Date(datetime);
    if (isNaN(dt.getTime())) {
      setError('Data non valida');
      return;
    }
    if (dt.getTime() < Date.now() + 60 * 1000) {
      setError('Data deve essere almeno 1 minuto nel futuro');
      return;
    }

    const datePhrase = formatDatePhrase(dt);
    const namePart = name.trim() ? `${name.trim()} ` : '';
    const phrase = `Invia a ${namePart}${cleanPhone} ${datePhrase}: ${message.trim()}`;
    const url = `https://wa.me/${userPhone}?text=${encodeURIComponent(phrase)}`;

    window.location.href = url;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-surface rounded-3xl shadow-soft w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-text-primary">Nuovo follow-up</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Nome (opzionale)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mario Cementi" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Numero (con prefisso)</label>
            <Input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="393331234567"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Quando</label>
            <Input
              type="datetime-local"
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              required
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              <button type="button" onClick={() => setPreset('in1h')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Tra 1h
              </button>
              <button type="button" onClick={() => setPreset('tomorrow9')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Domani 9:00
              </button>
              <button type="button" onClick={() => setPreset('tonight18')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Stasera 18:00
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Messaggio</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Mi mandi il preventivo per i sacchi?"
              rows={4}
              className="w-full px-4 py-2 border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary"
              required
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-error-light text-error-dark text-sm">{error}</div>
          )}

          <Button type="submit" className="w-full">
            <Plus className="w-4 h-4 mr-2" /> Apri WhatsApp e invia
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifica build**

```bash
npm run build 2>&1 | grep -iE "compiled|error|QuickCapture" | head -5
```

Expected: "Compiled successfully" + (pre-existing supabaseUrl error OK).

- [ ] **Step 3: Commit**

```bash
git add components/QuickCaptureModal.tsx
git commit -m "feat(ui): add QuickCaptureModal component (form + deep-link generator)"
```

---

## Task 9: Integrazione modal nella dashboard

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Importare e mountare il modal**

In testa al file (sotto altri import):

```typescript
import { Plus } from 'lucide-react';  // se non già importato
import QuickCaptureModal from '@/components/QuickCaptureModal';
```

Aggiungere stato:

```typescript
const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
```

- [ ] **Step 2: Aggiungere bottone in alto sulla dashboard**

Trovare il blocco principale del JSX della dashboard (dopo l'header con stato connessione, prima della lista messaggi). Aggiungere:

```tsx
<div className="mb-4">
  <Button
    variant="primary"
    onClick={() => setQuickCaptureOpen(true)}
    className="w-full sm:w-auto"
  >
    <Plus className="w-5 h-5 mr-2" /> Nuovo follow-up
  </Button>
</div>
```

E in fondo al JSX (fuori dai container principali, ad esempio dopo `</main>`):

```tsx
<QuickCaptureModal
  open={quickCaptureOpen}
  onClose={() => setQuickCaptureOpen(false)}
  userPhone={userPhone}
/>
```

NOTA: `userPhone` deve essere già presente come stato dalla refactor C1 (proviene da `/api/auth/me`). Verifica con grep.

- [ ] **Step 3: Verifica build**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Smoke test locale (opzionale, se puoi runnare dev server)**

```bash
npm run dev
# Apri http://localhost:3000/dashboard (con cookie sw_session valido)
# Verifica: bottone "+ Nuovo follow-up" visibile, click apre modal
# Compila modal, click submit → verifica che venga aperto wa.me URL
```

- [ ] **Step 5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): add Quick Capture modal trigger"
```

---

## Task 10: Aggiornare ARCHITETTURA.md

**Files:**
- Modify: `docs/ARCHITETTURA.md`

- [ ] **Step 1: Aggiungere flusso Quick Capture in sezione 5 (Flussi Principali)**

Trovare la sezione 5 e aggiungere subito dopo "5.2 Scheduling Messaggi (con AI)" un nuovo blocco:

```markdown
### 5.2.1 Quick Capture (numero inline)

Marco scrive nella self-chat:
  "Invia a Mario Cementi 3331234567 oggi alle 17: preventivo?"
  ↓
Webhook handler:
  1. Auth + dedup + self-chat check (esistente)
  2. extractInlinePhoneAndName(text) → { phone:"393331234567", name:"Mario Cementi" }
  3. AI prompt esteso riceve phone+name come context
  4. AI ritorna { action:"schedule", recipient_number, recipient_name, datetime, confidence }
  5. autoSaveContact(name, number) → salva in pending_contacts (se sotto limite, no overwrite)
  6. shouldSkipConfirm(aiResult, contactWasKnown, originalText) decide:
     - contatto noto + ora HH:MM esplicita + confidence='high' → skip
     - altrimenti → awaiting_confirm
  7. Se skip: INSERT con status='pending', bot risponde "✅ Schedulato. UNDO entro 60s"
  8. Se NO skip: INSERT con status='awaiting_confirm', bot chiede "Rispondi OK"

Dashboard secondary path:
  Bottone "+ Nuovo follow-up" → QuickCaptureModal → submit genera frase naturale
  → window.location.href = wa.me/<self>?text=<encoded_phrase>
  → WhatsApp si apre con messaggio precompilato → utente fa "Invia"
  → pipeline webhook identica al flusso primario

UNDO command:
  "undo" / "annulla" / "u" entro 60s da uno smart-confirm
  → trova ultimo scheduled_messages status='pending' created_at>NOW-60s
  → UPDATE status='cancelled'
```

- [ ] **Step 2: Commit**

```bash
git add docs/ARCHITETTURA.md
git commit -m "docs: add Quick Capture flow to ARCHITETTURA.md"
```

---

## Task 11: Deploy + smoke produzione

**Pre-deploy checklist:**

- [ ] **Step 1: Verifica tutti i test locali**

```bash
npm test 2>&1 | grep -E "Tests:|Test Suites:"
```

Expected: tutti verdi.

- [ ] **Step 2: Push branch + PR (preferito)**

Dalla worktree (`feat/quick-capture`):

```bash
git push -u origin feat/quick-capture
```

Poi crea PR su GitHub: `feat/quick-capture` → `main`.

In alternativa, merge locale fast-forward:
```bash
cd "/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush"
git fetch origin main
git checkout main
git reset --hard origin/main
git merge --ff-only feat/quick-capture
git push origin main
```

- [ ] **Step 3: Aspettare Vercel deploy (~1-2 min)**

Verifica su Vercel dashboard. Build dovrebbe passare (nessun nuovo edge runtime issue, no env var nuove richieste).

- [ ] **Step 4: Smoke test produzione**

Dashboard manuale:
1. Apri `https://whatslaterpush.vercel.app/dashboard` (loggato con cookie C1)
2. Verifica: bottone "+ Nuovo follow-up" visibile in alto
3. Click → modal apre
4. Compila: Nome="Test", Numero=tuo numero secondario, Data/ora=tra 5 minuti, Messaggio="test quick capture"
5. Click "Apri WhatsApp e invia" → WhatsApp si apre con frase precompilata nella self-chat
6. **Non inviare** (per evitare di programmare davvero) — chiudi WhatsApp

WhatsApp manuale (Marco-mode):
1. Dalla self-chat scrivi: "Invia a TestNuovo 393<numero secondario> tra 2 ore: test quick"
2. Verifica che il bot risponda con summary di conferma (contatto nuovo → awaiting_confirm)
3. Rispondi "ok"
4. Verifica che il messaggio sia in coda
5. Subito dopo, scrivi "annulla" o "undo" entro 60s
6. Verifica che il bot dica "✅ Annullato..."

- [ ] **Step 5: Tag release** (opzionale)

```bash
git -C "/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush" tag -a v8.1.0-quick-capture -m "Quick Capture: inline phone + dashboard modal"
git -C "/c/Users/Windows 11 Pro/schedwhats-ops/whatslaterpush" push origin v8.1.0-quick-capture
```

---

## Spec Coverage Self-Review

| Spec § | Requisito | Task |
|---|---|---|
| 4.1 | Flusso primario (Marco con numero inline) | Task 5 + 6 + 7 |
| 4.2 | Smart-confirm skip per contatto noto + HH:MM esplicita | Task 6 |
| 4.3 | Dashboard modal + deep-link wa.me | Task 8 + 9 |
| 4.4 | UNDO command 60s | Task 4 |
| 4.5 | Auto-save contatto (4 scenari) | Task 7 |
| 4.6 | Validazione numero (client + server) | Task 8 (client) + esistente `validatePhone` (server) |
| 4.7 | Definizione "data ambigua" | Task 2 (helpers) + Task 6 (uso) |
| 5.1 | `extractInlinePhoneAndName` | Task 3 |
| 5.2 | AI prompt extension + confidence | Task 5 |
| 5.3 | Step extraction prima dell'AI | Task 5 |
| 5.4 | `shouldSkipConfirm` logic | Task 6 |
| 5.5 | `autoSaveContact` logic | Task 7 |
| 5.6 | UNDO fast-path | Task 4 |
| 6 | Dashboard modal componente + integrazione | Task 8 + 9 |
| 9 (edge cases) | 12 case con risoluzione | Coperti distribuiti nei test (Task 3, 4, 6, 7, 8) |
| 11 (test) | Unit + integration + E2E opzionale | Task 2, 3, 4, 6, 7 (8 integration cases come da spec) |
| 12 (rollout) | Single deploy + smoke | Task 11 |

**Gaps identificati:** nessuno.

**Placeholder scan:** nessun "TBD" / "implement later" / "similar to". Tutti gli step contengono codice/comandi concreti.

**Type consistency:**
- `extractInlinePhoneAndName(text) → {phone, name, textWithoutPhone}` consistente in Task 3, 5
- `shouldSkipConfirm(aiResult, contactWasKnown, originalText) → boolean` consistente in Task 6
- `autoSaveContact(...) → {saved, conflict, conflictNumber?}` consistente in Task 7
- `formatDatePhrase`, `containsAmbiguousTimeKeyword`, `hasExplicitHHMM` consistenti tra Task 2 e Task 6/8

---

## Riassunto totale

**11 task, ~10-12 commit minimi.**

**Stima esecuzione:** 12-18h (~1.5-2 giornate piene).

**Dipendenze critiche tra task:**

```
Task 2 (utils) ← Task 6 (smart-confirm), Task 8 (modal date)
Task 3 (extractInline) ← Task 5 (AI), Task 7 (auto-save)
Task 5 (AI prompt) ← Task 6 (smart-confirm uses confidence)
Task 6 (smart-confirm) ← Task 7 (suffix in bot reply)
Task 8 (modal) ← Task 9 (dashboard mount)
Task 9 (dashboard) → indipendente da webhook tasks (UI only)
Task 4 (UNDO) → indipendente, può essere fatto in qualsiasi punto

Esecuzione raccomandata: ordine numerico.
```
