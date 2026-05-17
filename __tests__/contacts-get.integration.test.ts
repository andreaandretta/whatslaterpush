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

const findContactsMock = jest.fn();
const findChatsMock = jest.fn();
const fetchAllGroupsMock = jest.fn();
const whatsappNumbersMock = jest.fn();
jest.mock('../lib/evolution/client', () => ({
  evolutionClient: {
    findContacts: findContactsMock,
    findChats: findChatsMock,
    fetchAllGroups: fetchAllGroupsMock,
    whatsappNumbers: whatsappNumbersMock,
  },
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

beforeEach(() => {
  mockSupa.calls.length = 0;
  findContactsMock.mockReset();
  findChatsMock.mockReset();
  fetchAllGroupsMock.mockReset();
  whatsappNumbersMock.mockReset();
  // Default: all empty → tests must override what they need
  findContactsMock.mockResolvedValue([]);
  findChatsMock.mockResolvedValue([]);
  fetchAllGroupsMock.mockResolvedValue([]);
  whatsappNumbersMock.mockResolvedValue([]);
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
  };
  mockSupa.setResponse('user_instances:select', {
    id: 'user-uuid-1', instance_name: INSTANCE, phone_number: USER_PHONE,
  });
});

afterEach(() => { process.env = ORIGINAL_ENV; });

async function callGet(opts: { authed?: boolean } = { authed: true }) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  jest.mock('../lib/evolution/client', () => ({ evolutionClient: { findContacts: findContactsMock, findChats: findChatsMock, fetchAllGroups: fetchAllGroupsMock, whatsappNumbers: whatsappNumbersMock } }));
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
      { remoteJid: '1234@g.us', pushName: 'Family Group', name: null },
      { remoteJid: 'broadcast@broadcast', pushName: null, name: null },
      { remoteJid: `${USER_PHONE}@s.whatsapp.net`, pushName: 'Me', name: 'Me' },
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: null },
      { remoteJid: 'invalid@s.whatsapp.net', pushName: 'NoNum', name: null },
    ]);

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    // displayName prefers pushName over the (often null) `name` field.
    expect(body.contacts).toEqual([
      { number: '393339998877', name: 'Anna', pushName: 'Anna' },
      { number: '393331112233', name: 'Marco', pushName: 'Marco' },
    ]);
  });

  test('502 when both Evolution endpoints throw', async () => {
    findContactsMock.mockRejectedValue(new Error('Evolution API error: 500 - down'));
    findChatsMock.mockRejectedValue(new Error('Evolution API error: 500 - down'));
    const res = await callGet();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('evolution_unavailable');
  });

  test('adds group participants not already in chats and strips :N device suffix', async () => {
    findChatsMock.mockResolvedValue([
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: 'Marco Bianchi' },
    ]);
    fetchAllGroupsMock.mockResolvedValue([
      {
        id: '123@g.us',
        subject: 'Famiglia',
        participants: [
          // already known via chats — must not duplicate, must not overwrite name
          { id: '393331112233@s.whatsapp.net' },
          // new participant via device-suffixed JID — must be normalized
          { id: '393335554444:7@s.whatsapp.net' },
          // group JID inside participants — must be filtered
          { id: '999@g.us' },
          // self — must be filtered
          { id: `${USER_PHONE}@s.whatsapp.net` },
        ],
      },
      {
        id: '456@g.us',
        subject: 'Lavoro',
        participants: [
          // duplicate of one already added from previous group → dedup
          { id: '393335554444@s.whatsapp.net' },
          { id: '393339998877@s.whatsapp.net' },
        ],
      },
    ]);
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Group participants without a real name are excluded from the picker —
    // only Marco (who has a pushName) survives the final filter.
    expect(body.contacts).toEqual([
      { number: '393331112233', name: 'Marco', pushName: 'Marco' },
    ]);
  });

  test('enriches group-only contacts with pushName via whatsappNumbers', async () => {
    findChatsMock.mockResolvedValue([
      // Already has a real name — must NOT be looked up
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: 'Marco Bianchi' },
    ]);
    fetchAllGroupsMock.mockResolvedValue([
      {
        id: '123@g.us',
        participants: [
          { id: '393335554444@s.whatsapp.net' },
          { id: '393339998877@s.whatsapp.net' },
          { id: '393336667788@s.whatsapp.net' },
        ],
      },
    ]);
    whatsappNumbersMock.mockResolvedValue([
      // Server gives a pushName → use it as display name AND keep pushName field
      { jid: '393335554444@s.whatsapp.net', number: '393335554444', exists: true, pushName: 'Luca' },
      // Server gives a name → use it as display name (no pushName field set)
      { jid: '393339998877@s.whatsapp.net', number: '393339998877', exists: true, name: 'Anna Rossi' },
      // Server returns nothing useful → fall back stays in place
      { jid: '393336667788@s.whatsapp.net', number: '393336667788', exists: true },
    ]);

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();

    // Marco was already named → not in the batch
    expect(whatsappNumbersMock).toHaveBeenCalledTimes(1);
    const [instanceArg, numbersArg] = whatsappNumbersMock.mock.calls[0];
    expect(instanceArg).toBe(INSTANCE);
    expect(numbersArg.sort()).toEqual(['393335554444', '393336667788', '393339998877']);

    // 393336667788 stays unnamed after enrichment → filtered out of picker output.
    expect(body.contacts).toEqual([
      { number: '393339998877', name: 'Anna Rossi' },
      { number: '393335554444', name: 'Luca', pushName: 'Luca' },
      { number: '393331112233', name: 'Marco', pushName: 'Marco' },
    ]);
  });

  test('continues serving contacts when whatsappNumbers fails', async () => {
    fetchAllGroupsMock.mockResolvedValue([
      { id: '123@g.us', participants: [{ id: '393335554444@s.whatsapp.net' }] },
    ]);
    whatsappNumbersMock.mockRejectedValue(new Error('Evolution API error: 500 - down'));
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Enrichment failed → no real name available → entry filtered out.
    expect(body.contacts).toEqual([]);
  });

  test('skips whatsappNumbers entirely when every contact already has a name', async () => {
    findChatsMock.mockResolvedValue([
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: 'Marco Bianchi' },
    ]);
    const res = await callGet();
    expect(res.status).toBe(200);
    expect(whatsappNumbersMock).not.toHaveBeenCalled();
  });

  test('continues serving contacts when fetchAllGroups fails', async () => {
    findChatsMock.mockResolvedValue([
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: 'Marco Bianchi' },
    ]);
    fetchAllGroupsMock.mockRejectedValue(new Error('Evolution API error: 500 - down'));
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toEqual([
      { number: '393331112233', name: 'Marco', pushName: 'Marco' },
    ]);
  });

  test('prefers findChats when it returns data', async () => {
    findContactsMock.mockResolvedValue([
      { remoteJid: '393339998877@s.whatsapp.net', pushName: 'Anna', name: 'Anna Rossi' },
    ]);
    findChatsMock.mockResolvedValue([
      { remoteJid: '393331112233@s.whatsapp.net', pushName: 'Marco', name: 'Marco Bianchi' },
      { remoteJid: '393335554444@s.whatsapp.net', pushName: 'Luca', name: 'Luca Verdi' },
    ]);
    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toEqual([
      { number: '393335554444', name: 'Luca', pushName: 'Luca' },
      { number: '393331112233', name: 'Marco', pushName: 'Marco' },
    ]);
  });

  test('returns from supabase cache when whatsapp_contacts has rows', async () => {
    mockSupa.setResponse('whatsapp_contacts:select', [
      { contact_number: '393401111111', name: 'Mario Rossi', push_name: 'Mario' },
      { contact_number: '393402222222', name: null,          push_name: 'Anna' },
      { contact_number: '393403333333', name: 'Luca Bianchi', push_name: null },
    ]);
    // Evolution mocks return [] by default; assert below they are never hit.

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toEqual([
      { number: '393402222222', name: 'Anna',         pushName: 'Anna' },
      { number: '393403333333', name: 'Luca Bianchi' },
      { number: '393401111111', name: 'Mario Rossi',  pushName: 'Mario' },
    ]);
    expect(findContactsMock).not.toHaveBeenCalled();
    expect(findChatsMock).not.toHaveBeenCalled();
    expect(fetchAllGroupsMock).not.toHaveBeenCalled();
  });

  test('falls back to evolution pipeline when whatsapp_contacts cache is empty', async () => {
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

  describe('photoUrl exposure', () => {
    test('cache-first includes photoUrl when profile_pic_url is present', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', [
        { contact_number: '393401111111', name: 'Mario', push_name: 'Mario', profile_pic_url: 'https://pps.whatsapp.net/mario.jpg' },
        { contact_number: '393402222222', name: 'Anna',  push_name: 'Anna',  profile_pic_url: null },
      ]);
      const res = await callGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      const mario = body.contacts.find((c: any) => c.number === '393401111111');
      const anna  = body.contacts.find((c: any) => c.number === '393402222222');
      expect(mario.photoUrl).toBe('https://pps.whatsapp.net/mario.jpg');
      expect(anna.photoUrl).toBeUndefined();
    });

    test('evolution fallback exposes photoUrl from findChats.profilePicUrl', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', []);
      findChatsMock.mockResolvedValue([
        { remoteJid: '393401111111@s.whatsapp.net', pushName: 'Mario', name: 'Mario Rossi', profilePicUrl: 'https://pps.whatsapp.net/mario.jpg' },
        { remoteJid: '393402222222@s.whatsapp.net', pushName: 'Anna',  name: 'Anna Rossi' },
      ]);
      const res = await callGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      const mario = body.contacts.find((c: any) => c.number === '393401111111');
      const anna  = body.contacts.find((c: any) => c.number === '393402222222');
      expect(mario.photoUrl).toBe('https://pps.whatsapp.net/mario.jpg');
      expect(anna.photoUrl).toBeUndefined();
    });

    test('evolution fallback uses findContacts.profilePicUrl when findChats is empty', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', []);
      findChatsMock.mockResolvedValue([]);
      findContactsMock.mockResolvedValue([
        { remoteJid: '393404444444@s.whatsapp.net', pushName: 'Sara', name: 'Sara R.', profilePicUrl: 'https://pps.whatsapp.net/sara.jpg' },
      ]);
      const res = await callGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      const sara = body.contacts.find((c: any) => c.number === '393404444444');
      expect(sara.photoUrl).toBe('https://pps.whatsapp.net/sara.jpg');
    });

    test('empty-string profilePicUrl is omitted, not exposed as empty value', async () => {
      mockSupa.setResponse('whatsapp_contacts:select', []);
      findChatsMock.mockResolvedValue([
        { remoteJid: '393401111111@s.whatsapp.net', pushName: 'Mario', name: 'Mario', profilePicUrl: '' },
      ]);
      const res = await callGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      const mario = body.contacts.find((c: any) => c.number === '393401111111');
      expect(mario.photoUrl).toBeUndefined();
    });
  });
});
