# Supabase Contacts Cache (Strada A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** persistere i contatti che Evolution riceve via app-state-sync (CONTACTS_SET, CONTACTS_UPSERT, CONTACTS_UPDATE, MESSAGING_HISTORY_SET) in una tabella Supabase `whatsapp_contacts`, e leggere da lì in `/api/contacts` con fallback alla pipeline Evolution se la cache è vuota.

**Architecture:** cache-aside con writer (webhook) e reader (GET /api/contacts). Il writer è il webhook esistente arricchito con 4 nuovi event handlers; il reader prova prima Supabase, poi cade su Evolution per backward compat. Niente re-pair forzato — la cache si popola progressivamente via MESSAGES_UPSERT per gli utenti già pairati, e in batch via MESSAGING_HISTORY_SET per i nuovi pairing.

**Tech Stack:** Next.js App Router, Supabase Postgres + JS client, Jest integration tests, Evolution API webhook payload.

---

## File Structure

**Create:**
- `supabase/migrations/20260517_whatsapp_contacts.sql` — table + index + RLS
- `app/api/admin/contacts-stats/route.ts` — diagnostic GET endpoint
- `__tests__/webhook-contacts.integration.test.ts` — handler tests
- `__tests__/contacts-stats.integration.test.ts` — admin endpoint test

**Modify:**
- `lib/evolution/client.ts` (lines 178-192) — default events list in `setWebhook()`
- `app/api/auth/init/route.ts` (lines 41, 131) — events list in local `setWebhook` and `/instance/create` body
- `app/api/connect/route.ts` (line 72) — events list in local `setWebhook`
- `app/api/webhook/route.ts` — add branch for CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE / MESSAGING_HISTORY_SET before message extraction (~line 750)
- `app/api/contacts/route.ts` — cache-first read with Evolution fallback
- `__tests__/contacts-get.integration.test.ts` — add tests for cache hit/miss paths
- `__tests__/helpers/mocks.ts` — add `makeContactsSetPayload`, `makeContactsUpsertPayload`, `makeMessagingHistorySetPayload`

**Out of scope (do not touch):**
- Combo C files (welcome card, daily cap, share toast, HowToUseBox)
- Re-pair flow / opt-in modal — separate plan after we verify webhooks fire
- ContactPicker filter `!c.name.startsWith('+')` — keep until cache validated

---

## Commit Map

5 scope-based commits in this order:

1. `feat(db): add whatsapp_contacts table migration` → Task 1
2. `feat(evolution): subscribe to contact + history webhook events` → Task 2
3. `feat(webhook): persist contact events to supabase cache` → Tasks 3+4 (helpers + handler with tests)
4. `feat(contacts): read from supabase cache with evolution fallback` → Task 5
5. `feat(admin): add contacts-stats diagnostic endpoint` → Task 6

After each task: stage selectively, show diff, **wait user approval**, commit. No push.

---

## Task 1: Migration for `whatsapp_contacts`

**Files:**
- Create: `supabase/migrations/20260517_whatsapp_contacts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Table: whatsapp_contacts
--
-- Caches contacts surfaced via Evolution webhook events (CONTACTS_SET,
-- CONTACTS_UPSERT, CONTACTS_UPDATE, MESSAGING_HISTORY_SET, MESSAGES_UPSERT).
-- Backs the cache-first read in GET /api/contacts.
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_phone      TEXT NOT NULL,
  contact_number  TEXT NOT NULL,
  name            TEXT,
  push_name       TEXT,
  source          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT whatsapp_contacts_user_contact_unique UNIQUE (user_phone, contact_number),
  CONSTRAINT whatsapp_contacts_source_check CHECK (source IN (
    'CONTACTS_SET',
    'CONTACTS_UPSERT',
    'CONTACTS_UPDATE',
    'MESSAGING_HISTORY_SET',
    'MESSAGES_UPSERT',
    'MANUAL'
  ))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user
  ON whatsapp_contacts (user_phone);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user_name
  ON whatsapp_contacts (user_phone, name) WHERE name IS NOT NULL;

-- RLS: enable, but no policies. Intentional.
--
-- WhatsLater does NOT use Supabase Auth — sessions are HMAC cookies
-- (`sw_session`, see app/lib/auth-cookie.ts). All DB access goes through
-- the Next.js server with SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Authorization is enforced in app code (verifyCookie → phone → WHERE
-- user_phone = phone). The browser never holds the anon key and never
-- queries this table directly.
--
-- Adding `USING (auth.uid() = …)` would be a no-op because the request
-- has no Supabase JWT — auth.uid() returns null and the policy denies
-- everything anyway. We rely on the "RLS on + no policy = deny all" rule
-- for anon/authenticated roles, plus service-role bypass for our server.
--
-- This mirrors the pattern of pending_auth_sessions (20260419 migration).
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

-- Function: upsert_whatsapp_contacts(p_rows JSONB) → INTEGER
--
-- Batch-upserts contact rows with merge semantics that protect against
-- the known Evolution bug #2426 (outgoing messages can deliver
-- name=null/push_name=null events that would otherwise wipe a previously
-- captured name). Behavior:
--
--   • name      → COALESCE(new, existing)  — null never overwrites real
--   • push_name → COALESCE(new, existing)  — null never overwrites real
--   • source    → updated ONLY if name or push_name actually changed
--   • updated_at→ updated ONLY if name or push_name actually changed
--
-- Atomic in a single roundtrip. Caller is service_role, so no
-- SECURITY DEFINER is needed (would only widen the escalation surface).
-- Returns the row-count touched by the INSERT/ON CONFLICT for logging.
CREATE OR REPLACE FUNCTION upsert_whatsapp_contacts(p_rows JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rows_count INTEGER;
BEGIN
  INSERT INTO whatsapp_contacts (user_phone, contact_number, name, push_name, source, updated_at)
  SELECT
    (r->>'user_phone')::TEXT,
    (r->>'contact_number')::TEXT,
    NULLIF(r->>'name', ''),
    NULLIF(r->>'push_name', ''),
    (r->>'source')::TEXT,
    NOW()
  FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (user_phone, contact_number) DO UPDATE
  SET
    name      = COALESCE(EXCLUDED.name,      whatsapp_contacts.name),
    push_name = COALESCE(EXCLUDED.push_name, whatsapp_contacts.push_name),
    source = CASE
      WHEN (EXCLUDED.name      IS NOT NULL AND EXCLUDED.name      IS DISTINCT FROM whatsapp_contacts.name)
        OR (EXCLUDED.push_name IS NOT NULL AND EXCLUDED.push_name IS DISTINCT FROM whatsapp_contacts.push_name)
      THEN EXCLUDED.source
      ELSE whatsapp_contacts.source
    END,
    updated_at = CASE
      WHEN (EXCLUDED.name      IS NOT NULL AND EXCLUDED.name      IS DISTINCT FROM whatsapp_contacts.name)
        OR (EXCLUDED.push_name IS NOT NULL AND EXCLUDED.push_name IS DISTINCT FROM whatsapp_contacts.push_name)
      THEN NOW()
      ELSE whatsapp_contacts.updated_at
    END;
  GET DIAGNOSTICS rows_count = ROW_COUNT;
  RETURN rows_count;
END;
$$;
```

