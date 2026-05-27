/**
 * Integration tests for POST /api/messages with media attachments.
 * Mocks Supabase; verifies the row payload carries media_* columns.
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
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

async function callPost(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const cookies: Record<string, string> = {};
  cookies[AUTH_COOKIE_NAME] = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.cookies = { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) };
  const { POST } = await import('../app/api/messages/route');
  return POST(req);
}

function mockUserInstance() {
  mockSupa.setResponse('user_instances:select', {
    id: 'user-uuid', subscription_plan: 'personal', connection_status: 'open',
  });
}

function mockInsertedRow() {
  mockSupa.setResponse('scheduled_messages:insert', {
    id: 'new-msg', scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
  });
}

describe('POST /api/messages — media support', () => {
  test('accepts message with media + empty body (media is the message)', async () => {
    mockUserInstance();
    mockInsertedRow();
    const res = await callPost({
      recipient_number: '393401234567',
      recipient_name: 'Marco',
      message: '',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      media_type: 'image',
      media_url: '393331234567/abc-foto.jpg',
      media_filename: 'foto.jpg',
    });
    expect(res.status).toBe(200);
    const insertCall = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert');
    const row = insertCall!.args[0];
    expect(row.media_type).toBe('image');
    expect(row.media_url).toBe('393331234567/abc-foto.jpg');
    expect(row.media_filename).toBe('foto.jpg');
  });

  test('accepts message with media + caption stored as media_caption', async () => {
    mockUserInstance();
    mockInsertedRow();
    const res = await callPost({
      recipient_number: '393401234567',
      message: 'Guarda questa foto',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      media_type: 'image',
      media_url: '393331234567/path.jpg',
      media_caption: 'Caption esplicita',
    });
    expect(res.status).toBe(200);
    const row = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert')!.args[0];
    expect(row.media_caption).toBe('Caption esplicita');
  });

  test('rejects unknown media_type', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: '393401234567',
      message: '',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      media_type: 'something_weird',
      media_url: '393331234567/x.bin',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_media_type');
  });

  test('text-only path still requires non-empty body (no regression)', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: '393401234567',
      message: '',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_message');
  });

  test('media_url without media_type is treated as text path (both required)', async () => {
    mockUserInstance();
    const res = await callPost({
      recipient_number: '393401234567',
      message: '', // empty body
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
      media_url: 'some/path.jpg', // but no media_type
    });
    // Without media_type, has_media is false → empty body fails as before.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_message');
  });

  test('writes null media_* fields when no media attached', async () => {
    mockUserInstance();
    mockInsertedRow();
    const res = await callPost({
      recipient_number: '393401234567',
      message: 'Solo testo',
      scheduled_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect(res.status).toBe(200);
    const row = mockSupa.calls.find(c => c.table === 'scheduled_messages' && c.operation === 'insert')!.args[0];
    expect(row.media_type).toBeNull();
    expect(row.media_url).toBeNull();
    expect(row.media_filename).toBeNull();
    expect(row.media_caption).toBeNull();
  });
});
