/**
 * Integration test for POST /api/admin/backfill-photos.
 *
 * Backfills whatsapp_contacts.profile_pic_url for rows still NULL,
 * pulling profilePicUrl in bulk from Evolution findChats/findContacts
 * (no fetchProfile per contact — that's what saturated Evolution in v1).
 *
 * Auth: CRON_SECRET via ?secret=… or `Authorization: Bearer`.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const findContactsMock = jest.fn();
const findChatsMock = jest.fn();
jest.mock('../lib/evolution/client', () => ({
  evolutionClient: {
    findContacts: findContactsMock,
    findChats: findChatsMock,
  },
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  findContactsMock.mockReset();
  findChatsMock.mockReset();
  findContactsMock.mockResolvedValue([]);
  findChatsMock.mockResolvedValue([]);
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRON_SECRET: 'test-cron-secret',
  };
});

afterEach(() => { process.env = ORIGINAL_ENV; });

async function callBackfill(secret?: string) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  jest.mock('../lib/evolution/client', () => ({
    evolutionClient: { findContacts: findContactsMock, findChats: findChatsMock },
  }));
  const { POST } = await import('../app/api/admin/backfill-photos/route');
  const req: any = mockRequest({}, {});
  req.url = secret
    ? `https://whatslaterpush.vercel.app/api/admin/backfill-photos?secret=${secret}`
    : 'https://whatslaterpush.vercel.app/api/admin/backfill-photos';
  return POST(req);
}

// Sleep helper for the rate-limited serial loop — keep this tiny in tests.
function rpcUpsertCalls() {
  return mockSupa.calls.filter(
    c => c.table === '__rpc__' && c.operation === 'upsert_whatsapp_contacts'
  );
}

describe('POST /api/admin/backfill-photos', () => {
  test('401 without secret', async () => {
    const res = await callBackfill();
    expect(res.status).toBe(401);
  });

  test('401 with wrong secret', async () => {
    const res = await callBackfill('wrong');
    expect(res.status).toBe(401);
  });

  test('500 when CRON_SECRET not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await callBackfill('whatever');
    expect(res.status).toBe(500);
  });
});

describe('POST /api/admin/backfill-photos — Evolution calls', () => {
  test('calls findChats and findContacts for users that have contacts missing photo', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
      { phone_number: '393332222222', instance_name: 'SchedWhats-393332222222' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' },
      { contact_number: '393409990002' },
    ]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    // Both endpoints called for both users — 4 calls total.
    expect(findChatsMock).toHaveBeenCalledTimes(2);
    expect(findContactsMock).toHaveBeenCalledTimes(2);
    expect(findChatsMock.mock.calls.map(c => c[0]).sort()).toEqual([
      'SchedWhats-393331111111',
      'SchedWhats-393332222222',
    ]);
  });

  test('skips users whose cache has no rows missing photo', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
    ]);
    // No contacts returned for this user → endpoint should not call Evolution.
    mockSupa.setResponse('whatsapp_contacts:select', []);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    expect(findChatsMock).not.toHaveBeenCalled();
    expect(findContactsMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.users_processed).toBe(0);
    expect(body.users_skipped).toBe(1);
  });
});

describe('POST /api/admin/backfill-photos — RPC payload', () => {
  test('upserts only contacts that were missing photo AND whose URL was found', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' }, // missing photo, URL found below
      { contact_number: '393409990002' }, // missing photo, NO URL in evolution response
      { contact_number: '393409990003' }, // missing photo, URL found below
    ]);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 2);

    findChatsMock.mockResolvedValue([
      { remoteJid: '393409990001@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/01.jpg' },
      { remoteJid: '393409990003@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/03.jpg' },
      // Not in the missing-photo list — should be ignored even though URL is here.
      { remoteJid: '393499999999@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/xx.jpg' },
    ]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    const rpcCalls = rpcUpsertCalls();
    expect(rpcCalls.length).toBe(1);
    const rows = rpcCalls[0].args[0].p_rows as any[];

    // Exactly two rows — 990001 and 990003. Neither 990002 (no URL) nor
    // 999999 (not in missing-photo list).
    expect(rows.length).toBe(2);
    const sortedNums = rows.map((r: any) => r.contact_number).sort();
    expect(sortedNums).toEqual(['393409990001', '393409990003']);

    for (const r of rows) {
      expect(r.user_phone).toBe('393331111111');
      expect(r.name).toBe(null);
      expect(r.push_name).toBe(null);
      expect(r.source).toBe('MANUAL');
      expect(r.profile_pic_url).toMatch(/^https:\/\/pps\.whatsapp\.net\//);
    }
  });

  test('prefers findChats URL over findContacts when both have it', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' },
    ]);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);

    findChatsMock.mockResolvedValue([
      { remoteJid: '393409990001@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/from-chats.jpg' },
    ]);
    findContactsMock.mockResolvedValue([
      { remoteJid: '393409990001@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/from-contacts.jpg' },
    ]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    const rows = rpcUpsertCalls()[0].args[0].p_rows as any[];
    expect(rows[0].profile_pic_url).toBe('https://pps.whatsapp.net/from-chats.jpg');
  });

  test('falls back to findContacts URL when findChats has none', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' },
    ]);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);

    findChatsMock.mockResolvedValue([
      { remoteJid: '393409990001@s.whatsapp.net', profilePicUrl: null },
    ]);
    findContactsMock.mockResolvedValue([
      { remoteJid: '393409990001@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/contacts.jpg' },
    ]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    const rows = rpcUpsertCalls()[0].args[0].p_rows as any[];
    expect(rows[0].profile_pic_url).toBe('https://pps.whatsapp.net/contacts.jpg');
  });

  test('skips RPC entirely when no URL was found for any missing-photo contact', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' },
    ]);
    // Both endpoints return empty arrays → no URL anywhere.
    findChatsMock.mockResolvedValue([]);
    findContactsMock.mockResolvedValue([]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    expect(rpcUpsertCalls().length).toBe(0);
  });

  test('normalises JIDs with :N device suffix when matching', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'SchedWhats-393331111111' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' },
    ]);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);

    findChatsMock.mockResolvedValue([
      // Device-suffixed JID — still belongs to 393409990001.
      { remoteJid: '393409990001:7@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/01.jpg' },
    ]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    const rows = rpcUpsertCalls()[0].args[0].p_rows as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].contact_number).toBe('393409990001');
  });
});

describe('POST /api/admin/backfill-photos — failure isolation', () => {
  test('continues to next user when Evolution throws for one user', async () => {
    mockSupa.setResponse('user_instances:select', [
      { phone_number: '393331111111', instance_name: 'inst-A' },
      { phone_number: '393332222222', instance_name: 'inst-B' },
    ]);
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393409990001' },
    ]);
    mockSupa.setRpcResponse('upsert_whatsapp_contacts', 1);

    // First user: both endpoints fail.
    // Second user: succeeds with a URL.
    findChatsMock
      .mockRejectedValueOnce(new Error('Evolution API error: 502 - down'))
      .mockResolvedValueOnce([
        { remoteJid: '393409990001@s.whatsapp.net', profilePicUrl: 'https://pps.whatsapp.net/b.jpg' },
      ]);
    findContactsMock
      .mockRejectedValueOnce(new Error('Evolution API error: 502 - down'))
      .mockResolvedValueOnce([]);

    const res = await callBackfill('test-cron-secret');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.failures.length).toBe(1);
    expect(body.failures[0].user_phone).toBe('393331111111');
    // Second user still got its RPC.
    const rpcCalls = rpcUpsertCalls();
    expect(rpcCalls.length).toBe(1);
    const rows = rpcCalls[0].args[0].p_rows as any[];
    expect(rows[0].user_phone).toBe('393332222222');
  });
});
