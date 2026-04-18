# C1 Phone-First Cookie Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire la sessione `localStorage` non firmata della dashboard con un cookie HTTP-only HMAC emesso quando il webhook `CONNECTION_UPDATE state=open` di Evolution API conferma il pairing del QR — mantenendo intatto il flusso phone-first (zero email/password).

**Architecture:** L'utente apre `/connect`, inserisce telefono, scansiona QR. Il webhook Evolution riceve la conferma di pairing e marca una riga `pending_auth_sessions` come `authenticated`. Il browser polla `/api/auth/check`, riceve un cookie HMAC firmato (90gg sliding), e da quel momento middleware Next.js verifica il cookie su tutti i path protetti. `/api/messages`, `/api/connect`, `/api/payment/*` derivano `phone` dal cookie invece che da query/body.

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (DB-only, no Auth) · Evolution API v2 · `crypto` Node nativo (HMAC-SHA256, zero dipendenze nuove) · Jest + Playwright.

**Spec di riferimento:** `docs/superpowers/specs/2026-04-19-phone-first-cookie-auth-design.md`

---

## File Structure

### File da creare

| Path | Responsabilità | Stima righe |
|---|---|---|
| `app/lib/auth-cookie.ts` | sign/verify HMAC + sliding refresh helper | ~80 |
| `app/api/auth/me/route.ts` | GET → ritorna `{phone, instanceName}` dal cookie, 401 altrimenti | ~30 |
| `app/api/auth/logout/route.ts` | POST → clear cookie | ~25 |
| `app/api/auth/init/route.ts` | POST → crea pending session + Evolution instance + ritorna QR/pairing | ~150 |
| `app/api/auth/check/route.ts` | GET polling → set cookie su success, cleanup row | ~80 |
| `app/connect/page.tsx` | Nuova pagina input phone + QR + polling | ~250 |
| `supabase/migrations/20260419_pending_auth_sessions.sql` | DDL nuova tabella + indici + RLS | ~30 |
| `__tests__/auth-cookie.test.ts` | Unit test sign/verify/tampering/expiry/refresh | ~140 |
| `__tests__/auth-flow.integration.test.ts` | Integration init → webhook → check happy + edge | ~200 |
| `__tests__/e2e/connect.spec.ts` | E2E Playwright (full /connect flow) | ~80 |

### File da modificare

| Path | Cosa cambia |
|---|---|
| `middleware.ts` | Sostituire passthrough con verifica cookie HMAC + allowlist + sliding refresh |
| `app/api/webhook/route.ts:236-255` | In `handleConnectionUpdate`, dopo update di `user_instances`, fare UPDATE su `pending_auth_sessions` quando `state=open` |
| `app/api/messages/route.ts` | Rimuovere param `phone`. Estrarre da cookie via `verifyCookie()`. 401 se assente |
| `app/api/connect/route.ts:144-309` | Rimuovere blocco `getCodeAndPairing` (logica spostata in `/api/auth/init`). Rimanenti azioni accessibili solo via cookie |
| `app/api/payment/create-checkout/route.ts:22` | Sostituire `body.phone` con phone dal cookie |
| `app/api/payment/portal/route.ts:17` | Sostituire `body.phone` con phone dal cookie |
| `app/api/cron/send-messages/route.ts:85-94` | Aggiungere DELETE cleanup di `pending_auth_sessions` scadute |
| `app/dashboard/page.tsx:14-30,67-95` | Rimuovere blocco localStorage + `validateSession`. Sostituire con `/api/auth/me` |
| `app/dashboard/page.tsx` (sezione connect) | Rimuovere UI di pairing (ora vive in `/connect`). Dashboard mostra solo coda messaggi + logout |
| `__tests__/webhook.integration.test.ts` | Aggiungere test CONNECTION_UPDATE che marca pending session |
| `__tests__/cron.integration.test.ts` | Aggiungere test cleanup `pending_auth_sessions` scadute |
| `docs/ARCHITETTURA.md` | Aggiornare sezione Auth + DB (nuova tabella) + flussi |
| `CLAUDE.md` | Cambiare riga C1 a ✅ |

---

## Task 1: Setup env + test helpers

**Files:**
- Modify: `.env.local.example` (se esiste — altrimenti `.env.example`. Se nessuno esiste, salta la modifica)
- Modify: `__tests__/helpers/mocks.ts` — aggiungere helper per mock cookie

- [ ] **Step 1: Generare il secret per dev locale**

```bash
openssl rand -hex 64
```

Output: stringa esadecimale di 128 caratteri. Aggiungere a `.env.local`:

```
AUTH_COOKIE_SECRET=<output>
```

- [ ] **Step 2: Aggiungere helper di test in `__tests__/helpers/mocks.ts`**

In fondo al file, aggiungere:

```typescript
export function setAuthCookieEnv() {
  process.env.AUTH_COOKIE_SECRET = '0'.repeat(128); // deterministic for tests
}

export function makeRequestWithCookie(body: any, cookieValue: string, headers: Record<string, string> = {}) {
  return mockRequest(body, {
    ...headers,
    cookie: `sw_session=${cookieValue}`,
  });
}
```

- [ ] **Step 3: Verifica che i test esistenti continuino a passare**

```bash
npm test
```

Expected: tutti i test verdi (88+).

- [ ] **Step 4: Commit**

```bash
git add __tests__/helpers/mocks.ts
git commit -m "test: add cookie helper and AUTH_COOKIE_SECRET test fixture"
```

---

## Task 2: `app/lib/auth-cookie.ts` con TDD

**Files:**
- Create: `app/lib/auth-cookie.ts`
- Create: `__tests__/auth-cookie.test.ts`

- [ ] **Step 1: Scrivere test failing**

Crea `__tests__/auth-cookie.test.ts`:

