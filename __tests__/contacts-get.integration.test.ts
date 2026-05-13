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
jest.mock('../lib/evolution/client', () => ({
  evolutionClient: {
    findContacts: findContactsMock,
    findChats: findChatsMock,
    fetchAllGroups: fetchAllGroupsMock,
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
  // Default: all empty → tests must override what they need
  findContactsMock.mockResolvedValue([]);
  findChatsMock.mockResolvedValue([]);
  fetchAllGroupsMock.mockResolvedValue([]);
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
  jest.mock('../lib/evolution/client', () => ({ evolutionClient: { findContacts: findContactsMock, findChats: findChatsMock, fetchAllGroups: fetchAllGroupsMock } }));
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
    expect(body.contacts).toEqual([
      { number: '393339998877', name: 'Anna Rossi', pushName: 'Anna' },
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
    expect(body.contacts).toEqual([
      { number: '393335554444', name: '+393335554444' },
      { number: '393339998877', name: '+393339998877' },
      { number: '393331112233', name: 'Marco Bianchi', pushName: 'Marco' },
    ]);
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
      { number: '393331112233', name: 'Marco Bianchi', pushName: 'Marco' },
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
      { number: '393335554444', name: 'Luca Verdi', pushName: 'Luca' },
      { number: '393331112233', name: 'Marco Bianchi', pushName: 'Marco' },
    ]);
  });
});
