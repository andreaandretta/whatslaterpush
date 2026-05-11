# Dashboard Contact Picker & Direct Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Nuovo contatto" flow on the dashboard that lets users pick a recipient from their WhatsApp address book (via Evolution `findContacts`) or enter one manually, then schedule a message via a visual calendar modal that POSTs directly to `/api/messages` — bypassing the legacy `wa.me` self-chat AI flow which is kept as fallback.

**Architecture:** A new `ContactPickerModal` (WhatsApp-style list with search + collapsed manual-entry section) feeds a selected contact into `ScheduleModal` (custom `MiniCalendar` + time chips + textarea). On submit, a new `POST /api/messages` validates input, enforces `maxContacts` plan limits, and inserts a `pending` row that the existing cron picks up. The `MessagesSection` is renamed "Messaggi programmati" with a WhatsApp-style row layout using a new `ContactAvatar` component.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind, Supabase, Evolution API v2, date-fns, lucide-react, Jest + ts-jest (`__tests__/`), Playwright e2e (`__tests__/e2e/` against deployed Vercel URL).

**Spec:** [`docs/superpowers/specs/2026-05-11-dashboard-contact-picker-design.md`](../specs/2026-05-11-dashboard-contact-picker-design.md)

**Pre-existing infrastructure to reuse (do NOT duplicate):**
- `app/lib/phone.ts` — `validatePhone()` and `normalizeItalianPhone()` already exist and handle every case we need. The spec referred to a "new `lib/phone.ts`" but reality has it under `app/lib/`. Use the existing module.
- `app/lib/plans.ts` — `getPlanLimits(plan).maxContacts`
- `app/lib/auth-cookie.ts` — `verifyCookie`, `AUTH_COOKIE_NAME`
- `__tests__/helpers/mocks.ts` — `createMockSupabase`, `createFetchMock`, `mockRequest`
- `components/Button.tsx` — variants: `primary | secondary | outline | ghost | danger`

---

## Task 1: Add `findContacts` to Evolution client

**Files:**
- Modify: `lib/evolution/client.ts` (add a method on the class)
- Test: `__tests__/evolution-findContacts.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `__tests__/evolution-findContacts.test.ts`:

```ts
/**
 * Unit test for evolutionClient.findContacts.
 * Mocks global fetch; verifies request shape and response handling.
 */

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