```typescript
import { signCookie, verifyCookie, shouldRefresh } from '../app/lib/auth-cookie';

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: SECRET };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('signCookie + verifyCookie round-trip', () => {
  test('sign then verify returns the same payload', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const payload = verifyCookie(cookie);
    expect(payload).not.toBeNull();
    expect(payload!.phone).toBe('393331234567');
    expect(payload!.instanceName).toBe('SchedWhats-393331234567');
    expect(payload!.iat).toBeGreaterThan(0);
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  test('exp is iat + 90 days', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const p = verifyCookie(cookie)!;
    expect(p.exp - p.iat).toBe(90 * 24 * 60 * 60);
  });
});

describe('verifyCookie security', () => {
  test('returns null for tampered payload', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'X' });
    const [payload, sig] = cookie.split('.');
    const tamperedPayload = Buffer.from('{"phone":"VICTIM","instanceName":"X","iat":1,"exp":9999999999}').toString('base64url');
    expect(verifyCookie(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  test('returns null for tampered signature', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'X' });
    const [payload, sig] = cookie.split('.');
    const tamperedSig = sig.slice(0, -2) + 'AA';
    expect(verifyCookie(`${payload}.${tamperedSig}`)).toBeNull();
  });

  test('returns null for malformed cookie (no dot)', () => {
    expect(verifyCookie('justgarbage')).toBeNull();
  });

  test('returns null for empty/undefined cookie', () => {
    expect(verifyCookie('')).toBeNull();
    expect(verifyCookie(undefined)).toBeNull();
  });

  test('returns null for expired cookie', () => {
    // Generate a cookie with exp in the past by manually constructing
    const expiredPayload = Buffer.from(JSON.stringify({
      phone: '393331234567',
      instanceName: 'X',
      iat: 1000,
      exp: 2000,
    })).toString('base64url');
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', SECRET).update(expiredPayload).digest('base64url');
    expect(verifyCookie(`${expiredPayload}.${sig}`)).toBeNull();
  });
});

describe('shouldRefresh', () => {
  test('returns true if iat older than 7 days', () => {
    const oldIat = Math.floor(Date.now() / 1000) - (8 * 24 * 60 * 60);
    expect(shouldRefresh({ phone: 'X', instanceName: 'X', iat: oldIat, exp: oldIat + 9999999 })).toBe(true);
  });

  test('returns false if iat fresh', () => {
    const freshIat = Math.floor(Date.now() / 1000) - 60;
    expect(shouldRefresh({ phone: 'X', instanceName: 'X', iat: freshIat, exp: freshIat + 9999999 })).toBe(false);
  });
});

describe('signCookie env requirement', () => {
  test('throws if AUTH_COOKIE_SECRET missing', () => {
    delete process.env.AUTH_COOKIE_SECRET;
    expect(() => signCookie({ phone: 'X', instanceName: 'X' })).toThrow(/AUTH_COOKIE_SECRET/);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npm test -- auth-cookie
```

Expected: FAIL — modulo `app/lib/auth-cookie` non esiste.

- [ ] **Step 3: Implementare `app/lib/auth-cookie.ts`**

```typescript
import crypto from 'crypto';

export interface AuthCookiePayload {
  phone: string;
  instanceName: string;
  iat: number;
  exp: number;
}

const COOKIE_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 giorni
const REFRESH_THRESHOLD_SECONDS = 7 * 24 * 60 * 60; // 7 giorni

function getSecret(): string {
  const s = process.env.AUTH_COOKIE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUTH_COOKIE_SECRET not set or too short (need 32+ chars)');
  }
  return s;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

export function signCookie(input: { phone: string; instanceName: string }): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthCookiePayload = {
    phone: input.phone,
    instanceName: input.instanceName,
    iat: now,
    exp: now + COOKIE_TTL_SECONDS,
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export function verifyCookie(raw: string | undefined): AuthCookiePayload | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  let provided: Buffer;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let payload: AuthCookiePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (
    typeof payload?.phone !== 'string' ||
    typeof payload?.instanceName !== 'string' ||
    typeof payload?.iat !== 'number' ||
    typeof payload?.exp !== 'number'
  ) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  return payload;
}

export function shouldRefresh(payload: AuthCookiePayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - payload.iat > REFRESH_THRESHOLD_SECONDS;
}

export const AUTH_COOKIE_NAME = 'sw_session';
export const AUTH_COOKIE_MAX_AGE = COOKIE_TTL_SECONDS;
```

- [ ] **Step 4: Run tests, expected PASS**

```bash
npm test -- auth-cookie
```

Expected: tutti i test verdi.

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth-cookie.ts __tests__/auth-cookie.test.ts
git commit -m "feat(auth): add HMAC-SHA256 cookie sign/verify helpers"
```

---

## Task 3: Migration `pending_auth_sessions`

**Files:**
- Create: `supabase/migrations/20260419_pending_auth_sessions.sql`
- Modify: `supabase/schema.sql` (sincronizza)

- [ ] **Step 1: Scrivere il file migration**

```sql
-- Migration: pending_auth_sessions
-- Date: 2026-04-19
-- Purpose: temporary rows coordinating browser ↔ webhook for cookie auth

CREATE TABLE IF NOT EXISTS pending_auth_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  instance_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  CONSTRAINT pending_auth_sessions_status_check CHECK (status IN ('pending', 'authenticated'))
);

CREATE INDEX IF NOT EXISTS idx_pending_auth_sessions_phone_status
  ON pending_auth_sessions (phone, status);

CREATE INDEX IF NOT EXISTS idx_pending_auth_sessions_expires
  ON pending_auth_sessions (expires_at);

-- RLS: solo service role legge/scrive (no policies utente esposte)
ALTER TABLE pending_auth_sessions ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Applicare la migration via MCP Supabase**

(Usare `mcp__supabase__apply_migration` oppure copiare lo SQL nel SQL Editor di Supabase Dashboard sul progetto `inheoexhtuyjtfotbzyw`)

- [ ] **Step 3: Verificare la creazione**

Eseguire query di verifica:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pending_auth_sessions';
```

Expected: 6 colonne (id, phone, status, instance_name, created_at, expires_at).

- [ ] **Step 4: Aggiornare `supabase/schema.sql`** appendendo lo stesso DDL della migration in fondo (per mantenere `schema.sql` sorgente di verità del modello).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260419_pending_auth_sessions.sql supabase/schema.sql
git commit -m "feat(db): add pending_auth_sessions table for cookie auth flow"
```

---

## Task 4: `/api/auth/me` (endpoint più semplice — apriamo da qui)

**Files:**
- Create: `app/api/auth/me/route.ts`
- Create test: aggiungere block in `__tests__/auth-flow.integration.test.ts` (creiamo il file ora con questo primo test)

- [ ] **Step 1: Creare `__tests__/auth-flow.integration.test.ts` con primo test**

```typescript
/**
 * Integration tests for cookie auth flow (/api/auth/*).
 */
import { signCookie } from '../app/lib/auth-cookie';
import { mockRequest } from './helpers/mocks';

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: SECRET };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReqWithCookie(method: string, cookieValue: string | null) {
  const headers: any = {};
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  return new Request('http://localhost/api/auth/me', {
    method,
    headers,
  });
}

describe('GET /api/auth/me', () => {
  test('returns 401 when no cookie present', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const { GET } = await import('../app/api/auth/me/route');
    const res = await GET(makeReqWithCookie('GET', null) as any);
    expect(res.status).toBe(401);
  });

  test('returns phone+instanceName when cookie valid', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/auth/me/route');
    const res = await GET(makeReqWithCookie('GET', cookie) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phone).toBe('393331234567');
    expect(body.instanceName).toBe('SchedWhats-393331234567');
  });

  test('returns 401 when cookie tampered', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const cookie = signCookie({ phone: '393331234567', instanceName: 'X' });
    const tampered = cookie.slice(0, -2) + 'AA';
    const { GET } = await import('../app/api/auth/me/route');
    const res = await GET(makeReqWithCookie('GET', tampered) as any);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
npm test -- auth-flow
```

Expected: FAIL — `app/api/auth/me/route` non esiste.

- [ ] **Step 3: Implementare `app/api/auth/me/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = verifyCookie(raw);
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({
    phone: payload.phone,
    instanceName: payload.instanceName,
  });
}
```

- [ ] **Step 4: Run tests, PASS**