Notes:
- Pattern matches `20260419_pending_auth_sessions.sql` (gen_random_uuid, RLS without explicit policies — server uses service_role).
- Filename uses today's date `20260517` to sort after the latest existing migration.
- Partial index on `(user_phone, name)` speeds up the "rows with real name" filter that `/api/contacts` will use.
- The RPC function `upsert_whatsapp_contacts` is the SOLE write path used by the webhook handler in Task 4 — never call `.from('whatsapp_contacts').upsert(...)` from app code because it would replace columns and reintroduce the #2426 wipe bug.

- [ ] **Step 2: Apply locally (if Andrea uses a local Supabase) OR document for prod apply**

If `supabase` CLI is set up locally:
```bash
supabase db push
```

If migrations are applied directly in production via the Supabase dashboard, leave the SQL file committed and apply it manually after merge. Note this in the commit body.

- [ ] **Step 3: Regenerate types (only if SUPABASE_PROJECT_ID is set in env)**

```bash
npm run db:types
```

Expected: `types/supabase.ts` updates to include `whatsapp_contacts` table type. If the env var is missing, skip — type generation is not blocking.

- [ ] **Step 4: Stage, show diff, wait for approval**

```bash
git add supabase/migrations/20260517_whatsapp_contacts.sql
# also stage types/supabase.ts if regenerated:
# git add types/supabase.ts
git diff --staged
```

**STOP. Show diff to user. Wait for approval before committing.**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(db): add whatsapp_contacts table + upsert_whatsapp_contacts rpc

New table caches contacts received from Evolution app-state-sync
events (CONTACTS_SET/UPSERT/UPDATE and MESSAGING_HISTORY_SET). Backs
the cache-first read in /api/contacts (separate commit). Unique on
(user_phone, contact_number).

Writes go through upsert_whatsapp_contacts(p_rows JSONB) which COALESCEs
new values over existing — null/empty in a later event cannot wipe a
previously captured name. This defends against Evolution bug #2426 where
outgoing MESSAGES_UPSERT can deliver pushName=null. updated_at and source
only advance when the merged values actually changed.

RLS enabled with no policies (intentional): WhatsLater does not use
Supabase Auth, all DB access is via service_role from the Next.js server,
authorization is enforced in app code. Mirrors pending_auth_sessions.

Apply via Supabase dashboard if local CLI not configured.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Subscribe to contact + history webhook events

**Files:**
- Modify: `lib/evolution/client.ts:181-182` (default `events` param)
- Modify: `app/api/auth/init/route.ts:41` (local `setWebhook` events array)
- Modify: `app/api/auth/init/route.ts:131` (events in `/instance/create` body)
- Modify: `app/api/connect/route.ts:72` (local `setWebhook` events array)

Rationale: Andrea verified `syncFullHistory: true` is already set in `init/route.ts:123`, so Baileys IS pulling history at pairing. But Evolution's webhook only forwards `MESSAGES_UPSERT`, `CONNECTION_UPDATE`, `QRCODE_UPDATED` to WhatsLater — the contact events are received by Evolution but dropped before they reach us. Adding them to the subscription is the actual fix.

- [ ] **Step 1: Update `lib/evolution/client.ts` default**

Change line 181 from:
```ts
events: string[] = ['MESSAGES_UPSERT']
```
to:
```ts
events: string[] = [
  'MESSAGES_UPSERT',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'MESSAGING_HISTORY_SET',
  'CONNECTION_UPDATE',
]
```

- [ ] **Step 2: Update `app/api/auth/init/route.ts` line 41**

Change:
```ts
events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
```
to:
```ts
events: [
  'MESSAGES_UPSERT',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'MESSAGING_HISTORY_SET',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
],
```

- [ ] **Step 3: Update `app/api/auth/init/route.ts` line 131 (instance/create body)**

