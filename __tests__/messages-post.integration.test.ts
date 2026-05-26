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
  req.cookies = {
    get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined,
  };
  return POST(req);
}

function mockUserInstance(plan = 'personal') {
  mockSupa.setResponse('user_instances:select', {
    id: 'user-uuid-1', subscription_plan: plan, connection_status: 'open',
  });
}

function mockInsertedRow() {
  mockSupa.setResponse('scheduled_messages:insert', {
    id: 'new-msg-uuid',
    scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
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
    mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg-uuid', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });
    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await callPost({
      recipient_number: '3339998877', // unnormalized → 393339998877
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
    mockSupa.setResponse('pending_contacts:select', [
      { recipient_number: '1' }, { recipient_number: '2' }, { recipient_number: '3' },
    ]);
    mockSupa.setResponse('scheduled_messages:select', [
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
    mockSupa.setResponse('pending_contacts:select', [
      { recipient_number: '393339998877' },
      { recipient_number: '2' }, { recipient_number: '3' }, { recipient_number: '4' }, { recipient_number: '5' },
    ]);
    mockSupa.setResponse('scheduled_messages:select', []);
    mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg-uuid', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });

    const res = await callPost({
      recipient_number: '393339998877',
      message: 'hi',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(200);
  });

  describe('whatsapp_contacts manual upsert hook', () => {
    test('upserts whatsapp_contacts with added_manually=true and source=MANUAL', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      const res = await callPost({
        recipient_number: '3339998877',
        recipient_name: 'Anna Lead',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(res.status).toBe(200);

      const upsertCall = mockSupa.calls.find((c) => c.table === 'whatsapp_contacts' && c.operation === 'upsert');
      expect(upsertCall).toBeDefined();
      expect(upsertCall!.args[0]).toMatchObject({
        user_phone: USER_PHONE,
        contact_number: '393339998877',
        name: 'Anna Lead',
        push_name: null,
        source: 'MANUAL',
        added_manually: true,
      });
      // ignoreDuplicates=true → INSERT ... ON CONFLICT DO NOTHING. This is what
      // keeps webhook-ingested rows intact (added_manually stays false for them).
      expect(upsertCall!.args[1]).toMatchObject({
        onConflict: 'user_phone,contact_number',
        ignoreDuplicates: true,
      });
    });

    test('upserts with name=null when recipient_name is missing', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      const res = await callPost({
        recipient_number: '3339998877',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(res.status).toBe(200);

      const upsertCall = mockSupa.calls.find((c) => c.table === 'whatsapp_contacts' && c.operation === 'upsert');
      expect(upsertCall!.args[0].name).toBeNull();
      expect(upsertCall!.args[0].added_manually).toBe(true);
    });

    test('whatsapp_contacts upsert failure does not break scheduled_messages success', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      mockSupa.setResponse('whatsapp_contacts:upsert', null, { message: 'simulated supabase error' });

      const res = await callPost({
        recipient_number: '3339998877',
        recipient_name: 'Anna',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      // Schedule succeeded despite the contact upsert failing — order matters:
      // the user's message is what they care about, the cache pre-warm is a bonus.
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('pending');
    });
  });

  describe('recurrence_rule', () => {
    test('accepts valid FREQ=WEEKLY rule and persists it on the row', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      const res = await callPost({
        recipient_number: '3339998877',
        recipient_name: 'Marco',
        message: 'Allenamento martedì',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU',
      });
      expect(res.status).toBe(200);

      const insertCall = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert');
      expect(insertCall!.args[0].recurrence_rule).toBe('FREQ=WEEKLY;BYDAY=TU');
    });

    test('null/undefined/empty recurrence_rule stores null (one-shot)', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      const res = await callPost({
        recipient_number: '3339998877',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        recurrence_rule: null,
      });
      expect(res.status).toBe(200);
      const insertCall = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert');
      expect(insertCall!.args[0].recurrence_rule).toBeNull();
    });

    test('rejects invalid recurrence_rule with 400', async () => {
      mockUserInstance('personal');
      const res = await callPost({
        recipient_number: '3339998877',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
        recurrence_rule: 'NONSENSE=YES',
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_recurrence_rule');
    });
  });
});