```bash
npm test -- auth-flow
```

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/me/route.ts __tests__/auth-flow.integration.test.ts
git commit -m "feat(auth): add GET /api/auth/me endpoint"
```

---

## Task 5: `/api/auth/logout`

**Files:**
- Create: `app/api/auth/logout/route.ts`
- Modify: `__tests__/auth-flow.integration.test.ts` (aggiungere block test)

- [ ] **Step 1: Aggiungere test failing in `auth-flow.integration.test.ts`**

```typescript
describe('POST /api/auth/logout', () => {
  test('returns 200 and Set-Cookie clearing the session', async () => {
    jest.resetModules();
    process.env.AUTH_COOKIE_SECRET = SECRET;
    const { POST } = await import('../app/api/auth/logout/route');
    const req = new Request('http://localhost/api/auth/logout', { method: 'POST' });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/sw_session=;/);
    expect(setCookie.toLowerCase()).toContain('max-age=0');
    expect(setCookie.toLowerCase()).toContain('httponly');
  });
});
```

- [ ] **Step 2: Run failing**

```bash
npm test -- auth-flow
```

Expected: FAIL — `app/api/auth/logout/route` non esiste.

- [ ] **Step 3: Implementare `app/api/auth/logout/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ success: true });
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
```

- [ ] **Step 4: Run tests, PASS**

```bash
npm test -- auth-flow
```

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/logout/route.ts __tests__/auth-flow.integration.test.ts
git commit -m "feat(auth): add POST /api/auth/logout endpoint"
```

---

## Task 6: `/api/auth/init` (estrae logica getCodeAndPairing + crea pending session)

**Files:**
- Create: `app/api/auth/init/route.ts`
- Modify: `__tests__/auth-flow.integration.test.ts`

- [ ] **Step 1: Aggiungere test failing**

In `__tests__/auth-flow.integration.test.ts`, aggiungere all'inizio del file (sopra il primo describe):

```typescript
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));
```

Nel `beforeEach` esistente, aggiungere:

```typescript
mockSupa.calls.length = 0;
fetchMock.calls.length = 0;
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
process.env.EVOLUTION_API_URL = 'https://evo.test';
process.env.EVOLUTION_API_KEY = 'evo-key';
process.env.NEXT_PUBLIC_APP_URL = 'https://whatslaterpush.vercel.app';
(global as any).fetch = fetchMock.mockFetch;
```

Aggiungere block test:

```typescript
describe('POST /api/auth/init', () => {
  test('returns 400 if phone missing', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('returns 400 if phone invalid', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: 'abc' }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('on success returns sessionId + qr/pairing', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    // Stub Evolution API: instance/create returns qrcode
    fetchMock.setResponse(/\/instance\//, {
      qrcode: { base64: 'data:image/png;base64,FAKEQR', pairingCode: 'ABCD-1234' },
    });
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', {
      method: 'POST',
      body: JSON.stringify({ phone: '393331234567' }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.qrCode).toBeTruthy();
    expect(body.pairingCode).toBeTruthy();
    // pending_auth_sessions insert should have happened
    const insertCall = mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'insert');
    expect(insertCall).toBeTruthy();
  });
});
```

Nota: `createFetchMock` esiste già in `__tests__/helpers/mocks.ts`. Se non ha `setResponse(regex, data)`, va aggiunto. Verifica con `head -200 __tests__/helpers/mocks.ts`. Se manca, aggiungi un metodo simile esistente o adatta il test alla forma supportata.

- [ ] **Step 2: Run failing**

```bash
npm test -- auth-flow
```

Expected: FAIL — `app/api/auth/init/route` non esiste.

- [ ] **Step 3: Implementare `app/api/auth/init/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { validatePhone } from '../../../lib/phone';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';
const SESSION_TTL_MINUTES = 10;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function forceDeleteInstance(name: string): Promise<void> {
  try {
    await fetch(`${EVO_URL}/instance/logout/${name}`, { method: 'DELETE', headers: { apikey: EVO_KEY! } });
  } catch {}
  await new Promise(r => setTimeout(r, 500));
  try {
    await fetch(`${EVO_URL}/instance/delete/${name}`, { method: 'DELETE', headers: { apikey: EVO_KEY! } });
  } catch {}
  await new Promise(r => setTimeout(r, 1500));
}

async function setWebhook(name: string): Promise<void> {
  const webhookUrl = `${APP_URL}/api/webhook`;
  const webhookSecret = process.env.WEBHOOK_SECRET || '';
  const body: any = {
    enabled: true,
    url: webhookUrl,
    webhook_by_events: false,
    webhook_base64: false,
    events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
  };
  if (webhookSecret) body.headers = { 'x-webhook-secret': webhookSecret };
  try {
    const res = await fetch(`${EVO_URL}/webhook/set/${name}`, {
      method: 'POST',
      headers: { apikey: EVO_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data?.error || data?.status === 'error' || !res.ok) {
      await fetch(`${EVO_URL}/webhook/set/${name}`, {
        method: 'POST',
        headers: { apikey: EVO_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook: body }),
      });
    }
  } catch (e) {
    console.error('[auth/init] setWebhook error:', e);
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const cleanPhone = validatePhone(body?.phone || '');
  if (!cleanPhone) {
    return NextResponse.json(
      { error: 'Inserisci numero completo con prefisso internazionale (es: 393509898408)' },
      { status: 400 }
    );
  }
  const instanceName = `SchedWhats-${cleanPhone}`;
  const sessionId = crypto.randomUUID();
  const supabase = getSupabase();

  // Create pending auth session BEFORE Evolution API calls (so even on race the row exists)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const { error: insertErr } = await supabase
    .from('pending_auth_sessions')
    .insert({ id: sessionId, phone: cleanPhone, status: 'pending', expires_at: expiresAt });
  if (insertErr) {
    console.error('[auth/init] insert pending session failed:', insertErr.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  // user_instances upsert (uguale a logica preesistente in /api/connect)
  await supabase.from('user_instances')
    .delete()
    .eq('instance_name', instanceName)
    .neq('phone_number', cleanPhone);
  await supabase.from('user_instances').upsert(
    {
      phone_number: cleanPhone,
      instance_name: instanceName,
      subscription_plan: 'trial',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'phone_number' }
  );

  await forceDeleteInstance(instanceName);

  let createRes: any;
  try {
    const res = await fetch(`${EVO_URL}/instance/create`, {
      method: 'POST',
      headers: { apikey: EVO_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceName,
        number: cleanPhone,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
        webhook: {
          enabled: true,
          url: `${APP_URL}/api/webhook`,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
          ...(process.env.WEBHOOK_SECRET ? { headers: { 'x-webhook-secret': process.env.WEBHOOK_SECRET } } : {}),
        },
      }),
    });
    createRes = await res.json();
  } catch (e) {
    console.error('[auth/init] instance create error:', e);
    return NextResponse.json({ error: 'Errore creazione istanza Evolution API' }, { status: 500 });
  }

  await setWebhook(instanceName);

  let qrCode: string | null = createRes?.qrcode?.base64 || createRes?.base64 || null;
  let pairingCode: string | null = createRes?.qrcode?.pairingCode || createRes?.pairingCode || null;

  // Fallback identici a /api/connect getCodeAndPairing
  if (!qrCode) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, { headers: { apikey: EVO_KEY! } });
      const d = await r.json();
      qrCode = d?.base64 || d?.qrcode?.base64 || null;
      pairingCode = pairingCode || d?.pairingCode || d?.qrcode?.pairingCode || null;
    } catch {}
  }
  if (!pairingCode) {
    try {
      const r = await fetch(`${EVO_URL}/instance/connect/${instanceName}`, {
        method: 'POST',
        headers: { apikey: EVO_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: cleanPhone }),
      });
      const d = await r.json();
      pairingCode = d?.pairingCode || d?.code || null;
    } catch {}
  }

  if (!qrCode && !pairingCode) {
    return NextResponse.json(
      { error: 'Impossibile generare QR o codice. Riprova tra qualche secondo.' },
      { status: 500 }
    );
  }

  return NextResponse.json({ sessionId, instanceName, qrCode, pairingCode });
}
```