Same replacement as Step 2 (keep `QRCODE_UPDATED` — it's still needed for QR refresh during pairing).

- [ ] **Step 4: Update `app/api/connect/route.ts` line 72**

Same replacement as Step 2.

- [ ] **Step 5: Sanity build**

```bash
npm run build
```

Expected: build succeeds. If TS errors surface, fix them inline.

- [ ] **Step 6: Stage, show diff, wait for approval**

```bash
git add lib/evolution/client.ts app/api/auth/init/route.ts app/api/connect/route.ts
git diff --staged
```

**STOP. Show diff. Wait for approval.**

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(evolution): subscribe to contact + history webhook events

Evolution receives CONTACTS_SET/UPSERT/UPDATE and MESSAGING_HISTORY_SET
events from Baileys (especially when syncFullHistory:true at pairing)
but only forwarded MESSAGES_UPSERT/CONNECTION_UPDATE/QRCODE_UPDATED to
WhatsLater. Adding the contact events to all three webhook configs
(client default, init local setWebhook, connect local setWebhook, plus
the inline webhook in /instance/create) lets us catch the address book
batch the next time any user re-pairs.

Existing pairings keep working — Evolution accepts the new event list
at any time via /webhook/set/{instance}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend test helpers with contact-event payload factories + rpc mock

**Files:**
- Modify: `__tests__/helpers/mocks.ts` (extend `createMockSupabase` with `.rpc()` + setter; append payload builders)

This task is bundled into commit 3 — no separate commit.

- [ ] **Step 1: Extend `createMockSupabase` with `.rpc()` mock**

Inside `createMockSupabase()` in `__tests__/helpers/mocks.ts`, add an rpc response map and expose it on the returned client. Locate the existing `const client = { from: …, channel: …, removeChannel: … }` and replace with:

```ts
  const rpcResponseMap = new Map<string, { data: any; error: any }>();
  function setRpcResponse(name: string, data: any, error: any = null) {
    rpcResponseMap.set(name, { data, error });
  }

  const client = {
    from: (table: string) => ({
      select: (...args: any[]) => makeChain(table, 'select', args),
      insert: (...args: any[]) => makeChain(table, 'insert', args),
      update: (...args: any[]) => makeChain(table, 'update', args),
      delete: () => makeChain(table, 'delete', []),
      upsert: (...args: any[]) => makeChain(table, 'upsert', args),
    }),
    rpc: (name: string, args?: any) => {
      // Track in the same `calls` array so existing assertions still work.
      calls.push({ table: '__rpc__', operation: name, args: [args], chain: [] });
      const resp = rpcResponseMap.get(name) || { data: null, error: null };
      return Promise.resolve(resp);
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({}) }),
    }),
    removeChannel: () => {},
  };

  return { client, calls, setResponse, setRpcResponse };
```

- [ ] **Step 2: Append payload builders to `mocks.ts`**

```ts
// Evolution contact webhook payload builders

export function makeContactsSetPayload(opts: {
  instance: string;
  contacts: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; notify?: string | null }>;
}) {
  return {
    event: 'CONTACTS_SET',
    instance: opts.instance,
    data: opts.contacts.map(c => ({
      id: c.id || c.jid,
      remoteJid: c.jid || c.id,
      name: c.name ?? null,
      pushName: c.pushName ?? null,
      notify: c.notify ?? null,
    })),
  };
}

export function makeContactsUpsertPayload(opts: {
  instance: string;
  contacts: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; notify?: string | null }>;
}) {
  return {
    event: 'CONTACTS_UPSERT',
    instance: opts.instance,
    data: opts.contacts.map(c => ({
      id: c.id || c.jid,
      remoteJid: c.jid || c.id,
      name: c.name ?? null,
      pushName: c.pushName ?? null,
      notify: c.notify ?? null,
    })),
  };
}

export function makeContactsUpdatePayload(opts: {
  instance: string;
  contacts: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null }>;
}) {
  return {
    event: 'CONTACTS_UPDATE',
    instance: opts.instance,
    data: opts.contacts.map(c => ({
      id: c.id || c.jid,
      remoteJid: c.jid || c.id,
      name: c.name ?? null,
      pushName: c.pushName ?? null,
    })),
  };
}

export function makeMessagingHistorySetPayload(opts: {
  instance: string;
  contacts?: Array<{ id?: string; jid?: string; name?: string | null; pushName?: string | null; notify?: string | null }>;
  chats?: Array<{ id?: string; name?: string | null }>;
  messages?: any[];
}) {
  return {
    event: 'MESSAGING_HISTORY_SET',
    instance: opts.instance,
    data: {
      contacts: (opts.contacts || []).map(c => ({
        id: c.id || c.jid,
        remoteJid: c.jid || c.id,
        name: c.name ?? null,
        pushName: c.pushName ?? null,
        notify: c.notify ?? null,
      })),
      chats: opts.chats || [],
      messages: opts.messages || [],
    },
  };
}
```

Notes on shape:
- Evolution v2 sometimes emits the contact event with `data` as an array (CONTACTS_SET/UPSERT) and sometimes as an object with nested arrays (MESSAGING_HISTORY_SET). The handler must accept both forms — these factories mirror the two shapes.
- Each contact carries both `id` and `remoteJid` because Evolution sometimes nulls `remoteJid` and puts the JID in `id` (we already saw this in `app/api/contacts/route.ts:extractJid`).
- `notify` is included even though the Contact schema collapses it to `pushName` downstream — having it in fixtures means we can write a test asserting "if both `name` and `notify` are present, prefer `name`."

---

## Task 4: Webhook handler — persist contact events to Supabase

**Files:**
- Modify: `app/api/webhook/route.ts` (insert new branch ~line 750, after CONNECTION_UPDATE branch, before `extractMessageItem` call)
- Create: `__tests__/webhook-contacts.integration.test.ts`

- [ ] **Step 1: Write failing test for CONTACTS_SET upsert**

Create `__tests__/webhook-contacts.integration.test.ts`:

```ts
/**
 * Integration tests for /api/webhook contact event branches.
 * Verifies CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE /
 * MESSAGING_HISTORY_SET persist rows into whatsapp_contacts.
 */
import {
  createMockSupabase, createFetchMock, mockRequest,
  makeContactsSetPayload, makeContactsUpsertPayload,
  makeContactsUpdatePayload, makeMessagingHistorySetPayload,
} from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;
const INSTANCE = 'SchedWhats-393331234567';
const USER_PHONE = '393331234567';

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    WEBHOOK_SECRET: 'test-webhook-secret',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
  };
  (global as any).fetch = fetchMock.mockFetch;

  mockSupa.setResponse('user_instances:select', {
    id: 'ui-1', phone_number: USER_PHONE, instance_name: INSTANCE,
  });
});

afterEach(() => { process.env = ORIGINAL_ENV; });

async function callWebhook(body: any, headers: Record<string, string> = {}) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/webhook/route');
  const req = mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret', ...headers });
  return POST(req as any);
}

// Helper: pull the rows passed to upsert_whatsapp_contacts in the most
// recent rpc call. Returns [] if the rpc was never called.
function rpcUpsertRows(): any[] {
  const rpcCalls = mockSupa.calls.filter(
    c => c.table === '__rpc__' && c.operation === 'upsert_whatsapp_contacts'
  );
  if (rpcCalls.length === 0) return [];
  const last = rpcCalls[rpcCalls.length - 1];
  const args = last.args[0] || {};
  return Array.isArray(args.p_rows) ? args.p_rows : [];
}

describe('Webhook: CONTACTS_SET', () => {
  test('calls upsert_whatsapp_contacts rpc with each contact, source=CONTACTS_SET', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);
    const body = makeContactsSetPayload({
      instance: INSTANCE,
      contacts: [
        { jid: '393401111111@s.whatsapp.net', name: 'Mario Rossi', pushName: 'Mario' },
        { jid: '393402222222@s.whatsapp.net', name: null, pushName: 'Anna' },
      ],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rpcCalls = mockSupa.calls.filter(
      c => c.table === '__rpc__' && c.operation === 'upsert_whatsapp_contacts'
    );
    expect(rpcCalls.length).toBe(1); // single batch rpc
    const rows = rpcUpsertRows();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        user_phone: USER_PHONE,
        contact_number: '393401111111',
        name: 'Mario Rossi',
        push_name: 'Mario',
        source: 'CONTACTS_SET',
      }),
      expect.objectContaining({
        user_phone: USER_PHONE,
        contact_number: '393402222222',
        name: null,
        push_name: 'Anna',
        source: 'CONTACTS_SET',
      }),
    ]));
  });

  test('ignores group JIDs and own number', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsSetPayload({
      instance: INSTANCE,
      contacts: [
        { jid: '120363xxxx@g.us', name: 'Family Group' },
        { jid: `${USER_PHONE}@s.whatsapp.net`, name: 'Me' },
        { jid: '393404444444@s.whatsapp.net', name: 'Luca' },
      ],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows.length).toBe(1);
    expect(rows[0].contact_number).toBe('393404444444');
  });
});

describe('Webhook: CONTACTS_UPSERT', () => {
  test('uses source=CONTACTS_UPSERT', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsUpsertPayload({
      instance: INSTANCE,
      contacts: [{ jid: '393405555555@s.whatsapp.net', name: 'Paolo' }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows[0].source).toBe('CONTACTS_UPSERT');
  });
});

describe('Webhook: CONTACTS_UPDATE', () => {
  test('uses source=CONTACTS_UPDATE', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsUpdatePayload({
      instance: INSTANCE,
      contacts: [{ jid: '393406666666@s.whatsapp.net', pushName: 'Giulia (updated)' }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows[0].source).toBe('CONTACTS_UPDATE');
    expect(rows[0].push_name).toBe('Giulia (updated)');
    expect(rows[0].name).toBe(null);
  });
});

describe('Webhook: MESSAGING_HISTORY_SET', () => {
  test('persists contacts array from history payload', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);
    const body = makeMessagingHistorySetPayload({
      instance: INSTANCE,
      contacts: [
        { jid: '393407777777@s.whatsapp.net', name: 'Sara', notify: 'Sara T' },
        { jid: '393408888888@s.whatsapp.net', name: null, pushName: 'Marco' },
      ],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows.length).toBe(2);
    expect(rows[0].source).toBe('MESSAGING_HISTORY_SET');
  });

  test('handles empty contacts array (history with chats but no contacts)', async () => {
    const body = makeMessagingHistorySetPayload({
      instance: INSTANCE,
      contacts: [],
      chats: [{ id: '393409999999@s.whatsapp.net' }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rpcCalls = mockSupa.calls.filter(
      c => c.table === '__rpc__' && c.operation === 'upsert_whatsapp_contacts'
    );
    expect(rpcCalls.length).toBe(0); // no contacts → no rpc call
  });
});

describe('Webhook: contact event when user not found', () => {
  test('returns 200 and skips rpc if instance not in user_instances', async () => {
    mockSupa.setResponse('user_instances:select', null); // override beforeEach
    const body = makeContactsSetPayload({
      instance: 'SchedWhats-unknown',
      contacts: [{ jid: '393401111111@s.whatsapp.net', name: 'X' }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rpcCalls = mockSupa.calls.filter(
      c => c.table === '__rpc__' && c.operation === 'upsert_whatsapp_contacts'
    );
    expect(rpcCalls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- webhook-contacts.integration.test.ts
```

Expected: all tests fail with "expected length 1, received 0" because the handler doesn't exist yet.

- [ ] **Step 3: Add the handler branch in `app/api/webhook/route.ts`**

Insert the helper function and branch BEFORE the `extractMessageItem` call (after the CONNECTION_UPDATE branch, around line 750):

```ts
// ── Helper: normalize a Baileys contact object to whatsapp_contacts row ──
function contactRowsFromPayload(
  rawList: any[],
  userPhone: string,
  source: 'CONTACTS_SET' | 'CONTACTS_UPSERT' | 'CONTACTS_UPDATE' | 'MESSAGING_HISTORY_SET'
): Array<{ user_phone: string; contact_number: string; name: string | null; push_name: string | null; source: string; updated_at: string }> {
  const now = new Date().toISOString();
  const rows: Array<any> = [];
  const seen = new Set<string>();
  for (const c of rawList || []) {
    // Evolution sometimes nulls remoteJid and puts the JID in `id`; mirror
    // the extractJid logic from /api/contacts/route.ts.
    const rawJid: string | undefined =
      (typeof c?.remoteJid === 'string' && c.remoteJid.includes('@')) ? c.remoteJid :
      (typeof c?.id === 'string' && c.id.includes('@')) ? c.id :
      undefined;
    if (!rawJid) continue;
    if (rawJid.includes('@g.us') || rawJid.includes('@broadcast')) continue;
    const numericPart = (rawJid.split('@')[0] || '').split(':')[0];
    if (!/^\d{8,15}$/.test(numericPart)) continue;
    if (numericPart === userPhone) continue;
    if (seen.has(numericPart)) continue;
    seen.add(numericPart);

    const name = (typeof c?.name === 'string' && c.name.trim()) ? c.name.trim() : null;
    const pushName =
      (typeof c?.pushName === 'string' && c.pushName.trim()) ? c.pushName.trim() :
      (typeof c?.notify === 'string' && c.notify.trim()) ? c.notify.trim() :
      null;

    rows.push({
      user_phone: userPhone,
      contact_number: numericPart,
      name,
      push_name: pushName,
      source,
      updated_at: now,
    });
  }
  return rows;
}

// ── Helper: resolve user_phone from instance, return null if not found ──
async function userPhoneForInstance(instanceName: string): Promise<string | null> {
  if (!instanceName) return null;
  const { data } = await supabase
    .from('user_instances')
    .select('phone_number')
    .eq('instance_name', instanceName)
    .maybeSingle();
  return data?.phone_number || null;
}
```

And the branch (insert right after the CONNECTION_UPDATE branch closes with `return NextResponse.json({ ok: true });`):

```ts
    // ── Contact + history events → cache into whatsapp_contacts ──
    if (
      eventType === 'CONTACTS_SET' ||
      eventType === 'CONTACTS_UPSERT' ||
      eventType === 'CONTACTS_UPDATE' ||
      eventType === 'MESSAGING_HISTORY_SET' ||
      eventType === 'contacts.set' ||
      eventType === 'contacts.upsert' ||
      eventType === 'contacts.update' ||
      eventType === 'messaging-history.set'
    ) {
      const userPhone = await userPhoneForInstance(evoInstance);
      if (!userPhone) {
        console.log('WEBHOOK:CONTACTS skip — instance not mapped, instance=' + evoInstance);
        return NextResponse.json({ ok: true });
      }
      const sourceKey: 'CONTACTS_SET' | 'CONTACTS_UPSERT' | 'CONTACTS_UPDATE' | 'MESSAGING_HISTORY_SET' =
        eventType === 'CONTACTS_SET' || eventType === 'contacts.set' ? 'CONTACTS_SET' :
        eventType === 'CONTACTS_UPSERT' || eventType === 'contacts.upsert' ? 'CONTACTS_UPSERT' :
        eventType === 'CONTACTS_UPDATE' || eventType === 'contacts.update' ? 'CONTACTS_UPDATE' :
        'MESSAGING_HISTORY_SET';

      // MESSAGING_HISTORY_SET nests contacts under data.contacts; the other
      // three put the array directly at data.
      const rawList: any[] =
        sourceKey === 'MESSAGING_HISTORY_SET'
          ? (Array.isArray(payload?.data?.contacts) ? payload.data.contacts : [])
          : (Array.isArray(payload?.data) ? payload.data : []);

      const rows = contactRowsFromPayload(rawList, userPhone, sourceKey);
      console.log('WEBHOOK:CONTACTS event=' + sourceKey + ' instance=' + evoInstance + ' incoming=' + rawList.length + ' persisted=' + rows.length);

      if (rows.length === 0) {
        return NextResponse.json({ ok: true, persisted: 0 });
      }

      // Use the merge-aware RPC instead of .upsert() — the RPC's COALESCE
      // logic prevents null/empty values from a later event (e.g. an
      // outgoing MESSAGES_UPSERT that triggers the Evolution #2426 wipe)
      // from blanking a real name captured earlier.
      const { data: persistedCount, error: rpcErr } = await supabase
        .rpc('upsert_whatsapp_contacts', { p_rows: rows });

      if (rpcErr) {
        console.error('WEBHOOK:CONTACTS rpc error:', rpcErr.message);
        return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, persisted: persistedCount ?? rows.length });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- webhook-contacts.integration.test.ts
```

Expected: all 7 tests pass. If a test fails because the mock doesn't expose `upsert` args in `call.args[0]`, inspect the mocks.ts helper — the existing `upsert` chain captures args identically to insert/update.

- [ ] **Step 5: Re-run existing webhook tests to catch regression**

```bash
npm test -- webhook.integration.test.ts
```

Expected: all existing tests still pass. The new branch is additive and returns before reaching `extractMessageItem` only for the new event types.

- [ ] **Step 6: Stage, show diff, wait for approval**

```bash
git add __tests__/helpers/mocks.ts __tests__/webhook-contacts.integration.test.ts app/api/webhook/route.ts
git diff --staged
```

**STOP. Show diff. Wait for approval.**

- [ ] **Step 7: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(webhook): persist contact events to supabase cache

Adds handler branch for CONTACTS_SET, CONTACTS_UPSERT, CONTACTS_UPDATE
and MESSAGING_HISTORY_SET (plus their dot-case aliases Evolution may
emit). Each event's contact list is normalized to (user_phone,
contact_number, name, push_name, source) rows and upserted into
whatsapp_contacts. Group/broadcast JIDs and the user's own number are
filtered out.

