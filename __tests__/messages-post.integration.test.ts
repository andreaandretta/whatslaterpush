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

const whatsappNumbersMock = jest.fn();
jest.mock('../lib/evolution/client', () => ({ evolutionClient: { whatsappNumbers: whatsappNumbersMock } }));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

beforeEach(() => {
  mockSupa.calls.length = 0;
  whatsappNumbersMock.mockReset();
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
  jest.mock('../lib/evolution/client', () => ({ evolutionClient: { whatsappNumbers: whatsappNumbersMock } }));
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

  describe('Linked ID stored as a number (25 set 2026)', () => {
    const LID = '144392555855948';
    const at = () => new Date(Date.now() + 3600_000).toISOString();
    beforeEach(() => {
      mockSupa.setResponse('user_instances:select', { id: 'user-uuid-1', subscription_plan: 'personal', connection_status: 'open', instance_name: INSTANCE });
      mockInsertedRow();
    });

    test('400 recipient_is_lid when an old synced row holds a LID that cannot be a number (no WhatsApp call needed)', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: false, created_at: '2026-09-25T14:01:23Z' });
      const res = await callPost({ recipient_number: LID, message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('recipient_is_lid');
      expect(body.message).toMatch(/codice interno/);
      expect(whatsappNumbersMock).not.toHaveBeenCalled();
      expect(mockSupa.calls.some((c) => c.table === 'scheduled_messages' && c.operation === 'insert')).toBe(false);
    });

    test('400 recipient_is_lid when an old synced 14-digit row looks like a number but WhatsApp says it does not exist', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: false, created_at: '2026-09-01T00:00:00Z' });
      whatsappNumbersMock.mockResolvedValue([{ exists: false, jid: '62812345678901@s.whatsapp.net' }]);
      const res = await callPost({ recipient_number: '62812345678901', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('recipient_is_lid');
      expect(whatsappNumbersMock).toHaveBeenCalledWith(INSTANCE, ['62812345678901']);
    });

    test('13-digit LID (1542…) from an old synced row: recipient_is_lid, not "numero non valido"', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: false, created_at: '2026-09-21T10:00:00Z' });
      const res = await callPost({ recipient_number: '1542123452503', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('recipient_is_lid');
    });

    test('a real long number WhatsApp knows goes through', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: false, created_at: '2026-09-01T00:00:00Z' });
      whatsappNumbersMock.mockResolvedValue([{ exists: true, jid: '62812345678901@s.whatsapp.net' }]);
      const res = await callPost({ recipient_number: '62812345678901', message: 'hi', scheduled_at: at() });
      expect((await res.json()).error).not.toBe('recipient_is_lid');
    });

    test('if WhatsApp cannot be asked, nothing is blocked', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: false, created_at: '2026-09-01T00:00:00Z' });
      whatsappNumbersMock.mockRejectedValue(new Error('Evolution API error: 500'));
      const res = await callPost({ recipient_number: '62812345678901', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(200);
    });

    test('typed by hand, or synced after the fix: never the LID message', async () => {
      whatsappNumbersMock.mockResolvedValue([{ exists: false }]);
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: true, created_at: '2026-09-01T00:00:00Z' });
      let res = await callPost({ recipient_number: '431234567890123', message: 'hi', scheduled_at: at() });
      expect((await res.json()).error).toBe('recipient_not_on_whatsapp');
      mockSupa.setResponse('whatsapp_contacts:select', { added_manually: false, created_at: '2026-10-02T09:00:00Z' });
      res = await callPost({ recipient_number: '62812345678901', message: 'hi', scheduled_at: at() });
      expect((await res.json()).error).toBe('recipient_not_on_whatsapp');
    });
  });

  // Audit 25 set 2026: prod 3466…2716 (un 346 con una cifra in più, letto
  // come Spagna) programmato 4 volte in 17 giorni, fallito exists:false ogni
  // volta al momento dell'invio. Ora WhatsApp si interpella UNA volta, quando
  // il promemoria si crea, e solo per chi non ha mai ricevuto nulla.
  describe('existence check at scheduling time', () => {
    const at = () => new Date(Date.now() + 3600_000).toISOString();
    const sentQuery = (c: any) => c.chain.some((m: any) => m.method === 'eq' && m.args[0] === 'status' && m.args[1] === 'sent');
    beforeEach(() => {
      mockSupa.setResponse('user_instances:select', { id: 'user-uuid-1', subscription_plan: 'personal', connection_status: 'open', instance_name: INSTANCE });
      mockInsertedRow();
    });

    test('never-reached number WhatsApp does not know → 400 recipient_not_on_whatsapp with Italian message, nothing inserted', async () => {
      mockSupa.setResponse('scheduled_messages:select', []);
      whatsappNumbersMock.mockResolvedValue([{ exists: false, jid: '34661234562@s.whatsapp.net', number: '34661234562' }]);
      const res = await callPost({ recipient_number: '34661234562', message: 'Promemoria', scheduled_at: at() });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('recipient_not_on_whatsapp');
      expect(body.message).toMatch(/non risulta su WhatsApp/);
      expect(whatsappNumbersMock).toHaveBeenCalledTimes(1);
      expect(whatsappNumbersMock).toHaveBeenCalledWith(INSTANCE, ['34661234562']);
      expect(mockSupa.calls.some((c) => c.table === 'scheduled_messages' && c.operation === 'insert')).toBe(false);
    });

    test('never-reached number WhatsApp knows → scheduled', async () => {
      mockSupa.setResponse('scheduled_messages:select', []);
      whatsappNumbersMock.mockResolvedValue([{ exists: true, jid: '393339998877@s.whatsapp.net' }]);
      const res = await callPost({ recipient_number: '393339998877', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(200);
    });

    test('a number already reached (a sent row) is not asked again', async () => {
      mockSupa.setHandler('scheduled_messages:select', (c) => ({ data: sentQuery(c) ? [{ id: 'old-sent' }] : [], error: null }));
      whatsappNumbersMock.mockResolvedValue([{ exists: false }]);
      const res = await callPost({ recipient_number: '393339998877', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(200);
      expect(whatsappNumbersMock).not.toHaveBeenCalled();
    });

    test('invalid digits are refused with an Italian message before any WhatsApp call', async () => {
      const res = await callPost({ recipient_number: '1393471234567', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('invalid_phone');
      expect(body.message).toMatch(/Numero non valido/);
      expect(whatsappNumbersMock).not.toHaveBeenCalled();
    });

    test('"00" international prefix is read as + (0041… is Switzerland, not 390041…)', async () => {
      mockSupa.setResponse('scheduled_messages:select', []);
      const res = await callPost({ recipient_number: '0041 79 123 45 67', message: 'hi', scheduled_at: at() });
      expect(res.status).toBe(200);
      const inserted = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert')!.args[0];
      expect(inserted.recipient_number).toBe('41791234567');
    });
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

  test('recurring POST seeds recurrence_anchor_at with the PRE-jitter instant (BUG #2)', async () => {
    mockUserInstance('personal');
    mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg-uuid', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });
    const at = new Date(Date.now() + 3600_000).toISOString();
    const res = await callPost({
      recipient_number: '3339998877', message: 'Promemoria',
      scheduled_at: at, recurrence_rule: 'FREQ=DAILY',
    });
    expect(res.status).toBe(200);
    const inserted = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert')!.args[0];
    // Anchor = the exact user-intended instant, NOT the jittered scheduled_at.
    expect(inserted.recurrence_anchor_at).toBe(new Date(at).toISOString());
    expect(inserted.recurrence_rule).toBe('FREQ=DAILY');
  });

  test('one-shot POST leaves recurrence_anchor_at null', async () => {
    mockUserInstance('personal');
    mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg-uuid', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });
    const res = await callPost({
      recipient_number: '3339998877', message: 'Una tantum',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(200);
    const inserted = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert')!.args[0];
    expect(inserted.recurrence_anchor_at ?? null).toBeNull();
  });

  // Helper: a recently-sent scheduled_messages row (active in the 90-day window).
  const recentSent = (n: string) => ({
    recipient_number: n,
    status: 'sent',
    sent_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    scheduled_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  // Helper: a long-ago-sent row (outside the window → must NOT count).
  const staleSent = (n: string) => ({
    recipient_number: n,
    status: 'sent',
    sent_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    scheduled_at: new Date(Date.now() - 201 * 24 * 60 * 60 * 1000).toISOString(),
  });

  test('403 plan_contacts_limit_exceeded when a new recipient pushes ACTIVE count over maxContacts', async () => {
    mockUserInstance('free'); // free.maxContacts = 10
    mockSupa.setResponse('pending_contacts:select', []);
    // 10 distinct recipients, all active within the 90-day window → at the cap.
    mockSupa.setResponse('scheduled_messages:select',
      Array.from({ length: 10 }, (_, i) => recentSent('r' + i)));

    const res = await callPost({
      recipient_number: '393339998877', // new (#11)
      message: 'hi',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('plan_contacts_limit_exceeded');
    expect(body.limit).toBe(10);
  });

  test('200 — recipients last messaged over 90 days ago do NOT count toward the cap', async () => {
    mockUserInstance('free'); // free.maxContacts = 10
    mockSupa.setResponse('pending_contacts:select', []);
    // 9 active + 1 stale (>90d). Lifetime = 10 (would block), active = 9 (allows #new).
    mockSupa.setResponse('scheduled_messages:select', [
      ...Array.from({ length: 9 }, (_, i) => recentSent('a' + i)),
      staleSent('old1'),
    ]);
    mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg-uuid', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });

    const res = await callPost({
      recipient_number: '393339998877', // new, would be #10 by active count
      message: 'hi',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(200);
  });

  test('200 when re-scheduling for an existing recipient even at the cap', async () => {
    mockUserInstance('free');
    mockSupa.setResponse('pending_contacts:select', []);
    // 10 active recipients incl. the one we re-schedule for → at the cap, but
    // re-scheduling an EXISTING recipient is always allowed.
    mockSupa.setResponse('scheduled_messages:select', [
      recentSent('393339998877'),
      ...Array.from({ length: 9 }, (_, i) => recentSent('e' + i)),
    ]);
    mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg-uuid', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });

    const res = await callPost({
      recipient_number: '393339998877',
      message: 'hi',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(200);
  });

  describe('whatsapp_contacts manual upsert hook', () => {
    test('a pick from the address book or from Recents (no manual_entry) is NOT saved as a manual contact', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      const res = await callPost({
        recipient_number: '393339998877',
        recipient_name: 'Anna',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(res.status).toBe(200);
      expect(mockSupa.calls.some((c) => c.table === 'whatsapp_contacts' && c.operation === 'upsert')).toBe(false);
    });

    test('upserts whatsapp_contacts with added_manually=true and source=MANUAL', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      const res = await callPost({
        manual_entry: true,
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
        manual_entry: true,
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
        manual_entry: true,
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

  describe('MAX_PENDING quota', () => {
    // The mock responseMap persists across tests inside the same describe.
    // Earlier tests populate pending_contacts:select with cap-saturating
    // rows to exercise the maxContacts branch — those rows would trigger a
    // 403 before our new MAX_PENDING check ever runs. Force-empty both
    // here so the only gating signal in this block is the pending count.
    beforeEach(() => {
      mockSupa.setResponse('pending_contacts:select', []);
    });

    test('200 when pending count is below dailyLimit × 7', async () => {
      mockUserInstance('personal'); // dailyLimit=20 → MAX_PENDING=140
      mockInsertedRow();
      mockSupa.setResponse('scheduled_messages:select', [], null, { count: 139 });

      const res = await callPost({
        recipient_number: '393401234567',
        recipient_name: 'Marco',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('pending');
    });

    test('429 queue_full when pending count equals dailyLimit × 7', async () => {
      mockUserInstance('free'); // dailyLimit=3 → MAX_PENDING=21
      mockSupa.setResponse('scheduled_messages:select', [], null, { count: 21 });

      const res = await callPost({
        recipient_number: '393401234567',
        recipient_name: 'Marco',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('queue_full');
      expect(body.pending).toBe(21);
      expect(body.limit).toBe(21);
    });

    test('count query filters by status=pending only', async () => {
      mockUserInstance('personal');
      mockInsertedRow();
      mockSupa.setResponse('scheduled_messages:select', [], null, { count: 5 });

      await callPost({
        recipient_number: '393401234567',
        recipient_name: 'Marco',
        message: 'Ciao',
        scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      });

      const selects = mockSupa.calls.filter(c => c.table === 'scheduled_messages' && c.operation === 'select');
      const pendingHeadSelect = selects.find(c =>
        c.chain.some(step => step.method === 'eq' && step.args[0] === 'status' && step.args[1] === 'pending')
      );
      expect(pendingHeadSelect).toBeDefined();
      const instanceFilter = pendingHeadSelect!.chain.find(step => step.method === 'eq' && step.args[0] === 'instance_phone');
      expect(instanceFilter).toBeDefined();
      expect(instanceFilter!.args[1]).toBe(USER_PHONE);
    });
  });
});