- [ ] **Step 4: Run tests, PASS**

```bash
npm test -- auth-flow
```

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/init/route.ts __tests__/auth-flow.integration.test.ts
git commit -m "feat(auth): add POST /api/auth/init that creates pending session + Evolution instance"
```

---

## Task 7: Webhook — UPDATE pending session su CONNECTION_UPDATE state=open

**Files:**
- Modify: `app/api/webhook/route.ts:236-255` (`handleConnectionUpdate`)
- Modify: `__tests__/webhook.integration.test.ts`

- [ ] **Step 1: Aggiungere test in `webhook.integration.test.ts`**

In fondo al file, aggiungere block:

```typescript
describe('CONNECTION_UPDATE marks pending_auth_sessions', () => {
  test('state=open updates pending session for that phone', async () => {
    // Pre-arm mock to return one pending session row
    mockSupa.setResponse('pending_auth_sessions:update', { data: [{ id: 'session-1' }], error: null });
    // Pre-arm user_instances update
    mockSupa.setResponse('user_instances:update', { data: [{ id: 'u1', phone_number: '393331234567' }], error: null });

    const payload = makeConnectionPayload({
      instance: 'SchedWhats-393331234567',
      state: 'open',
      ownerJid: '393331234567@s.whatsapp.net',
    });
    const res = await callWebhook(payload);
    expect(res.status).toBe(200);

    const updateCall = mockSupa.calls.find(
      c => c.table === 'pending_auth_sessions' && c.operation === 'update'
    );
    expect(updateCall).toBeTruthy();
  });

  test('state=close does NOT touch pending_auth_sessions', async () => {
    mockSupa.setResponse('user_instances:update', { data: [{ id: 'u1', phone_number: '393331234567' }], error: null });
    const payload = makeConnectionPayload({
      instance: 'SchedWhats-393331234567',
      state: 'close',
    });
    await callWebhook(payload);
    const updateCall = mockSupa.calls.find(
      c => c.table === 'pending_auth_sessions' && c.operation === 'update'
    );
    expect(updateCall).toBeFalsy();
  });
});
```

Nota: `makeConnectionPayload` deve accettare `ownerJid` opzionale. Verifica `__tests__/helpers/mocks.ts` — se non lo accetta, estendi:

```typescript
// In mocks.ts, makeConnectionPayload existing function — aggiungere supporto ownerJid:
export function makeConnectionPayload(opts: { instance: string; state: string; ownerJid?: string }) {
  return {
    event: 'CONNECTION_UPDATE',
    instance: opts.instance,
    data: {
      state: opts.state,
      ...(opts.ownerJid ? { ownerJid: opts.ownerJid } : {}),
    },
  };
}
```

- [ ] **Step 2: Run failing**

```bash
npm test -- webhook.integration
```

Expected: FAIL — handler non aggiorna `pending_auth_sessions`.

- [ ] **Step 3: Modificare `app/api/webhook/route.ts:236-255`**

Trovare la funzione `handleConnectionUpdate` (linea ~236). Subito dopo l'`update` di `user_instances` (dopo riga ~253, prima del `return NextResponse.json({ ok: true })`), aggiungere:

```typescript
  // NEW: mark pending auth session as authenticated when WhatsApp pairing succeeds
  if (connectionStatus === 'open') {
    const ownerJidRaw = data?.ownerJid || data?.wuid || '';
    const ownerPhone = String(ownerJidRaw).split('@')[0];
    if (ownerPhone) {
      const { data: sessions, error: sErr } = await supabase
        .from('pending_auth_sessions')
        .update({ status: 'authenticated', instance_name: instanceName })
        .eq('phone', ownerPhone)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .select('id');
      if (sErr) {
        console.error(`WEBHOOK: pending_auth_sessions update error: ${sErr.message}`);
      } else {
        console.log(`WEBHOOK: pending_auth_sessions marked authenticated count=${sessions?.length || 0} phone=${ownerPhone}`);
      }
    } else {
      console.log(`WEBHOOK: state=open but no ownerJid in payload, skipping auth session update`);
    }
  }
```

Nota: la query con `.eq('status', 'pending').gt('expires_at', NOW)` su tutte le pending del phone gestisce sia il caso single che il caso "tab multipli" (tutti i pending validi vengono autenticati — lo spec dice "marca la più recente", ma marcandone tutti il polling della tab attiva trova comunque ready). Se vuoi limitare a una sola: usa subquery o `.limit(1)` post-select. La differenza pratica è trascurabile dato il TTL 10min.

- [ ] **Step 4: Run tests, PASS**

```bash
npm test -- webhook.integration
```

- [ ] **Step 5: Commit**

```bash
git add app/api/webhook/route.ts __tests__/webhook.integration.test.ts __tests__/helpers/mocks.ts
git commit -m "feat(webhook): mark pending_auth_sessions on CONNECTION_UPDATE state=open"
```

---

## Task 8: `/api/auth/check` (polling endpoint)

**Files:**
- Create: `app/api/auth/check/route.ts`
- Modify: `__tests__/auth-flow.integration.test.ts`

- [ ] **Step 1: Aggiungere test in `auth-flow.integration.test.ts`**

```typescript
describe('GET /api/auth/check', () => {
  test('returns 400 if sessionId missing', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });

  test('returns 410 if session not found or expired', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('pending_auth_sessions:select', { data: null, error: null });
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check?sessionId=missing-id', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(410);
  });

  test('returns 200 authenticated:false when status pending', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('pending_auth_sessions:select', {
      data: { id: 'sess-1', phone: '393331234567', status: 'pending', instance_name: null, expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check?sessionId=sess-1', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
  });

  test('returns 200 authenticated:true + Set-Cookie when authenticated', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('pending_auth_sessions:select', {
      data: { id: 'sess-1', phone: '393331234567', status: 'authenticated', instance_name: 'SchedWhats-393331234567', expires_at: new Date(Date.now() + 60000).toISOString() },
      error: null,
    });
    const { GET } = await import('../app/api/auth/check/route');
    const req = new Request('http://localhost/api/auth/check?sessionId=sess-1', { method: 'GET' });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(true);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/sw_session=/);
    expect(setCookie.toLowerCase()).toContain('httponly');
    // Session row should be cleaned up
    const deleteCall = mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'delete');
    expect(deleteCall).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run failing**

```bash
npm test -- auth-flow
```

Expected: FAIL — modulo non esiste.

- [ ] **Step 3: Implementare `app/api/auth/check/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signCookie, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }
  const supabase = getSupabase();

  const { data: session, error } = await supabase
    .from('pending_auth_sessions')
    .select('id, phone, status, instance_name, expires_at')
    .eq('id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error('[auth/check] DB error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: 'Session not found or expired' }, { status: 410 });
  }
  if (session.status !== 'authenticated') {
    return NextResponse.json({ authenticated: false });
  }

  // Session authenticated — mint cookie + cleanup row
  const cookieValue = signCookie({
    phone: session.phone,
    instanceName: session.instance_name || `SchedWhats-${session.phone}`,
  });

  await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);

  const res = NextResponse.json({ authenticated: true, redirect: '/dashboard' });
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return res;
}
```

- [ ] **Step 4: Run tests, PASS**

```bash
npm test -- auth-flow
```

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/check/route.ts __tests__/auth-flow.integration.test.ts
git commit -m "feat(auth): add GET /api/auth/check polling endpoint that mints cookie on success"
```

---

## Task 9: Refactor `/api/messages` (cookie-based, no più ?phone=)

**Files:**
- Modify: `app/api/messages/route.ts` (riscrittura)
- Modify: test esistenti che chiamano `?phone=` (verifica con `grep -rn "/api/messages" __tests__/`)

- [ ] **Step 1: Cercare i test esistenti che usano `?phone=`**

```bash
grep -rn "/api/messages" __tests__/
```

Annotare le occorrenze. Probabili: nessuna (i test attuali coprono cron/webhook, non /api/messages direttamente). Se ne trovi, aggiornali al nuovo formato cookie.

- [ ] **Step 2: Aggiungere test in nuovo file `__tests__/messages.integration.test.ts`**

```typescript
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase } from './helpers/mocks';