Includes test-helper payload factories and a 7-test integration suite.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Cache-first read in `/api/contacts`

**Files:**
- Modify: `app/api/contacts/route.ts` (wrap existing pipeline in cache-miss fallback)
- Modify: `__tests__/contacts-get.integration.test.ts` (add cache-hit and cache-miss tests)

- [ ] **Step 1: Write failing test for cache-hit path**

Append to `__tests__/contacts-get.integration.test.ts` (within the existing `describe('GET /api/contacts', () => {` block):

```ts
test('returns from supabase cache when whatsapp_contacts has rows', async () => {
  mockSupa.setResponse('whatsapp_contacts:select', [
    { contact_number: '393401111111', name: 'Mario Rossi', push_name: 'Mario' },
    { contact_number: '393402222222', name: null,           push_name: 'Anna' },
    { contact_number: '393403333333', name: 'Luca Bianchi', push_name: null },
  ]);
  // Evolution mocks return [] but should never be hit on cache-hit path

  const res = await callGet();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.contacts).toEqual([
    { number: '393402222222', name: 'Anna',         pushName: 'Anna' },
    { number: '393403333333', name: 'Luca Bianchi', pushName: undefined },
    { number: '393401111111', name: 'Mario Rossi',  pushName: 'Mario' },
  ]);
  // Evolution endpoints must not be called when cache has rows
  expect(findContactsMock).not.toHaveBeenCalled();
  expect(findChatsMock).not.toHaveBeenCalled();
  expect(fetchAllGroupsMock).not.toHaveBeenCalled();
});

test('falls back to evolution pipeline when whatsapp_contacts is empty', async () => {
  mockSupa.setResponse('whatsapp_contacts:select', []);
  findContactsMock.mockResolvedValue([
    { remoteJid: '393404444444@s.whatsapp.net', pushName: 'Sara', name: 'Sara R.' },
  ]);

  const res = await callGet();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.contacts).toEqual([
    { number: '393404444444', name: 'Sara', pushName: 'Sara' },
  ]);
  expect(findContactsMock).toHaveBeenCalled();
});
```

