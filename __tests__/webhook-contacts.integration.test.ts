/**
 * Integration tests for /api/webhook contact event branches.
 * Verifies CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE /
 * MESSAGING_HISTORY_SET persist rows into whatsapp_contacts via the
 * upsert_whatsapp_contacts RPC (which COALESCEs null over existing).
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

  // The handler resolves instance_name → phone_number via user_instances.
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

// Pull the rows passed to upsert_whatsapp_contacts in the most recent
// rpc call. Returns [] if the rpc was never called.
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
    expect(rpcCalls.length).toBe(1);
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
  test('uses source=CONTACTS_UPDATE and preserves null name when only pushName is present', async () => {
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
  test('persists contacts array from history payload (nested under data.contacts)', async () => {
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
    expect(rpcCalls.length).toBe(0);
  });
});

describe('Webhook: contact event when user not found', () => {
  test('returns 200 and skips rpc if instance not in user_instances', async () => {
    mockSupa.setResponse('user_instances:select', null);
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

describe('Webhook: profilePicUrl persistence', () => {
  test('CONTACTS_UPSERT with profilePicUrl populates profile_pic_url in rpc row', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsUpsertPayload({
      instance: INSTANCE,
      contacts: [{
        jid: '393401111111@s.whatsapp.net',
        name: 'Mario',
        profilePicUrl: 'https://pps.whatsapp.net/v/t61.24694/abc.jpg?token=xyz',
      }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows.length).toBe(1);
    expect(rows[0].profile_pic_url).toBe('https://pps.whatsapp.net/v/t61.24694/abc.jpg?token=xyz');
  });

  test('CONTACTS_UPSERT without profilePicUrl sets profile_pic_url=null', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsUpsertPayload({
      instance: INSTANCE,
      contacts: [{ jid: '393402222222@s.whatsapp.net', name: 'Anna' }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows.length).toBe(1);
    expect(rows[0].profile_pic_url).toBe(null);
  });

  test('CONTACTS_SET propagates profilePicUrl for each contact', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);
    const body = makeContactsSetPayload({
      instance: INSTANCE,
      contacts: [
        { jid: '393401111111@s.whatsapp.net', name: 'Mario', profilePicUrl: 'https://pps.whatsapp.net/mario.jpg' },
        { jid: '393402222222@s.whatsapp.net', name: 'Anna' },
      ],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows.find(r => r.contact_number === '393401111111')?.profile_pic_url)
      .toBe('https://pps.whatsapp.net/mario.jpg');
    expect(rows.find(r => r.contact_number === '393402222222')?.profile_pic_url)
      .toBe(null);
  });

  test('CONTACTS_UPDATE with profilePicUrl persists the url', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsUpdatePayload({
      instance: INSTANCE,
      contacts: [{
        jid: '393403333333@s.whatsapp.net',
        pushName: 'Giulia',
        profilePicUrl: 'https://pps.whatsapp.net/giulia.jpg',
      }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows[0].profile_pic_url).toBe('https://pps.whatsapp.net/giulia.jpg');
  });

  test('MESSAGING_HISTORY_SET propagates profilePicUrl from nested contacts', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeMessagingHistorySetPayload({
      instance: INSTANCE,
      contacts: [{
        jid: '393404444444@s.whatsapp.net',
        name: 'Luca',
        profilePicUrl: 'https://pps.whatsapp.net/luca.jpg',
      }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows[0].profile_pic_url).toBe('https://pps.whatsapp.net/luca.jpg');
  });

  test('empty-string profilePicUrl is normalized to null', async () => {
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);
    const body = makeContactsUpsertPayload({
      instance: INSTANCE,
      contacts: [{ jid: '393405555555@s.whatsapp.net', name: 'Paolo', profilePicUrl: '' }],
    });
    const res = await callWebhook(body);
    expect(res.status).toBe(200);

    const rows = rpcUpsertRows();
    expect(rows[0].profile_pic_url).toBe(null);
  });
});