describe('evolutionClient.findContacts', () => {
  test('POSTs to /chat/findContacts/{instance} with empty where filter and apikey header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => [],
    });
    (global as any).fetch = mockFetch;

    jest.resetModules();
    const { evolutionClient } = await import('../lib/evolution/client');
    await evolutionClient.findContacts('SchedWhats-123');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe('https://evo.test/chat/findContacts/SchedWhats-123');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ where: {} });
    expect(opts.headers.apikey).toBe('evo-key');
  });

  test('returns parsed array on 200', async () => {
    const sample = [
      { remoteJid: '393331234567@s.whatsapp.net', pushName: 'Mario', name: 'Mario Rossi' },
      { remoteJid: '393339998877@s.whatsapp.net', pushName: 'Anna', name: null },
    ];
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => sample,
    });

    jest.resetModules();
    const { evolutionClient } = await import('../lib/evolution/client');
    const result = await evolutionClient.findContacts('SchedWhats-123');

    expect(result).toEqual(sample);
  });

  test('throws on non-2xx', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Error',
    });

    jest.resetModules();
    const { evolutionClient } = await import('../lib/evolution/client');
    await expect(evolutionClient.findContacts('SchedWhats-123')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx jest evolution-findContacts.test.ts`
Expected: FAIL — `evolutionClient.findContacts is not a function`

- [ ] **Step 1.3: Add the method to `lib/evolution/client.ts`**

Open `lib/evolution/client.ts`. After the `getQRCode` method (around line 201) and before the closing brace of the `EvolutionClient` class, add:

```ts
  /**
   * Fetch all contacts known to this WhatsApp instance.
   * Returns Evolution's raw contact objects (caller is responsible for filtering/mapping).
   */
  async findContacts(instanceName: string): Promise<Array<{
    remoteJid?: string
    pushName?: string | null
    name?: string | null
    profilePicUrl?: string | null
  }>> {
    return this.request(`/chat/findContacts/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ where: {} }),
    })
  }
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx jest evolution-findContacts.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 1.5: Commit**

```bash
git add lib/evolution/client.ts __tests__/evolution-findContacts.test.ts
git commit -m "feat(evolution): add findContacts method"
```

---

## Task 2: Refactor `QuickCaptureModal` to use `validatePhone` from `app/lib/phone`

This deduplicates phone normalization. The existing modal's `normalizeClientPhone` accepts 7+ digits; `validatePhone` requires 10–15. The stricter validation is intentional and aligns with the rest of the codebase.

**Files:**
- Modify: `components/QuickCaptureModal.tsx`
- Test: `__tests__/quick-capture-utils.test.ts` (existing tests must still pass)

- [ ] **Step 2.1: Replace the inline normalizer**

Open `components/QuickCaptureModal.tsx`. Replace lines 15–29 (the `normalizeClientPhone` function) with:

```tsx
import { validatePhone } from '../app/lib/phone';
```

Add this import at the top with the other imports (line 8 area, after the formatDatePhrase import). Then **delete** the entire `normalizeClientPhone` function (lines 15–29).

- [ ] **Step 2.2: Update the call site**

In `handleSubmit` (around line 68), replace:

```tsx
    const cleanPhone = normalizeClientPhone(phone);
```

with:

```tsx
    const cleanPhone = validatePhone(phone);
```

- [ ] **Step 2.3: Run the full unit test suite**

Run: `npm test`
Expected: PASS — all 88 existing tests still green. (No new test added; this is a behavior-preserving refactor verified by the existing suite.)

- [ ] **Step 2.4: Manual smoke test**

Run: `npm run dev`. Open dashboard, click "Nuovo follow-up", type "3331234567" + nome + datetime + messaggio, click "Apri WhatsApp e invia". Verify the wa.me URL still opens with phrase `Invia a {name} 393331234567 ...`.

- [ ] **Step 2.5: Commit**

```bash
git add components/QuickCaptureModal.tsx
git commit -m "refactor(quick-capture): use validatePhone from app/lib/phone"
```

---

## Task 3: Add `POST` handler to `/api/messages/route.ts`

**Files:**
- Modify: `app/api/messages/route.ts` (add POST export at the bottom; do not change GET/DELETE)
- Test: `__tests__/messages-post.integration.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `__tests__/messages-post.integration.test.ts`:

```ts
/**
 * Integration tests for POST /api/messages.
 * Mocks Supabase + verifies plan limits, validation, and insert shape.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callPost(body: any, opts: { authed?: boolean } = { authed: true }) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { POST } = await import('../app/api/messages/route');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cookies: Record<string, string> = {};
  if (opts.authed) {
    const value = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
    cookies[AUTH_COOKIE_NAME] = value;
  }
  const req: any = mockRequest(body, headers);
  // mockRequest doesn't carry cookies; we patch them
  req.cookies = {
    get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined,
  };
  return POST(req);
}

function mockUserInstance(plan = 'personal') {
  // First chain call: select user_instances where phone_number=phone → single
  // Default mock returns null; we explicitly set it via responseMap
  (mockSupa as any).setResponse?.('user_instances:select', {
    id: 'user-uuid-1', subscription_plan: plan, connection_status: 'open',
  });
}

describe('POST /api/messages', () => {
  test('401 when no session cookie', async () => {
    const res = await callPost({
      recipient_number: '393339998877', message: 'hi', scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    }, { authed: false });
    expect(res.status).toBe(401);
  });

  test('400 invalid_phone when recipient is a group jid', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: '12345@g.us', message: 'hi', scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_phone');
  });

  test('400 self_target when recipient equals user phone', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: USER_PHONE, message: 'hi', scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('self_target');
  });

  test('400 invalid_datetime when scheduled_at is in the past', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: '393339998877', message: 'hi',
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_datetime');
  });

  test('400 invalid_message when empty', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: '393339998877', message: '   ',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_message');
  });

  test('200 inserts a pending row with normalized number and correct fields', async () => {
    mockUserInstance('personal');
    // existing contacts/messages empty (default null → treated as empty)
    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await callPost({
      recipient_number: '3339998877', // unnormalized, should become 393339998877
      recipient_name: 'Anna',
      message: 'Ciao Anna',
      scheduled_at: at,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('pending');

    const insertCall = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert');
    expect(insertCall).toBeDefined();
    const inserted = insertCall!.args[0];
    expect(inserted.recipient_number).toBe('393339998877');
    expect(inserted.recipient_name).toBe('Anna');
    expect(inserted.instance_phone).toBe(USER_PHONE);
    expect(inserted.user_instance_id).toBe('user-uuid-1');
    expect(inserted.status).toBe('pending');
    expect(inserted.parsed_message).toBe('Ciao Anna');
    expect(inserted.caption).toBe('Ciao Anna');
  });

  test('403 plan_contacts_limit_exceeded when new recipient pushes count over maxContacts', async () => {
    mockUserInstance('free'); // free.maxContacts = 5
    // pending_contacts has 3, scheduled_messages distinct has 2 more (total 5)
    (mockSupa as any).setResponse?.('pending_contacts:select', [
      { recipient_number: '1' }, { recipient_number: '2' }, { recipient_number: '3' },
    ]);
    (mockSupa as any).setResponse?.('scheduled_messages:select', [
      { recipient_number: '4' }, { recipient_number: '5' },
    ]);

    const res = await callPost({
      recipient_number: '393339998877', // new (#6)
      message: 'hi',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('plan_contacts_limit_exceeded');
    expect(body.limit).toBe(5);
  });

  test('200 when re-scheduling for an existing recipient even at the cap', async () => {
    mockUserInstance('free');
    (mockSupa as any).setResponse?.('pending_contacts:select', [
      { recipient_number: '393339998877' },
      { recipient_number: '2' }, { recipient_number: '3' }, { recipient_number: '4' }, { recipient_number: '5' },
    ]);
    (mockSupa as any).setResponse?.('scheduled_messages:select', []);

    const res = await callPost({
      recipient_number: '393339998877',
      message: 'hi',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx jest messages-post.integration.test.ts`
Expected: FAIL — `POST is not a function` (route doesn't export POST yet).

- [ ] **Step 3.3: Add the POST handler**

Open `app/api/messages/route.ts`. First add the `validatePhone` import to the existing imports at the top of the file:

```ts
import { validatePhone } from '../../lib/phone';
```

Then, after the DELETE handler (end of file), append:

```ts
export async function POST(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { recipient_number: rawNumber, recipient_name, message, scheduled_at } = body || {};

  // --- Validation ---
  if (typeof rawNumber !== 'string' || rawNumber.includes('@g.us') || rawNumber.includes('@broadcast')) {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  }

  const normalized = validatePhone(rawNumber);
  if (!normalized) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  if (normalized === phone) {
    return NextResponse.json({ error: 'self_target' }, { status: 400 });
  }

  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 3500) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }

  if (typeof scheduled_at !== 'string') {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }
  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 60_000) {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }

  // --- Lookup user instance ---
  const supabase = getSupabase();
  const { data: user } = await supabase
    .from('user_instances')
    .select('id, subscription_plan')
    .eq('phone_number', phone)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // --- Plan limit (maxContacts on new recipients only) ---
  const plan = user.subscription_plan || 'free';
  const limits = getPlanLimits(plan);

  const { data: pendingContacts } = await supabase
    .from('pending_contacts')
    .select('recipient_number')
    .eq('owner_phone', phone);

  const { data: scheduledContacts } = await supabase
    .from('scheduled_messages')
    .select('recipient_number')
    .eq('instance_phone', phone)
    .neq('status', 'cancelled');

  const knownSet = new Set<string>();
  for (const row of pendingContacts || []) if (row.recipient_number) knownSet.add(row.recipient_number);
  for (const row of scheduledContacts || []) if (row.recipient_number) knownSet.add(row.recipient_number);

  if (!knownSet.has(normalized) && knownSet.size >= limits.maxContacts) {
    return NextResponse.json({
      error: 'plan_contacts_limit_exceeded',
      plan,
      limit: limits.maxContacts,
    }, { status: 403 });
  }

  // --- Insert pending row ---
  const cleanMessage = message.trim();
  const cleanName = typeof recipient_name === 'string' && recipient_name.trim().length > 0
    ? recipient_name.trim().slice(0, 100)
    : null;

  const { data: inserted, error: insErr } = await supabase
    .from('scheduled_messages')
    .insert({
      user_instance_id: user.id,
      instance_phone: phone,
      recipient_number: normalized,
      recipient_name: cleanName,
      caption: cleanMessage,
      parsed_message: cleanMessage,
      scheduled_at: scheduledDate.toISOString(),
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      wa_message_id: null,
    })
    .select('id, scheduled_at')
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    id: inserted.id,
    scheduled_at: inserted.scheduled_at,
    status: 'pending',
  });
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `npx jest messages-post.integration.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 3.5: Run the full test suite to verify no regressions**

Run: `npm test`
Expected: PASS — all previous tests + 8 new ones.

- [ ] **Step 3.6: Commit**

```bash
git add app/api/messages/route.ts __tests__/messages-post.integration.test.ts
git commit -m "feat(api): POST /api/messages for direct scheduling from dashboard"
```

---

## Task 4: Create `GET /api/contacts` route

**Files:**
- Create: `app/api/contacts/route.ts`
- Test: `__tests__/contacts-get.integration.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `__tests__/contacts-get.integration.test.ts`:

```ts
/**
 * Integration tests for GET /api/contacts.
 * Mocks Supabase + evolutionClient.findContacts.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

// Mock evolutionClient module
const findContactsMock = jest.fn();
jest.mock('../lib/evolution/client', () => ({
  evolutionClient: { findContacts: findContactsMock },
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

beforeEach(() => {
  mockSupa.calls.length = 0;
  findContactsMock.mockReset();
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
  };
  (mockSupa as any).setResponse('user_instances:select', {
    id: 'user-uuid-1', instance_name: INSTANCE, phone_number: USER_PHONE,
  });
});

afterEach(() => { process.env = ORIGINAL_ENV; });

async function callGet(opts: { authed?: boolean } = { authed: true }) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  jest.mock('../lib/evolution/client', () => ({ evolutionClient: { findContacts: findContactsMock } }));
  const { GET } = await import('../app/api/contacts/route');

  const cookies: Record<string, string> = {};
  if (opts.authed) {
    const value = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
    cookies[AUTH_COOKIE_NAME] = value;
  }
  const req: any = mockRequest({}, {});
  req.cookies = { get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined };
  return GET(req);
}

describe('GET /api/contacts', () => {
  test('401 without cookie', async () => {
    const res = await callGet({ authed: false });
    expect(res.status).toBe(401);
  });

  test('returns filtered + sorted contacts', async () => {
    findContactsMock.mockResolvedValue([
      { remoteJid: '393339998877@s.whatsapp.net', pushName: 'Anna', name: 'Anna Rossi' },
      { remoteJid: '1234@g.us', pushName: 'Family Group', name: null },              // filtered: group
      { remoteJid: 'broadcast@broadcast', pushName: null, name: null },               // filtered: broadcast
      { remoteJid: `${USER_PHONE}@s.whatsapp.net`, pushName: 'Me', name: 'Me' },     // filtered: self
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: null },
      { remoteJid: 'invalid@s.whatsapp.net', pushName: 'NoNum', name: null },         // filtered: no digits
    ]);

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toEqual([
      { number: '393339998877', name: 'Anna Rossi', pushName: 'Anna' },
      { number: '393331112233', name: 'Marco', pushName: 'Marco' },
    ]);
  });

  test('502 when Evolution throws', async () => {
    findContactsMock.mockRejectedValue(new Error('Evolution API error: 500 - down'));
    const res = await callGet();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('evolution_unavailable');
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `npx jest contacts-get.integration.test.ts`
Expected: FAIL — cannot resolve `app/api/contacts/route`.

- [ ] **Step 4.3: Create the route**

Create `app/api/contacts/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';
import { evolutionClient } from '@/lib/evolution/client';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

interface OutContact {
  number: string;
  name: string;
  pushName?: string;
}

export async function GET(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const phone = payload.phone;
  const supabase = getSupabase();

  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('phone_number', phone)
    .single();

  if (!user?.instance_name) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  let raw_contacts: any[];
  try {
    raw_contacts = await evolutionClient.findContacts(user.instance_name);
  } catch (e: any) {
    const msg = e?.message || '';
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return NextResponse.json({ error: 'evolution_timeout' }, { status: 504 });
    }
    return NextResponse.json({ error: 'evolution_unavailable' }, { status: 502 });
  }

  const out: OutContact[] = [];
  for (const c of raw_contacts || []) {
    const jid: string = c?.remoteJid || '';
    if (!jid || jid.includes('@g.us') || jid.includes('@broadcast')) continue;

    const numericPart = jid.split('@')[0];
    const normalized = validatePhone(numericPart);
    if (!normalized) continue;
    if (normalized === phone) continue;

    const displayName = (c.name && c.name.trim()) || (c.pushName && c.pushName.trim()) || `+${normalized}`;
    const entry: OutContact = { number: normalized, name: displayName };
    if (c.pushName) entry.pushName = c.pushName;
    out.push(entry);
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'it'));

  return NextResponse.json({ contacts: out });
}
```

- [ ] **Step 4.4: Run test to verify it passes**

Run: `npx jest contacts-get.integration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 4.5: Commit**

```bash
git add app/api/contacts/route.ts __tests__/contacts-get.integration.test.ts
git commit -m "feat(api): GET /api/contacts proxies Evolution findContacts"
```

---

## Task 5: Create `ContactAvatar` component

**Files:**
- Create: `components/ContactAvatar.tsx`
- Test: `__tests__/contact-avatar.test.tsx`

- [ ] **Step 5.1: Write the failing test**

Create `__tests__/contact-avatar.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ContactAvatar } from '../components/ContactAvatar';

describe('ContactAvatar', () => {
  test('uses two-letter initials from a two-word name', () => {
    render(<ContactAvatar name="Mario Rossi" number="393331234567" />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });

  test('uses single-letter initial from a one-word name', () => {
    render(<ContactAvatar name="Anna" number="393339998877" />);
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  test('falls back to last 2 digits of number when name missing', () => {
    render(<ContactAvatar number="393339998877" />);
    expect(screen.getByText('77')).toBeInTheDocument();
  });

  test('falls back to last 2 digits when name is empty string', () => {
    render(<ContactAvatar name="" number="393331234567" />);
    expect(screen.getByText('67')).toBeInTheDocument();
  });

  test('assigns deterministic color from number hash', () => {
    const { container: c1 } = render(<ContactAvatar name="A" number="393331111111" />);
    const { container: c2 } = render(<ContactAvatar name="B" number="393331111111" />);
    const bg1 = (c1.firstChild as HTMLElement).className;
    const bg2 = (c2.firstChild as HTMLElement).className;
    expect(bg1).toEqual(bg2); // same number → same color even with different names
  });

  test('uppercases initials', () => {
    render(<ContactAvatar name="mario rossi" number="393331234567" />);
    expect(screen.getByText('MR')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `npx jest contact-avatar.test.tsx`
Expected: FAIL — cannot resolve `components/ContactAvatar`.

- [ ] **Step 5.3: Create the component**

Create `components/ContactAvatar.tsx`:

```tsx
import React from 'react';

interface ContactAvatarProps {
  name?: string;
  number: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const PALETTE = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-indigo-500',
  'bg-orange-500',
];

const SIZES = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
};

function computeInitials(name: string | undefined, number: string): string {
  const n = (name || '').trim();
  if (n) {
    const words = n.split(/\s+/).filter(Boolean);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return words[0][0].toUpperCase();
  }
  const digits = number.replace(/\D/g, '');
  return digits.slice(-2);
}

function hashNumber(number: string): number {
  let h = 0;
  for (let i = 0; i < number.length; i++) h = (h * 31 + number.charCodeAt(i)) >>> 0;
  return h;
}

export function ContactAvatar({ name, number, size = 'md', className = '' }: ContactAvatarProps) {
  const initials = computeInitials(name, number);
  const color = PALETTE[hashNumber(number) % PALETTE.length];
  const sizeClass = SIZES[size];

  return (
    <div
      className={`${color} ${sizeClass} rounded-full flex items-center justify-center text-white font-semibold shrink-0 ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
```

- [ ] **Step 5.4: Run test to verify it passes**

Run: `npx jest contact-avatar.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5.5: Commit**

```bash
git add components/ContactAvatar.tsx __tests__/contact-avatar.test.tsx
git commit -m "feat(ui): ContactAvatar component with initials + deterministic color"
```

---

## Task 6: Create `MiniCalendar` component

**Files:**
- Create: `components/MiniCalendar.tsx`
- Test: `__tests__/mini-calendar.test.tsx`

- [ ] **Step 6.1: Write the failing test**

Create `__tests__/mini-calendar.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MiniCalendar } from '../components/MiniCalendar';

describe('MiniCalendar', () => {
  test('renders the month of the selected date in Italian', () => {
    const may = new Date(2026, 4, 15); // 15 May 2026
    render(<MiniCalendar selectedDate={may} onChange={() => {}} />);
    expect(screen.getByText(/maggio 2026/i)).toBeInTheDocument();
  });

  test('clicking a future day calls onChange with that date', () => {
    const today = new Date(2026, 4, 11); // 11 May 2026 (Mon)
    const onChange = jest.fn();
    render(<MiniCalendar selectedDate={today} onChange={onChange} minDate={today} />);

    // Click day "20"
    const btn = screen.getByRole('button', { name: /^20$/ });
    fireEvent.click(btn);

    expect(onChange).toHaveBeenCalledTimes(1);
    const called = onChange.mock.calls[0][0] as Date;
    expect(called.getFullYear()).toBe(2026);
    expect(called.getMonth()).toBe(4);
    expect(called.getDate()).toBe(20);
  });

  test('past days are disabled', () => {
    const today = new Date(2026, 4, 11);
    const onChange = jest.fn();
    render(<MiniCalendar selectedDate={today} onChange={onChange} minDate={today} />);

    const btn = screen.getByRole('button', { name: /^5$/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
  });

  test('forward arrow advances to next month', () => {
    const may = new Date(2026, 4, 15);
    render(<MiniCalendar selectedDate={may} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText(/mese successivo/i));
    expect(screen.getByText(/giugno 2026/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6.2: Run test to verify it fails**

Run: `npx jest mini-calendar.test.tsx`
Expected: FAIL — cannot resolve `components/MiniCalendar`.

- [ ] **Step 6.3: Create the component**

Create `components/MiniCalendar.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, getDay,
  addMonths, subMonths, format, isSameDay, isBefore, startOfDay,
} from 'date-fns';
import { it } from 'date-fns/locale';

interface MiniCalendarProps {
  selectedDate: Date;
  onChange: (d: Date) => void;
  minDate?: Date;
}

export function MiniCalendar({ selectedDate, onChange, minDate }: MiniCalendarProps) {
  const [viewMonth, setViewMonth] = useState<Date>(startOfMonth(selectedDate));
  const min = minDate ? startOfDay(minDate) : startOfDay(new Date());

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Italian week starts Monday: getDay() returns 0=Sun..6=Sat, we want 0=Mon..6=Sun
  const firstDow = (getDay(monthStart) + 6) % 7;
  const blanks = Array.from({ length: firstDow });

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => setViewMonth(subMonths(viewMonth, 1))}
          aria-label="Mese precedente"
          className="p-2 rounded-full hover:bg-gray-100"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="font-semibold text-text-primary">
          {format(viewMonth, 'MMMM yyyy', { locale: it })}
        </div>
        <button
          type="button"
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
          aria-label="Mese successivo"
          className="p-2 rounded-full hover:bg-gray-100"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary mb-1">
        {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <div key={i}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {blanks.map((_, i) => <div key={'b' + i} />)}
        {days.map((day) => {
          const isPast = isBefore(day, min);
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());

          let cls = 'w-9 h-9 rounded-full text-sm flex items-center justify-center mx-auto ';
          if (isPast) cls += 'text-gray-300 cursor-not-allowed';
          else if (isSelected) cls += 'bg-primary text-white font-semibold';
          else if (isToday) cls += 'ring-2 ring-primary text-primary font-semibold';
          else cls += 'hover:bg-gray-100 text-text-primary';

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={isPast}
              onClick={() => onChange(day)}
              className={cls}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6.4: Run test to verify it passes**

Run: `npx jest mini-calendar.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6.5: Commit**

```bash
git add components/MiniCalendar.tsx __tests__/mini-calendar.test.tsx
git commit -m "feat(ui): MiniCalendar custom month grid with date-fns"
```

---

## Task 7: Create `ScheduleModal` component

This component is too stateful for fine-grained unit tests; rely on the E2E test in Task 11 for full-flow verification. Use manual smoke-test for visual correctness.

**Files:**
- Create: `components/ScheduleModal.tsx`

- [ ] **Step 7.1: Create the component**

Create `components/ScheduleModal.tsx`:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { X, ArrowLeft, Calendar as CalendarIcon } from 'lucide-react';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';
import { MiniCalendar } from './MiniCalendar';

interface ScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onBack: () => void;
  contact: { number: string; name?: string } | null;
  onScheduled: () => void;
}

function defaultTime(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ScheduleModal({ open, onClose, onBack, contact, onScheduled }: ScheduleModalProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedTime, setSelectedTime] = useState<string>(defaultTime());
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedDate(new Date());
      setSelectedTime(defaultTime());
      setMessage('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  if (!open || !contact) return null;

  function combineDateTime(): Date {
    const [h, m] = selectedTime.split(':').map(Number);
    const d = new Date(selectedDate);
    d.setHours(h, m, 0, 0);
    return d;
  }

  function setPreset(kind: 'in1h' | 'tonight18' | 'tomorrow9') {
    const d = new Date();
    if (kind === 'in1h') {
      d.setHours(d.getHours() + 1);
    } else if (kind === 'tonight18') {
      if (d.getHours() >= 18) d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
    } else if (kind === 'tomorrow9') {
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
    }
    setSelectedDate(d);
    setSelectedTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }

  const scheduledDate = combineDateTime();
  const isValidDate = scheduledDate.getTime() >= Date.now() + 60_000;
  const isValidMessage = message.trim().length > 0 && message.length <= 3500;
  const canSubmit = isValidDate && isValidMessage && !submitting;

  async function handleSubmit() {
    if (!canSubmit || !contact) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient_number: contact.number,
          recipient_name: contact.name || undefined,
          message: message.trim(),
          scheduled_at: scheduledDate.toISOString(),
        }),
      });

      if (res.status === 200) {
        onScheduled();
        onClose();
        return;
      }

      const body = await res.json().catch(() => ({}));
      if (res.status === 403 && body.error === 'plan_contacts_limit_exceeded') {
        setError(`Hai raggiunto il limite di ${body.limit} contatti del piano ${body.plan}.`);
      } else if (body.error) {
        setError(translateError(body.error));
      } else {
        setError('Errore inatteso. Riprova.');
      }
    } catch {
      setError('Errore di rete. Riprova.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center sm:px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full sm:h-auto sm:max-w-md sm:rounded-3xl sm:shadow-soft overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <button onClick={onBack} aria-label="Indietro" className="p-1 rounded-full hover:bg-gray-100">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <ContactAvatar name={contact.name} number={contact.number} size="sm" />
            <div>
              <div className="font-semibold text-text-primary text-sm">{contact.name || `+${contact.number}`}</div>
              <div className="text-xs text-text-secondary">+{contact.number}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-gray-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <MiniCalendar selectedDate={selectedDate} onChange={setSelectedDate} />

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">Orario</label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-4 py-2 border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary"
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              <button type="button" onClick={() => setPreset('in1h')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Tra 1h
              </button>
              <button type="button" onClick={() => setPreset('tonight18')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Stasera 18:00
              </button>
              <button type="button" onClick={() => setPreset('tomorrow9')}
                className="text-xs px-3 py-1 rounded-full border border-border hover:bg-background">
                Domani 9:00
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-primary font-medium">
            <CalendarIcon className="w-4 h-4" />
            {format(scheduledDate, "EEEE d MMMM '·' HH:mm", { locale: it })}
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Messaggio</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Scrivi il messaggio…"
              rows={4}
              maxLength={3500}
              className="w-full px-4 py-2 border border-border rounded-xl text-text-primary focus:outline-none focus:border-primary"
            />
            <div className="text-xs text-text-secondary text-right mt-1">{message.length}/3500</div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-error-light text-error-dark text-sm">
              {error}
              {error.includes('limite') && (
                <a href="#prezzi" className="underline ml-2">Aggiorna piano</a>
              )}
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            isLoading={submitting}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Schedula
          </Button>
        </div>
      </div>
    </div>
  );
}

function translateError(code: string): string {
  switch (code) {
    case 'invalid_phone': return 'Numero non valido.';
    case 'invalid_message': return 'Messaggio non valido (vuoto o oltre 3500 caratteri).';
    case 'invalid_datetime': return 'Data/ora non valida (deve essere almeno 1 minuto nel futuro).';
    case 'self_target': return 'Non puoi schedulare a te stesso.';
    default: return 'Errore: ' + code;
  }
}
```

- [ ] **Step 7.2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to the new file.

- [ ] **Step 7.3: Commit**

```bash
git add components/ScheduleModal.tsx
git commit -m "feat(ui): ScheduleModal with MiniCalendar + time chips + direct POST"
```

---

## Task 8: Create `ContactPickerModal` component

**Files:**
- Create: `components/ContactPickerModal.tsx`

- [ ] **Step 8.1: Create the component**

Create `components/ContactPickerModal.tsx`:

```tsx
'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { X, Search, UserPlus, ChevronDown, ChevronUp, AlertCircle, Loader2 } from 'lucide-react';
import { validatePhone } from '../app/lib/phone';
import { Button } from './Button';
import { ContactAvatar } from './ContactAvatar';

interface Contact {
  number: string;
  name: string;
  pushName?: string;
}

interface ContactPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (contact: { number: string; name?: string }) => void;
}

type PickerState =
  | { kind: 'loading' }
  | { kind: 'list'; contacts: Contact[] }
  | { kind: 'error'; reason: 'timeout' | 'unavailable' | 'unauthorized' };

export default function ContactPickerModal({ open, onClose, onSelect }: ContactPickerModalProps) {
  const [state, setState] = useState<PickerState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualNumber, setManualNumber] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setState({ kind: 'loading' });
    setSearch('');
    setManualOpen(false);
    setManualName('');
    setManualNumber('');
    setManualError(null);

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);

    fetch('/api/contacts', { signal: abort.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (res.status === 401) { setState({ kind: 'error', reason: 'unauthorized' }); return; }
        if (!res.ok) { setState({ kind: 'error', reason: 'unavailable' }); return; }
        const body = await res.json();
        const contacts: Contact[] = Array.isArray(body.contacts) ? body.contacts : [];
        setState({ kind: 'list', contacts });
        if (contacts.length === 0) setManualOpen(true);
      })
      .catch((e) => {
        clearTimeout(timer);
        if (e?.name === 'AbortError') setState({ kind: 'error', reason: 'timeout' });
        else setState({ kind: 'error', reason: 'unavailable' });
      });

    return () => { clearTimeout(timer); abort.abort(); };
  }, [open]);

  useEffect(() => {
    if (state.kind === 'error') setManualOpen(true);
  }, [state.kind]);

  const filtered = useMemo(() => {
    if (state.kind !== 'list') return [];
    const q = search.trim().toLowerCase();
    if (!q) return state.contacts;
    return state.contacts.filter((c) =>
      c.name.toLowerCase().includes(q) || c.number.includes(q)
    );
  }, [state, search]);

  function handleManualSubmit() {
    setManualError(null);
    const normalized = validatePhone(manualNumber);
    if (!normalized) {
      setManualError('Numero non valido (min 10 cifre).');
      return;
    }
    onSelect({ number: normalized, name: manualName.trim() || undefined });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center sm:px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-white w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-md sm:rounded-3xl sm:shadow-soft flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-primary text-white">
          <h2 className="font-semibold">Nuovo messaggio</h2>
          <button onClick={onClose} aria-label="Chiudi" className="p-1 rounded-full hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca contatto…"
              className="w-full pl-9 pr-3 py-2 bg-gray-100 rounded-full text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Manual entry section */}
          <button
            type="button"
            onClick={() => setManualOpen(!manualOpen)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <span className="font-semibold text-text-primary">Nuovo contatto</span>
            </div>
            {manualOpen ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {manualOpen && (
            <div className="px-4 pb-4 space-y-2">
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Nome (opzionale)"
                className="w-full px-3 py-2 border border-border rounded-xl text-sm focus:outline-none focus:border-primary"
              />
              <input
                type="tel"
                inputMode="tel"
                value={manualNumber}
                onChange={(e) => setManualNumber(e.target.value)}
                placeholder="Numero (es. 3331234567)"
                className="w-full px-3 py-2 border border-border rounded-xl text-sm focus:outline-none focus:border-primary"
              />
              {manualError && <div className="text-xs text-error-dark">{manualError}</div>}
              <Button type="button" onClick={handleManualSubmit} className="w-full" size="sm">
                Continua
              </Button>
            </div>
          )}

          {/* Section header */}
          {state.kind === 'list' && state.contacts.length > 0 && (
            <div className="px-4 pt-3 pb-1 text-xs font-semibold uppercase text-text-secondary border-t border-gray-100">
              Contatti su WhatsApp ({state.contacts.length})
            </div>
          )}

          {state.kind === 'loading' && (
            <div className="p-8 text-center">
              <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
              <p className="text-sm text-text-secondary">Caricamento contatti…</p>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="p-4 mx-4 my-3 rounded-xl bg-error-light text-error-dark text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {state.reason === 'timeout' && 'Caricamento contatti scaduto. '}
                {state.reason === 'unavailable' && 'Impossibile caricare i contatti. '}
                {state.reason === 'unauthorized' && 'Sessione scaduta. '}
                Puoi inserire il numero manualmente.
              </span>
            </div>
          )}

          {state.kind === 'list' && filtered.length === 0 && state.contacts.length > 0 && (
            <div className="p-8 text-center text-sm text-text-secondary">Nessun risultato per &quot;{search}&quot;.</div>
          )}

          {state.kind === 'list' && state.contacts.length === 0 && (
            <div className="p-8 text-center text-sm text-text-secondary">Nessun contatto in rubrica.</div>
          )}

          {state.kind === 'list' && filtered.map((c) => (
            <button
              key={c.number}
              type="button"
              onClick={() => onSelect({ number: c.number, name: c.name })}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
            >
              <ContactAvatar name={c.name} number={c.number} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-text-primary truncate">{c.name}</div>
                <div className="text-xs text-text-secondary truncate">+{c.number}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add components/ContactPickerModal.tsx
git commit -m "feat(ui): ContactPickerModal with search + manual entry + Evolution fetch"
```

---

## Task 9: Wire dashboard — add "Nuovo contatto" button + modal state

**Files:**
- Modify: `app/dashboard/page.tsx`

- [ ] **Step 9.1: Add imports and state**

Open `app/dashboard/page.tsx`.

Replace the lucide import line (line 4-6) with:

```tsx
import {
  Calendar, CheckCircle2, Loader2, Smartphone, LogOut, Trash2, Plus, UserPlus
} from 'lucide-react';
```

Add these imports after the QuickCaptureModal import (line 9):

```tsx
import ContactPickerModal from '@/components/ContactPickerModal';
import ScheduleModal from '@/components/ScheduleModal';
```

In the `DashboardPage` component, after the `quickCaptureOpen` state line (line 45), add:

```tsx
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<{ number: string; name?: string } | null>(null);
```

- [ ] **Step 9.2: Replace the action button row**

Find the block "Quick Capture Button" (around line 215–224). Replace the entire `<div className="mb-4">…</div>` block with:

```tsx
        {/* Action buttons */}
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => setContactPickerOpen(true)}
            className="w-full sm:w-auto"
          >
            <UserPlus className="w-5 h-5 mr-2" /> Nuovo contatto
          </Button>
          <Button
            variant="outline"
            onClick={() => setQuickCaptureOpen(true)}
            className="w-full sm:w-auto"
          >
            <Plus className="w-5 h-5 mr-2" /> Nuovo follow-up
          </Button>
        </div>
```

- [ ] **Step 9.3: Mount the new modals**

Find the existing `<QuickCaptureModal …/>` line near the bottom of `<main>` (around line 276–280). Right after it, add:

```tsx
        <ContactPickerModal
          open={contactPickerOpen}
          onClose={() => setContactPickerOpen(false)}
          onSelect={(contact) => {
            setSelectedContact(contact);
            setContactPickerOpen(false);
            setScheduleOpen(true);
          }}
        />

        <ScheduleModal
          open={scheduleOpen}
          onClose={() => { setScheduleOpen(false); setSelectedContact(null); }}
          onBack={() => { setScheduleOpen(false); setContactPickerOpen(true); }}
          contact={selectedContact}
          onScheduled={fetchMessages}
        />
```

- [ ] **Step 9.4: Manual smoke test**

Run: `npm run dev`. Open `/dashboard` (logged in). Verify:
- Two buttons are visible: "Nuovo contatto" (primary green) and "Nuovo follow-up" (outline)
- Clicking "Nuovo contatto" opens the picker with the spinner, then the list (or error state if Evolution isn't reachable in dev)
- Expanding "Nuovo contatto" manual section reveals the inputs
- Entering nome + numero + clicking "Continua" → ScheduleModal opens with header showing the contact
- Picking a date in the calendar + a time + a message + clicking "Schedula" → modal closes, the new row appears in the messages list
- Clicking "Nuovo follow-up" still opens the legacy QuickCaptureModal exactly as before

- [ ] **Step 9.5: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): add Nuovo contatto button + ContactPicker/Schedule modals"
```

---

## Task 10: Rewrite `MessagesSection` row layout (WhatsApp-style)

**Files:**
- Modify: `app/dashboard/page.tsx` (the `MessagesSection` function and its dependencies)

- [ ] **Step 10.1: Add a date+time formatter**

In `app/dashboard/page.tsx`, replace the entire `formatCountdown` function (lines 161–193) with `formatScheduled`:

```tsx
  function formatScheduled(scheduledAt: string): { date: string; time: string; urgent: boolean } {
    const target = new Date(scheduledAt);
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);

    const hh = target.getHours().toString().padStart(2, '0');
    const mm = target.getMinutes().toString().padStart(2, '0');
    const time = `${hh}:${mm}`;

    if (diffMs < 0) return { date: 'scaduto', time, urgent: false };

    if (diffMin < 60) {
      return { date: `tra ${diffMin}min`, time, urgent: diffMin < 10 };
    }

    const sameDay = target.toDateString() === now.toDateString();
    if (sameDay) return { date: 'oggi', time, urgent: false };

    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    if (target.toDateString() === tomorrow.toDateString()) return { date: 'domani', time, urgent: false };

    const diffDays = Math.floor((target.setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
    if (diffDays < 7) {
      const days = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
      return { date: days[new Date(scheduledAt).getDay()], time, urgent: false };
    }

    const dd = new Date(scheduledAt).getDate().toString().padStart(2, '0');
    const mo = (new Date(scheduledAt).getMonth() + 1).toString().padStart(2, '0');
    return { date: `${dd}/${mo}`, time, urgent: false };
  }
```

- [ ] **Step 10.2: Update the props passed to `MessagesSection`**

In the JSX where `<MessagesSection …/>` is rendered (around line 232–240), replace `formatCountdown={formatCountdown}` with:

```tsx
            formatScheduled={formatScheduled}
```

- [ ] **Step 10.3: Rewrite the `MessagesSection` function**

Replace the entire `MessagesSection` function (currently around lines 351–418) with:

```tsx
function MessagesSection({ messages, messagesLoading, subscription, onDelete, formatScheduled, statusConfig }: {
  messages: ScheduledMessage[];
  messagesLoading: boolean;
  subscription: SubscriptionState;
  onDelete: (id: string) => void;
  formatScheduled: (d: string) => { date: string; time: string; urgent: boolean };
  statusConfig: Record<string, { color: string; label: string }>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-text-primary">Messaggi programmati</h2>
        <span className="text-sm text-text-secondary bg-white px-3 py-1 rounded-full border border-gray-100">
          {messages.length} messagg{messages.length !== 1 ? 'i' : 'io'}
        </span>
      </div>
      {subscription.expired && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-4 flex items-center justify-between">
          <div><p className="font-semibold text-red-700">Trial Scaduto</p><p className="text-sm text-red-600">Abbonati per continuare.</p></div>
          <a href="#prezzi" className="px-4 py-2 bg-primary text-white rounded-xl font-medium text-sm">Abbonati</a>
        </div>
      )}
      {messagesLoading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin mx-auto mb-2" />
          <p className="text-gray-400">Caricamento...</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center">
          <p className="text-gray-500">Nessun messaggio programmato. Inizia con &quot;Nuovo contatto&quot;.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => {
            const sched = formatScheduled(msg.scheduled_at);
            const status = statusConfig[msg.status] || { color: '#9CA3AF', label: msg.status };
            const cancellable = msg.status === 'pending' || msg.status.startsWith('awaiting_');
            return (
              <div key={msg.id} className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 shadow-sm">
                <ContactAvatar name={msg.recipient_name} number={msg.recipient_number || ''} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold text-text-primary truncate">
                      {msg.recipient_name || `+${msg.recipient_number || '?'}`}
                    </div>
                    <div className={`text-xs shrink-0 ${sched.urgent ? 'text-red-500' : 'text-text-secondary'}`}>
                      {sched.date}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-text-secondary truncate">
                      {(msg.parsed_message || '').substring(0, 60)}
                    </div>
                    <div className="text-xs text-text-secondary flex items-center gap-1.5 shrink-0">
                      <span>{sched.time}</span>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                    </div>
                  </div>
                </div>
                {cancellable && (
                  <button
                    onClick={() => { if (confirm('Vuoi annullare questo invio?')) onDelete(msg.id) }}
                    className="p-2 text-gray-400 hover:text-red-400 transition-colors"
                    title="Annulla invio"
                    aria-label="Annulla invio"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10.4: Import `ContactAvatar` at the top of the file**

Add to the imports section:

```tsx
import { ContactAvatar } from '@/components/ContactAvatar';
```

- [ ] **Step 10.5: Manual smoke test**

Run: `npm run dev`. Open `/dashboard`. Verify:
- Section title is "Messaggi programmati"
- Each row has an avatar, nome bold, preview, date on top-right, time + status dot on bottom-right
- Trash icon still visible only on pending/awaiting rows
- Empty state copy now references "Nuovo contatto"

- [ ] **Step 10.6: Commit**

```bash
git add app/dashboard/page.tsx
git commit -m "feat(dashboard): rename to 'Messaggi programmati' + WhatsApp-style row layout"
```

---

## Task 11: E2E Playwright test (full flow)

**Files:**
- Create: `__tests__/e2e/contact-picker.spec.ts`

- [ ] **Step 11.1: Write the e2e spec**

Create `__tests__/e2e/contact-picker.spec.ts`:

```ts
/**
 * E2E test for the new "Nuovo contatto" flow.
 * Follows the same authenticated-session pattern as quick-capture-modal.spec.ts.
 * Mocks /api/contacts via route interception so the test does not depend on
 * the live Evolution instance having contacts.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const USER_PHONE = '393442582226';
const BASE = 'https://whatslaterpush.vercel.app';

let SESSION_COOKIE_VALUE = '';

test.beforeAll(async () => {
  const apiContext = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await apiContext.get(`/api/auth/check?sessionId=${SESSION_ID}`);
  if (res.status() === 410) {
    throw new Error(
      'Session already consumed or expired. Re-insert via Supabase MCP:\n' +
      `INSERT INTO pending_auth_sessions (id, phone, status, instance_name, expires_at) VALUES ('${SESSION_ID}', '${USER_PHONE}', 'authenticated', 'SchedWhats-${USER_PHONE}', NOW() + INTERVAL '30 minutes');`
    );
  }
  expect(res.status()).toBe(200);
  const setCookie = res.headers()['set-cookie'] || '';
  const match = setCookie.match(/sw_session=([^;]+)/);
  if (!match) throw new Error('No sw_session cookie');
  SESSION_COOKIE_VALUE = match[1];
  await apiContext.dispose();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([{
    name: 'sw_session',
    value: SESSION_COOKIE_VALUE,
    domain: 'whatslaterpush.vercel.app',
    path: '/',
    secure: true,
    sameSite: 'Lax',
  }]);
});

test.describe('Contact picker + direct scheduling', () => {
  test('dashboard shows both buttons', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: /Nuovo contatto/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nuovo follow-up/i })).toBeVisible();
  });

  test('clicking Nuovo contatto opens picker with mocked contact list', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contacts: [
            { number: '393339998877', name: 'Anna Test', pushName: 'Anna' },
            { number: '393331112233', name: 'Marco Test', pushName: 'Marco' },
          ],
        }),
      })
    );

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();

    await expect(page.getByText('Nuovo messaggio')).toBeVisible();
    await expect(page.getByText('Anna Test')).toBeVisible();
    await expect(page.getByText('Marco Test')).toBeVisible();
  });

  test('search filters the contact list', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          contacts: [
            { number: '393339998877', name: 'Anna Test' },
            { number: '393331112233', name: 'Marco Test' },
          ],
        }),
      })
    );

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();
    await page.getByPlaceholder(/Cerca contatto/i).fill('Anna');

    await expect(page.getByText('Anna Test')).toBeVisible();
    await expect(page.getByText('Marco Test')).not.toBeVisible();
  });

  test('manual entry → schedule modal → POST → success', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contacts: [] }) })
    );

    let postBody: any = null;
    await page.route('**/api/messages', async (route) => {
      if (route.request().method() === 'POST') {
        postBody = JSON.parse(route.request().postData() || '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'new-uuid', scheduled_at: postBody.scheduled_at, status: 'pending' }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();

    // Picker opens with empty list → manual auto-expanded
    await page.getByPlaceholder(/Nome \(opzionale\)/i).fill('Test Persona');
    await page.getByPlaceholder(/Numero/i).fill('3331234567');
    await page.getByRole('button', { name: /Continua/i }).click();

    // ScheduleModal now visible
    await expect(page.getByText('Test Persona')).toBeVisible();
    await page.getByRole('button', { name: /Domani 9:00/i }).click();
    await page.getByPlaceholder(/Scrivi il messaggio/i).fill('Messaggio di test e2e');
    await page.getByRole('button', { name: /^Schedula$/i }).click();

    await expect.poll(() => postBody?.recipient_number).toBe('393331234567');
    expect(postBody?.recipient_name).toBe('Test Persona');
    expect(postBody?.message).toBe('Messaggio di test e2e');
  });

  test('Evolution error shows banner + auto-expands manual entry', async ({ page }) => {
    await page.route('**/api/contacts', (route) =>
      route.fulfill({ status: 504, contentType: 'application/json', body: JSON.stringify({ error: 'evolution_timeout' }) })
    );

    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Nuovo contatto/i }).click();

    await expect(page.getByText(/Caricamento contatti scaduto|inserire il numero manualmente/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Numero/i)).toBeVisible(); // manual section expanded
  });
});
```

- [ ] **Step 11.2: Run the e2e spec**

These tests run against the deployed Vercel URL; first push the previous tasks to a preview deploy, or update `BASE` to `http://localhost:3000` if you want to test locally against `npm run dev`.

For local run against dev server:
```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test contact-picker.spec.ts
```

For production run (after deploy):
```bash
npx playwright test contact-picker.spec.ts
```

Expected: 5 tests PASS

- [ ] **Step 11.3: Commit**

```bash
git add __tests__/e2e/contact-picker.spec.ts
git commit -m "test(e2e): contact picker + direct scheduling flow"
```

---

## Final verification

- [ ] **Run the entire unit test suite**

Run: `npm test`
Expected: all original 88 tests + new tests added (avatar 6 + calendar 4 + evolution 3 + messages-post 8 + contacts-get 3 = 24 new) → 112 tests PASS.

- [ ] **Run lint and type-check**

```bash
npm run lint
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Manual end-to-end smoke test in dev**

```bash
npm run dev
```

Walk through the full flow:
1. Dashboard renders with both buttons
2. Click "Nuovo contatto" → picker loads from `/api/contacts`
3. Use search → results filter
4. Tap a contact → ScheduleModal opens
5. Navigate calendar months → pick a future day
6. Click "Domani 9:00" preset → date/time fill correctly
7. Type a message → "Schedula" enables
8. Submit → modal closes, new row appears in "Messaggi programmati"
9. The row uses WhatsApp-style layout (avatar, name, date, time, status)
10. Click "Nuovo follow-up" → legacy QuickCaptureModal still works
11. Cancel a pending message via the trash icon

- [ ] **Push & open PR**

After the user confirms everything looks correct in the manual smoke test.

---

## Notes for the implementing engineer

- **Existing phone util**: Use `validatePhone` from `app/lib/phone.ts`. Do not create a new normalizer.
- **Phone format in DB**: All numbers stored as digit strings (no `+`, no `@s.whatsapp.net` suffix), matching the existing convention.
- **`@/lib/...` alias gotcha**: In Jest, this maps to `app/lib/...`. In Next.js it maps to root `./lib/...`. For `app/lib/phone` use a relative import (`../../lib/phone`) from `app/api/...` routes, or `@/lib/phone` from `__tests__` files.
- **`@ts-nocheck` in `lib/evolution/client.ts`**: Already there. Keep it for now — don't refactor it as part of this work.
- **Evolution response shape**: The spec mentions `name` and `pushName`. The actual response may have other fields (e.g., `id` instead of `remoteJid`). If the e2e or staging test reveals the live response differs, adjust `app/api/contacts/route.ts` mapping to match — do not change the API contract returned to the browser.
- **No DB migration is required.** All needed columns on `scheduled_messages` already exist.
- **Don't remove `QuickCaptureModal`** in this PR. That comes in a separate follow-up after a verification period.