Notes:
- The cache-hit test expects display-name precedence `name > push_name > +number`, sorted alphabetically by it.alocale.
- `pushName: undefined` is acceptable in the JSON output for rows whose push_name is null (matches the existing `entry.pushName = name` pattern that only assigns when truthy).
- Sorted result order: "Anna" (393402…), "Luca Bianchi" (393403…), "Mario Rossi" (393401…).

- [ ] **Step 2: Run tests to verify cache-hit fails**

```bash
npm test -- contacts-get.integration.test.ts
```

Expected: cache-hit test fails (Evolution is still called). The fallback test may pass already since current code uses Evolution.

- [ ] **Step 3: Modify `app/api/contacts/route.ts` GET handler**

Add cache read at the top of `GET` (after the `instance_name` lookup, before the `Promise.allSettled` Evolution calls):

```ts
  // ── Cache-first: read from whatsapp_contacts populated by webhook ──
  const { data: cached } = await supabase
    .from('whatsapp_contacts')
    .select('contact_number, name, push_name')
    .eq('user_phone', phone);

  if (cached && cached.length > 0) {
    const out: OutContact[] = [];
    for (const row of cached) {
      const num = (row as any).contact_number as string;
      if (!num || num === phone) continue;
      const name = ((row as any).name && (row as any).name.trim()) || null;
      const pushName = ((row as any).push_name && (row as any).push_name.trim()) || null;
      const displayName = name || pushName;
      if (!displayName) continue; // skip anonymous rows just like the Evolution path
      const entry: OutContact = { number: num, name: displayName };
      if (pushName) entry.pushName = pushName;
      out.push(entry);
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    console.log('CONTACTS:GET source=supabase count=' + out.length + ' raw=' + cached.length);
    return NextResponse.json({ contacts: out });
  }

  console.log('CONTACTS:GET source=evolution (cache empty)');
```

