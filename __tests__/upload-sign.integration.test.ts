/**
 * POST /api/messages/upload/sign — signed upload URL for files too big for the
 * Vercel request body (4.5 MB). Same validation as the multipart route, no bytes
 * pass through the function.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;
let signCalls: string[] = [];

beforeEach(() => {
  signCalls = [];
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: SECRET, SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  (mockSupa.client as any).storage = {
    from: () => ({
      createSignedUploadUrl: async (path: string) => {
        signCalls.push(path);
        return { data: { signedUrl: 'https://test.supabase.co/storage/v1/object/upload/sign/message-media/' + path + '?token=t', token: 't', path }, error: null };
      },
    }),
  };
});
afterEach(() => { process.env = ORIGINAL_ENV; });

async function post(body: any, withCookie = true) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { POST } = await import('../app/api/messages/upload/sign/route');
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  const cookies: Record<string, string> = {};
  if (withCookie) cookies[AUTH_COOKIE_NAME] = await signCookie({ phone: '393331234567', instanceName: 'user_393331234567' });
  req.cookies = { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) };
  return POST(req);
}

describe('POST /api/messages/upload/sign', () => {
  test('401 without a session', async () => {
    const res = await post({ filename: 'a.jpg', mime: 'image/jpeg', size: 10 }, false);
    expect(res.status).toBe(401);
  });

  test('returns a signed URL and a path under the user phone, filename sanitized', async () => {
    const res = await post({ filename: '../foto vacanze (1).JPG', mime: 'image/jpeg', size: 6 * 1024 * 1024 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signed_url).toContain('/storage/v1/object/upload/sign/message-media/');
    expect(body.media_url.startsWith('393331234567/')).toBe(true);
    expect(body.media_url.endsWith('-..foto_vacanze__1_.JPG')).toBe(true);
    expect(body.media_type).toBe('image');
    expect(signCalls).toHaveLength(1);
  });

  test('rejects unsupported mime, oversize and empty files before signing anything', async () => {
    expect((await post({ filename: 'x.exe', mime: 'application/x-msdownload', size: 10 })).status).toBe(400);
    expect((await post({ filename: 'x.mp4', mime: 'video/mp4', size: 17 * 1024 * 1024 })).status).toBe(400);
    expect((await post({ filename: 'x.jpg', mime: 'image/jpeg', size: 0 })).status).toBe(400);
    expect(signCalls).toHaveLength(0);
  });
});