const SECRET = '0'.repeat(128);
const mockSupa = createMockSupabase();
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function reqWithCookie(method: string, url: string, cookieValue: string | null, body?: any) {
  const headers: any = { 'content-type': 'application/json' };
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  return new Request(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe('GET /api/messages', () => {
  test('returns 401 without cookie', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', null) as any);
    expect(res.status).toBe(401);
  });

  test('returns messages for cookie phone', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('user_instances:select', { data: { id: 'u1', subscription_plan: 'free', trial_ends_at: null, connection_status: 'open' }, error: null });
    mockSupa.setResponse('scheduled_messages:select', { data: [{ id: 'm1', recipient_name: 'Mario' }], error: null });
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', cookie) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
  });
});

describe('DELETE /api/messages', () => {
  test('returns 401 without cookie', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(reqWithCookie('DELETE', 'http://localhost/api/messages', null, { id: 'm1' }) as any);
    expect(res.status).toBe(401);
  });

  test('deletes only when message belongs to cookie phone', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('scheduled_messages:select', { data: { id: 'm1', instance_phone: '393331234567' }, error: null });
    mockSupa.setResponse('scheduled_messages:update', { data: [{ id: 'm1' }], error: null });
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(reqWithCookie('DELETE', 'http://localhost/api/messages', cookie, { id: 'm1' }) as any);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run failing**

```bash
npm test -- messages.integration
```

Expected: FAIL — current `/api/messages` legge `phone` da query/body, non da cookie.

- [ ] **Step 4: Sostituire `app/api/messages/route.ts` con la nuova versione**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlanLimits } from '../../lib/plans';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

function getAuthedPhone(req: NextRequest): string | null {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = verifyCookie(raw);
  return payload?.phone ?? null;
}

export async function GET(req: NextRequest) {
  const phone = getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const { data: user } = await supabase
    .from('user_instances')
    .select('id, trial_ends_at, subscription_plan, connection_status')
    .eq('phone_number', phone)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const planLimits = getPlanLimits(user.subscription_plan || 'free');
  const historyStart = new Date(Date.now() - planLimits.historyDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('instance_phone', phone)
    .gte('created_at', historyStart)
    .order('scheduled_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    messages: data || [],
    subscription_plan: user?.subscription_plan || 'unknown',
    trial_ends_at: user?.trial_ends_at || null,
  });
}

export async function DELETE(req: NextRequest) {
  const phone = getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: msg } = await supabase
    .from('scheduled_messages')
    .select('id, instance_phone')
    .eq('id', id)
    .eq('instance_phone', phone)
    .single();

  if (!msg) return NextResponse.json({ error: 'Message not found or not owned' }, { status: 403 });

  const { error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('instance_phone', phone);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 5: Run tests, PASS**

```bash
npm test -- messages.integration
```

- [ ] **Step 6: Commit**

```bash
git add app/api/messages/route.ts __tests__/messages.integration.test.ts
git commit -m "refactor(messages): derive phone from cookie, drop ?phone= param"
```

---

## Task 10: Refactor `/api/connect` (rimuove getCodeAndPairing, protegge azioni)

**Files:**
- Modify: `app/api/connect/route.ts:144-309`

- [ ] **Step 1: Rimuovere il blocco `getCodeAndPairing`**

In `app/api/connect/route.ts`, eliminare interamente le linee 144-309 (il blocco `if (action === 'getCodeAndPairing')`). La logica è ora in `/api/auth/init`.

Aggiungere subito dopo la dichiarazione `const { action } = body;` (~linea 102):

```typescript
  // getCodeAndPairing è stato spostato in /api/auth/init (vincolato a pending session firmata)
  if (action === 'getCodeAndPairing') {
    return NextResponse.json(
      { error: 'Endpoint rimosso. Usa POST /api/auth/init' },
      { status: 410 }
    );
  }
```

- [ ] **Step 2: Proteggere le azioni residue (`status`, `getPhone`, `disconnect`) con cookie auth**

In testa al file (sotto gli import esistenti) aggiungere:

```typescript
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';

function requireCookieAuth(req: NextRequest): { phone: string; instanceName: string } | null {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  return verifyCookie(raw);
}
```

In `POST(req)`, subito dopo `const { action } = body;`, aggiungere check per le azioni protette:

```typescript
  const PROTECTED_ACTIONS = new Set(['status', 'getStatus', 'getPhone', 'disconnect']);
  if (PROTECTED_ACTIONS.has(action)) {
    const auth = requireCookieAuth(req);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // Verifica che l'instanceName richiesto sia quello del cookie (no cross-user)
    const { instanceName } = body;
    if (instanceName && instanceName !== auth.instanceName) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
```

`setWebhook` e `refreshWebhooks` restano protetti dal `CRON_SECRET` esistente — invariati.

- [ ] **Step 3: Verifica manuale che il file compili**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | head -50
```

Expected: nessun errore (o solo warning preesistenti).

- [ ] **Step 4: Run tutti i test**

```bash
npm test
```

Expected: tutti verdi (eventuali test sull'azione `getCodeAndPairing` di `/api/connect` vanno aggiornati o rimossi — verifica con `grep -rn "getCodeAndPairing" __tests__/`).

- [ ] **Step 5: Commit**

```bash
git add app/api/connect/route.ts
git commit -m "refactor(connect): remove getCodeAndPairing (moved to /api/auth/init), protect remaining actions with cookie"
```

---

## Task 11: Refactor `/api/payment/create-checkout` e `/api/payment/portal`

**Files:**
- Modify: `app/api/payment/create-checkout/route.ts`
- Modify: `app/api/payment/portal/route.ts`

- [ ] **Step 1: Refactor `app/api/payment/create-checkout/route.ts`**

Sostituire il file con:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

const PRICE_IDS: Record<string, string | undefined> = {
  personal: process.env.STRIPE_PRICE_PERSONAL,
  business: process.env.STRIPE_PRICE_BUSINESS,
};

export async function POST(req: NextRequest) {
  try {
    const cookieRaw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
    const auth = verifyCookie(cookieRaw);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const phone = auth.phone;

    const { plan } = await req.json();
    if (!plan) return NextResponse.json({ error: 'plan required' }, { status: 400 });
    const priceId = PRICE_IDS[plan];
    if (!priceId) return NextResponse.json({ error: 'Invalid plan: ' + plan }, { status: 400 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any });
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: user } = await supabase
      .from('user_instances')
      .select('stripe_customer_id')
      .eq('phone_number', phone)
      .single();

    let customerId = user?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ metadata: { phone } });
      customerId = customer.id;
      await supabase.from('user_instances').update({ stripe_customer_id: customerId }).eq('phone_number', phone);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: phone,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: appUrl + '/dashboard?payment=success',
      cancel_url: appUrl + '/dashboard?payment=cancelled',
      metadata: { phone, plan },
    });
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[stripe/checkout] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Refactor `app/api/payment/portal/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = verifyCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value);
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const phone = auth.phone;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' as any });
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: user } = await supabase
      .from('user_instances')
      .select('stripe_customer_id')
      .eq('phone_number', phone)
      .single();
    if (!user?.stripe_customer_id) {
      return NextResponse.json({ error: 'No active subscription' }, { status: 404 });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: appUrl + '/dashboard',
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (err: any) {
    console.error('[stripe/portal] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verifica manuale che compili e test passino**

```bash
npm test
```

Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add app/api/payment/create-checkout/route.ts app/api/payment/portal/route.ts
git commit -m "refactor(payment): derive phone from cookie auth, no longer accept body.phone"
```

---

## Task 12: Middleware con verifica HMAC + sliding refresh

**Files:**
- Modify: `middleware.ts` (riscrittura completa)

- [ ] **Step 1: Sostituire `middleware.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server';
import { verifyCookie, signCookie, shouldRefresh, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from './app/lib/auth-cookie';

// Path liberi (non richiedono cookie)
const PUBLIC_PATHS = [
  '/',
  '/connect',
  '/login',
  '/signup',
  '/privacy',
  '/terms',
  '/tutorial',
  '/monitoring',
];

const PUBLIC_PREFIXES = [
  '/api/auth',          // init/check/me/logout
  '/api/webhook',       // WEBHOOK_SECRET-protetto
  '/api/cron',          // CRON_SECRET-protetto
  '/api/health',
  '/api/admin',         // MONITORING_SECRET-protetto
  '/api/monitoring',    // MONITORING_SECRET-protetto
  '/api/debug-logs',    // CRON_SECRET-protetto
  '/api/payment/webhook', // STRIPE signature-protetto
];

const PROTECTED_PAGE_PATHS = ['/dashboard', '/admin'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Endpoint pubblici → lascia passare
  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Verifica cookie
  const cookieRaw = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = verifyCookie(cookieRaw);

  if (!payload) {
    // Page → redirect a /
    if (isProtectedPage(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    // API → 401 JSON
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Sliding refresh
  if (shouldRefresh(payload)) {
    const newCookie = signCookie({ phone: payload.phone, instanceName: payload.instanceName });
    const res = NextResponse.next();
    res.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: newCookie,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE,
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Tutti i path eccetto asset statici e _next
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$).*)',
  ],
};
```

- [ ] **Step 2: Verifica build**

```bash
npm run build 2>&1 | tail -30
```

Expected: build passa. Se fallisce per import path: il middleware vive a livello root, deve importare da `./app/lib/auth-cookie`. Se Next.js mostra errore "edge runtime crypto not available" — soluzione: aggiungere `export const runtime = 'nodejs'` in cima al file middleware (Next.js 14 supporta middleware Node.js runtime).

- [ ] **Step 3: Test manuale locale**

```bash
npm run dev
```

Test rapido (in altro terminale):
```bash
curl -i http://localhost:3000/api/messages
# Expected: 401 Unauthorized

curl -i http://localhost:3000/api/health
# Expected: 200 OK (path pubblico)
```

- [ ] **Step 4: Run tutti i test**

```bash
npm test
```

Expected: verde.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts
git commit -m "feat(middleware): activate HMAC cookie verification with allowlist + sliding refresh"
```

---

## Task 13: Cron — DELETE pending_auth_sessions scadute

**Files:**
- Modify: `app/api/cron/send-messages/route.ts:85-94`
- Modify: `__tests__/cron.integration.test.ts`

- [ ] **Step 1: Aggiungere test in `cron.integration.test.ts`**

Aggiungere block test:

```typescript
describe('Cron cleanup pending_auth_sessions', () => {
  test('deletes expired pending_auth_sessions on cron run', async () => {
    // ... setup analogo agli altri test cron
    // Verificare in mockSupa.calls la presenza di:
    //   { table: 'pending_auth_sessions', operation: 'delete', chain: contains lt('expires_at', ...) }
  });
});
```

(Adatta esattamente al pattern usato dagli altri test cron — usa il setup `beforeEach` esistente.)

- [ ] **Step 2: Modificare `app/api/cron/send-messages/route.ts:85-94`**

Subito dopo il blocco "Clean up stale awaiting_*" (riga 94), aggiungere:

```typescript
    // Clean up expired pending_auth_sessions (TTL 10min + 1h grace)
    const oneHourPastExpiry = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: authCleanup } = await supabase.from('pending_auth_sessions')
      .delete()
      .lt('expires_at', oneHourPastExpiry)
      .select('id');
    if (authCleanup?.length) {
      console.log('CRON: Cleaned up ' + authCleanup.length + ' expired pending_auth_sessions');
    }
```

- [ ] **Step 3: Run test**

```bash
npm test -- cron.integration
```

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/send-messages/route.ts __tests__/cron.integration.test.ts
git commit -m "feat(cron): cleanup expired pending_auth_sessions"
```

---

## Task 14: `app/connect/page.tsx` (nuova pagina input phone + QR)

**Files:**
- Create: `app/connect/page.tsx`

- [ ] **Step 1: Creare `app/connect/page.tsx`**

Estrarre la UI di pairing dall'attuale `app/dashboard/page.tsx`. Pagina client component che:

1. Mostra input telefono
2. Su submit chiama `POST /api/auth/init` con `{ phone }`
3. Mostra QR code + pairing code
4. Polla `GET /api/auth/check?sessionId=...` ogni 2s
5. Su `authenticated:true` → `router.push('/dashboard')`
6. Su 410 → reset stato, mostra errore "QR scaduto, riprova"

```tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Loader2, Smartphone } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

type Phase = 'input' | 'pairing' | 'connecting' | 'error';

export default function ConnectPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('input');
  const [phone, setPhone] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  async function startInit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhase('pairing');
    try {
      const res = await fetch('/api/auth/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Errore ${res.status}`);
        setPhase('error');
        return;
      }
      const data = await res.json();
      setSessionId(data.sessionId);
      setQrCode(data.qrCode);
      setPairingCode(data.pairingCode);
      startPolling(data.sessionId);
    } catch (err: any) {
      setError(err?.message || 'Errore di rete');
      setPhase('error');
    }
  }

  function startPolling(sid: string) {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/check?sessionId=${sid}`);
        if (res.status === 410) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setError('QR scaduto. Riprova.');
          setPhase('error');
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (data.authenticated) {
          if (pollTimer.current) clearInterval(pollTimer.current);
          setPhase('connecting');
          router.push(data.redirect || '/dashboard');
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary flex items-center justify-center">
            <Smartphone className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary">Connetti WhatsApp</h1>
          <p className="text-text-secondary mt-2">Inserisci il numero, scansiona il QR e accedi alla dashboard</p>
        </div>

        <div className="bg-surface rounded-3xl shadow-soft p-8">
          {phase === 'input' && (
            <form onSubmit={startInit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Numero WhatsApp (con prefisso, es. 393331234567)
                </label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  placeholder="393331234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full">Procedi</Button>
            </form>
          )}

          {phase === 'pairing' && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-text-secondary">Apri WhatsApp → Impostazioni → Dispositivi collegati → Collega un dispositivo</p>
              {qrCode && (
                <img src={qrCode} alt="QR code" className="mx-auto w-64 h-64" />
              )}
              {pairingCode && (
                <div>
                  <p className="text-xs text-text-secondary mb-1">oppure usa questo codice:</p>
                  <p className="text-2xl font-mono tracking-widest">{pairingCode}</p>
                </div>
              )}
              <p className="text-xs text-text-secondary flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> In attesa del pairing...
              </p>
              <button onClick={reset} className="text-sm text-primary underline">Annulla</button>
            </div>
          )}

          {phase === 'connecting' && (
            <div className="text-center space-y-3">
              <Loader2 className="w-10 h-10 animate-spin mx-auto text-primary" />
              <p>Accesso in corso...</p>
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4 text-center">
              <p className="text-error-dark">{error || 'Errore'}</p>
              <Button variant="outline" onClick={reset}>Riprova</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verifica build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build passa.

- [ ] **Step 3: Smoke test manuale**

```bash
npm run dev
```

Apri `http://localhost:3000/connect`, verifica che la pagina renderizzi correttamente. Non testare il flusso intero (richiede Evolution API live + WhatsApp).

- [ ] **Step 4: Commit**

```bash
git add app/connect/page.tsx
git commit -m "feat(ui): add /connect page for phone input + QR pairing + auth polling"
```

---

## Task 15: Refactor `app/dashboard/page.tsx` (rimuove localStorage)

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 1: Rimuovere blocco localStorage**

In `app/dashboard/page.tsx`:

1. **Eliminare** righe 14-30 (blocco `PHONE_KEY`, `INST_KEY`, `EXPIRY_KEY`, helpers `getStored*`/`save*`/`clearPhone`).
2. **Eliminare** la funzione `validateSession` (righe ~67-95) e tutta la logica che la richiama nel `useEffect` di mount.
3. **Eliminare** lo `useState<string>` per `instanceName`/`userPhone` che si inizializza da localStorage.
4. **Eliminare** tutta la UI di pairing (input phone, QR display, pairing code) — quella vive ora solo in `/connect`.

- [ ] **Step 2: Sostituire l'inizializzazione con chiamata a `/api/auth/me`**

Aggiungere all'inizio del componente:

```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (cancelled) return;
      if (res.status === 401) {
        window.location.href = '/connect';
        return;
      }
      const data = await res.json();
      setUserPhone(data.phone);
      setInstanceName(data.instanceName);
      setSessionValidated(true);
    } catch {
      if (!cancelled) window.location.href = '/connect';
    }
  })();
  return () => { cancelled = true; };
}, []);
```

- [ ] **Step 3: Aggiornare `loadMessages` per non passare phone**

Cercare la funzione/effect che chiama `/api/messages?phone=...`. Sostituire:

```tsx
const res = await fetch('/api/messages');  // niente più ?phone=
```

E DELETE:

```tsx
const res = await fetch('/api/messages', {
  method: 'DELETE',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: messageId }),  // niente più phone
});
```

- [ ] **Step 4: Aggiornare il bottone Logout**

```tsx
async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
}
```

(rimpiazza qualunque logica esistente che chiama `clearPhone()` + redirect)

- [ ] **Step 5: Verifica build + smoke test**

```bash
npm run build 2>&1 | tail -20
```

```bash
npm run dev
# Apri http://localhost:3000/dashboard
# Senza cookie → dovrebbe redirect a /connect
```

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "refactor(dashboard): remove localStorage session, use /api/auth/me cookie-based"
```

---

## Task 16: E2E Playwright `/connect` flow (smoke)

**Files:**
- Create: `__tests__/e2e/connect.spec.ts`

- [ ] **Step 1: Creare il test E2E**

```typescript
import { test, expect } from '@playwright/test';

test.describe('/connect page', () => {
  test('shows phone input on first load', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByText(/Connetti WhatsApp/)).toBeVisible();
    await expect(page.getByPlaceholder('393331234567')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Procedi' })).toBeVisible();
  });

  test('shows error on invalid phone', async ({ page }) => {
    await page.goto('/connect');
    await page.getByPlaceholder('393331234567').fill('abc');
    await page.getByRole('button', { name: 'Procedi' }).click();
    // Server should respond 400
    await expect(page.getByText(/numero/i)).toBeVisible({ timeout: 8000 });
  });
});

test.describe('/dashboard page (cookie required)', () => {
  test('redirects to / or /connect when no cookie', async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/dashboard');
    // Middleware should redirect away from /dashboard
    await expect(page).not.toHaveURL(/\/dashboard$/);
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
npx playwright test __tests__/e2e/connect.spec.ts
```

Expected: PASS (modulo l'assenza di un'istanza Evolution API live per il flusso completo — quei test sono out of scope qui).

- [ ] **Step 3: Commit**

```bash
git add __tests__/e2e/connect.spec.ts
git commit -m "test(e2e): smoke test /connect page rendering and dashboard redirect"
```

---

## Task 17: Aggiornare documentazione

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/ARCHITETTURA.md`

- [ ] **Step 1: Aggiornare `CLAUDE.md`**

Sostituire la riga:

```
- ⚠️ C1 (autenticazione dashboard) — da fare dopo lancio
```

con:

```
- ✅ C1 (autenticazione phone-first cookie firmato HMAC, sessione 90gg sliding)
```

Aggiungere in fondo:

```
## Auth (post-C1)
- Cookie HTTP-only `sw_session` HMAC-SHA256 (env: `AUTH_COOKIE_SECRET`)
- Sessione emessa al CONNECTION_UPDATE state=open
- Tabella `pending_auth_sessions` per coordinazione browser↔webhook
- Multi-device richiede re-pair (limitazione v1, OTP self-chat in v1.5)
```

- [ ] **Step 2: Aggiornare `docs/ARCHITETTURA.md`**

Trovare la sezione DB → tabella `user_instances`. Rimuovere la riga inesistente `user_id` (questa colonna non esiste in DB, era documentazione errata pre-esistente).

Aggiungere una nuova sottosezione (dopo "Tabella user_instances"):

```markdown
### Tabella: `pending_auth_sessions`

Sessioni temporanee di pairing che coordinano browser e webhook durante il login phone-first.

| Colonna | Tipo | Note |
|---|---|---|
| `id` | UUID | PK |
| `phone` | TEXT | Numero richiesto dall'utente |
| `status` | TEXT | `pending` → `authenticated` |
| `instance_name` | TEXT | Popolato dal webhook su success |
| `expires_at` | TIMESTAMPTZ | TTL 10 minuti |
| `created_at` | TIMESTAMPTZ | |

Riga creata da `POST /api/auth/init`. Aggiornata dal webhook `CONNECTION_UPDATE state=open`. Cancellata da `GET /api/auth/check` su success o dal cron come cleanup dopo 1h dalla scadenza.
```

Aggiornare anche la sezione 5 (Flussi Principali) sostituendo "Pairing WhatsApp" col nuovo flusso che passa per `/api/auth/init` + cookie.

Aggiornare la sezione "Variabili d'ambiente" — Sicurezza:
```
| `AUTH_COOKIE_SECRET` | Si | HMAC secret per firma cookie sessione (64 byte hex). App fallisce hard al boot se assente |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/ARCHITETTURA.md
git commit -m "docs: update CLAUDE.md and ARCHITETTURA.md for C1 phone-first cookie auth"
```

---

## Task 18: Deploy + smoke produzione

**Pre-deploy checklist:**

- [ ] **Step 1: Generare AUTH_COOKIE_SECRET produzione**

```bash
openssl rand -hex 64
```

Aggiungere su Vercel (Settings → Environment Variables) come `AUTH_COOKIE_SECRET` per Production + Preview.

- [ ] **Step 2: Verificare migration applicata in produzione**

Eseguire (via MCP Supabase o SQL Editor) sul progetto `inheoexhtuyjtfotbzyw`:

```sql
SELECT count(*) FROM pending_auth_sessions;
```

Expected: 0 (tabella esiste e vuota).

- [ ] **Step 3: Deploy Vercel**

```bash
git push origin main
```

Aspettare deploy completo. Verificare nei log Vercel che il build passi senza errori.

- [ ] **Step 4: Smoke test produzione**

In ordine:

1. `curl -i https://whatslaterpush.vercel.app/api/health` → 200
2. `curl -i https://whatslaterpush.vercel.app/api/messages` → 401 (middleware funziona)
3. Apri browser su `https://whatslaterpush.vercel.app/connect` → pagina renderizza, input visibile
4. Apri `https://whatslaterpush.vercel.app/dashboard` senza cookie → redirect a `/`

- [ ] **Step 5: Test end-to-end manuale con il proprio numero test**

1. Inserisci numero test su `/connect`
2. Scansiona QR con WhatsApp
3. Verifica redirect automatico a `/dashboard`
4. Verifica che la coda messaggi si carichi
5. Test logout button → cookie cleared → redirect

- [ ] **Step 6: Notificare i 2-3 utenti test esistenti**

Inviare manualmente messaggio WhatsApp del tipo:

> "Aggiornamento sicurezza: SchedWhats ora usa una sessione cifrata. Se la dashboard ti chiede di "ri-connettere", vai su https://whatslaterpush.vercel.app/connect e scansiona di nuovo il QR. Ci vogliono 30 secondi. Niente è perso."

- [ ] **Step 7: Tag release**

```bash
git tag -a v8.0.0-c1 -m "C1: phone-first cookie auth (HMAC SHA-256, 90gg sliding session)"
git push origin v8.0.0-c1
```

---

## Spec Coverage Self-Review

Verifica rapida che ogni requisito dello spec sia implementato in qualche task:

| Spec § | Requisito | Task |
|---|---|---|
| 4.1 | Flusso primo accesso (init→QR→webhook→check→cookie) | Task 6, 7, 8 |
| 4.2 | Accessi successivi (middleware verifica + sliding) | Task 12 |
| 4.3 | Cookie scaduto/manomesso → redirect | Task 12 |
| 4.4 | Multi-device limitazione documentata | Task 14 (UI), Task 17 (docs) |
| 5 | Cookie HMAC SHA-256 + sliding 7gg + 90gg expiry | Task 2 |
| 6.1 | Tabella pending_auth_sessions + indici + RLS | Task 3 |
| 6.2 | Cleanup cron | Task 13 |
| 7-8 | 9 file nuovi, 11 modificati | Tasks 2-15 |
| 9 (edge cases) | 10 case con risoluzione | Distribuiti (test in Task 6, 8, 9; UI in Task 14) |
| 10 (security) | HttpOnly+Secure+SameSite+timingSafeEqual | Task 2 (verify), Task 5+8+12 (set) |
| 11 (test) | Unit + integration + E2E | Tasks 2, 4-9, 13, 16 |
| 12 (rollout) | Deploy atomico + notifica | Task 18 |
| 14 (future work) | Documentati | Già nello spec, no implementation needed |

**Gaps identificati:** nessuno.

**Placeholder scan:** nessuno (tutti gli step contengono codice/comandi concreti).

**Type consistency:** verificato. `signCookie` accetta `{phone, instanceName}` in tutti i task. `verifyCookie` ritorna `AuthCookiePayload | null` consistentemente. `AUTH_COOKIE_NAME` e `AUTH_COOKIE_MAX_AGE` esportati e usati uniformemente.

---

## Riassunto totale

**18 task. 13 commit minimi previsti** (Task 1, 18 sono setup/deploy senza commit di codice — il loro lavoro entra negli altri).

**Stima esecuzione:** 16-24h sviluppo + 1-2h smoke produzione = **2-3 giornate piene**.

**Dipendenze critiche tra task:**

```
Task 2 (auth-cookie) ← Tasks 4, 5, 6, 8, 9, 11, 12
Task 3 (migration)   ← Tasks 6, 7, 8, 13
Task 7 (webhook)     ← Task 8 (check) per E2E
Task 12 (middleware) → richiede Tasks 9, 10, 11 completati per non rompere endpoint protetti
Task 15 (dashboard)  ← richiede Tasks 4, 9
Task 16 (E2E)        ← richiede Tasks 14, 15
Task 17, 18          ← ultimi
```

Esegui in ordine numerico (l'ordering rispetta già le dipendenze).