Leave the entire existing Evolution pipeline below this block untouched — it becomes the cache-miss fallback. Add a structured log at the end too:

Find the existing `return NextResponse.json({ contacts: out });` at the end of the function and prepend:
```ts
  console.log('CONTACTS:GET source=evolution count=' + out.length);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- contacts-get.integration.test.ts
```

Expected: all tests pass — both the new cache-hit/miss tests and the pre-existing Evolution-only tests (which now hit the cache-miss path).

- [ ] **Step 5: Stage, show diff, wait for approval**

```bash
git add app/api/contacts/route.ts __tests__/contacts-get.integration.test.ts
git diff --staged
```

**STOP. Show diff. Wait for approval.**

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(contacts): read from supabase cache with evolution fallback

GET /api/contacts now reads whatsapp_contacts first. On cache-hit
(>=1 row) returns immediately — avoids the 3-way Evolution fetch
(findContacts + findChats + fetchAllGroups), the enrichment via
whatsappNumbers, and the findMessages backfill. Saves 5-15s
on typical accounts and avoids Evolution timeouts entirely.

On cache-miss (zero rows) falls back to the existing Evolution
pipeline so existing pairings that haven't yet received any
contact webhook keep working.

Structured logs (`CONTACTS:GET source=...`) let us measure the
cache hit rate from logs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Admin diagnostic endpoint `/api/admin/contacts-stats`

**Files:**
- Create: `app/api/admin/contacts-stats/route.ts`
- Create: `__tests__/contacts-stats.integration.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/contacts-stats.integration.test.ts`:

```ts
/**
 * Integration test for GET /api/admin/contacts-stats.
 * Auth: CRON_SECRET via ?secret=… query string.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRON_SECRET: 'test-cron-secret',
  };
});

afterEach(() => { process.env = ORIGINAL_ENV; });

async function callStats(secret?: string) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { GET } = await import('../app/api/admin/contacts-stats/route');
  const req: any = mockRequest({}, {});
  req.url = secret
    ? `https://whatslaterpush.vercel.app/api/admin/contacts-stats?secret=${secret}`
    : 'https://whatslaterpush.vercel.app/api/admin/contacts-stats';
  return GET(req);
}

describe('GET /api/admin/contacts-stats', () => {
  test('401 without secret', async () => {
    const res = await callStats();
    expect(res.status).toBe(401);
  });

  test('401 with wrong secret', async () => {
    const res = await callStats('wrong');
    expect(res.status).toBe(401);
  });

  test('returns aggregated stats with correct secret', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', [
      { source: 'CONTACTS_SET',          name: 'Mario',  push_name: 'Mario' },
      { source: 'CONTACTS_SET',          name: 'Luca',   push_name: null },
      { source: 'MESSAGING_HISTORY_SET', name: 'Anna',   push_name: 'Anna' },
      { source: 'MESSAGES_UPSERT',       name: null,     push_name: 'Sara' },
      { source: 'MESSAGES_UPSERT',       name: null,     push_name: null },
      { source: 'CONTACTS_UPDATE',       name: 'Paolo',  push_name: 'Paolo' },
    ]);

    const res = await callStats('test-cron-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_in_cache).toBe(6);
    expect(body.total_with_name).toBe(4);
    expect(body.total_with_only_pushname).toBe(1);
    expect(body.anonymous).toBe(1);
    expect(body.source_breakdown).toEqual({
      CONTACTS_SET: 2,
      MESSAGING_HISTORY_SET: 1,
      MESSAGES_UPSERT: 2,
      CONTACTS_UPDATE: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- contacts-stats.integration.test.ts
```

Expected: fails with "Cannot find module '../app/api/admin/contacts-stats/route'".

- [ ] **Step 3: Implement the route**

Create `app/api/admin/contacts-stats/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('secret');
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = queryToken || headerToken;
  if (provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .select('source, name, push_name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const source_breakdown: Record<string, number> = {};
  let withName = 0;
  let withOnlyPushName = 0;
  let anonymous = 0;
  for (const r of rows as Array<{ source: string; name: string | null; push_name: string | null }>) {
    source_breakdown[r.source] = (source_breakdown[r.source] || 0) + 1;
    const hasName = !!(r.name && r.name.trim());
    const hasPush = !!(r.push_name && r.push_name.trim());
    if (hasName) withName++;
    else if (hasPush) withOnlyPushName++;
    else anonymous++;
  }

  return NextResponse.json({
    total_in_cache: rows.length,
    total_with_name: withName,
    total_with_only_pushname: withOnlyPushName,
    anonymous,
    source_breakdown,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- contacts-stats.integration.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 5: Stage, show diff, wait for approval**

```bash
git add app/api/admin/contacts-stats/route.ts __tests__/contacts-stats.integration.test.ts
git diff --staged
```

**STOP. Show diff. Wait for approval.**

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(admin): add contacts-stats diagnostic endpoint

GET /api/admin/contacts-stats?secret=CRON_SECRET returns counts by
source and by name-status across whatsapp_contacts. Used to verify
in 24-48h that CONTACTS_SET / MESSAGING_HISTORY_SET events actually
fire after we subscribed to them (commit 2). If they never appear in
source_breakdown, we know Evolution isn't forwarding them despite the
subscription change — that's the rollback signal.

Same auth pattern as /api/cron/send-messages (CRON_SECRET via query
or Bearer).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Architecture note in plan body

Documentation, no code. Add a short note to `CLAUDE.md` (top of file or near "Auth" section) so future-Claude knows the cache exists.

- [ ] **Step 1: Append to `CLAUDE.md`**

Add this section (uncommitted at this point — staged with Task 8 manual notes or skipped if Andrea prefers).

```markdown
## Contacts cache (whatsapp_contacts)
- Writer: `app/api/webhook/route.ts` branch on CONTACTS_SET / CONTACTS_UPSERT /
  CONTACTS_UPDATE / MESSAGING_HISTORY_SET (+ dot-case aliases). Persists via
  `upsert_whatsapp_contacts(p_rows JSONB)` RPC — COALESCE-protected so a later
  null does not wipe a captured name (defense against Evolution bug #2426).
- Reader: `app/api/contacts/route.ts` cache-first; falls back to the Evolution
  pipeline (`findContacts` + `findChats` + `fetchAllGroups` + backfill) when
  the cache is empty.
- Diagnostic: `GET /api/admin/contacts-stats?secret=$CRON_SECRET` returns
  `source_breakdown` + name-status counts.
- Webhook subscription: events list lives in 3 spots (init local `setWebhook`,
  init `/instance/create` body, connect local `setWebhook`). Keep them in sync.
```

(Optional — skip if Andrea wants minimal CLAUDE.md edits.)

---

## Task 8: Full build + final verification (no commit)

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all 88+ existing tests still pass, plus the new tests (~10 added). If anything fails, fix before declaring done.

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: clean build. Andrea may want to run this himself per his instructions — defer to him.

- [ ] **Step 3: Final summary to user**

Print:
- the 5 commit hashes (`git log --oneline -5`)
- what was changed in each
- the diagnostic URL: `https://whatslaterpush.vercel.app/api/admin/contacts-stats?secret=<CRON_SECRET>`
- the rollback plan: `git revert <commit-2..commit-5>` keeps the migration but undoes the live behavior, in case 48h check shows CONTACTS_SET never fires

- [ ] **Step 4: Stop. Do NOT push.**

User explicitly said: "NON pushare con git push secco. Prima mostrami diff e commit list, poi conferma."

---

## Task 9: Manual post-deploy step — Andrea re-pairs his instance

**Owner: Andrea (manual).** No Claude action.

The webhook handler from Task 4 only persists when an event arrives. For existing pairings:
- `MESSAGES_UPSERT` keeps firing on every chat — slowly populates the cache as people message Andrea
- `CONTACTS_SET` and `MESSAGING_HISTORY_SET` only fire at fresh pairing / app-state replay — they will NEVER fire for already-pair-and-running instances

This is the documented multi-device limitation called out in `CLAUDE.md:22`:

> Multi-device richiede re-pair (limitazione v1, OTP self-chat in v1.5)

**After push:**

1. Andrea opens WhatsLater dashboard → settings → "Disconnetti WhatsApp" (or whatever the existing flow is).
2. Re-pair via QR.
3. Within 30 seconds the webhook should receive `MESSAGING_HISTORY_SET` carrying the full address book that Baileys pulls because `syncFullHistory: true` is already set (commit 5deb9d6).
4. Verify:
   ```
   curl "https://whatslaterpush.vercel.app/api/admin/contacts-stats?secret=$CRON_SECRET"
   ```
   Expected: `source_breakdown.MESSAGING_HISTORY_SET > 0` and `total_with_name >> 8` (vs the ~8 he sees today).
5. If after 5 minutes `source_breakdown.MESSAGING_HISTORY_SET` is still 0, ROLLBACK signal — Evolution is dropping the event despite our subscription. Revert commits 2-5 (keep the migration: `git revert <c2>..<c5>`), then diagnose Evolution-side (check Evolution logs for `webhook_by_events` mismatch, check the actual events Evolution emits via `curl $EVO/instance/{name}/webhook`).

**For OTHER existing users**: do NOT prompt them to re-pair yet. Wait until Andrea has confirmed the flow works on his own number, then we'll design an opt-in re-pair modal in a separate plan.

---

## Self-Review Checklist (run before handing off plan)

- [x] Spec coverage:
  - "Nuova tabella Supabase" → Task 1 ✓
  - "Aggiorna setWebhook() default" → Task 2 ✓ (3 call sites covered, not just the lib client)
  - "Aggiungi handler in webhook/route.ts per i 4 nuovi eventi" → Task 4 ✓
  - "Modifica /api/contacts/route.ts cache-first con fallback" → Task 5 ✓
  - "Misurazione before/after via /api/admin/contacts-stats" → Task 6 ✓
  - "5 commit separati scope-based" → Task 1, 2, 3+4, 5, 6 ✓
  - "Mostra diff prima di committare" → present in every task ✓
  - "Niente push automatico" → Task 8 step 4 ✓
  - "Niente toccare Combo C" → File Structure / Out of Scope ✓
  - "Niente rimuovere filtro `+` da ContactPicker" → File Structure / Out of Scope ✓
  - "NON forzare re-pairing" → Goal / Architecture; opt-in re-pair only for Andrea documented in Task 9 ✓
  - Clarification Q1 (COALESCE upsert) → Task 1 RPC function + Task 4 handler uses .rpc ✓
  - Clarification Q2 (single user_phone query) → Task 4 handler does one lookup at branch entry ✓
  - Clarification Q3 (RLS rationale) → Task 1 migration carries the SQL comment explaining why no policies ✓
  - Note 2 (manual re-pair post-deploy) → Task 9 ✓

- [x] Placeholder scan: no TBD/TODO/etc.

- [x] Type consistency: column names match across SQL (`name`, `push_name`, `source`, `user_phone`, `contact_number`), webhook handler (`row.name`, `row.push_name`, `row.source`), reader (`(row as any).name`, `.push_name`), stats endpoint (`r.name`, `r.push_name`, `r.source`). Event-type strings match across factories and handler branch.

- [x] No new behavior outside the spec: no re-pair prompt, no Picker filter change, no Combo C touches.

---

## Execution Choice

After approval of this plan, two execution modes:

1. **Inline (recommended for this plan)** — I execute tasks sequentially in this session, stopping at each "show diff + wait approval" checkpoint. 5 short conversation turns total. Best because the diffs are small and you want eyes on each.

2. **Subagent-driven** — fresh subagent per task, two-stage review. Overkill here — every task touches files you already know intimately.

Default: **Inline**, unless you say otherwise.
