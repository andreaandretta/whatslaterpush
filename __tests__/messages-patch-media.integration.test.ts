/**
 * PATCH /api/messages — attachment edits (22 set 2026).
 * `media: null` removes the attachment, `media: {...}` replaces it with a file
 * already uploaded under the user's own prefix. The old Storage object is
 * removed only when no other row (recurrence occurrences share files) uses it.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
jest.mock('../app/lib/audit', () => ({ logAuditEvent: jest.fn(async () => {}), hashContactRef: (x: string) => x, clientIpFromHeaders: () => null }));

const PHONE = '393331112222';
const ORIGINAL_ENV = process.env;
let row: any;
let sharedCount = 0;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: '0'.repeat(128), SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  row = { id: 'msg-1', instance_phone: PHONE, status: 'pending', media_type: 'image', media_url: `${PHONE}/old-foto.jpg`, media_filename: 'foto.jpg', recurrence_rule: null, parsed_message: 'Ciao', caption: 'Ciao' };
  sharedCount = 0;
  // select: the row itself, or the "who else uses this file" count (head:true)
  mockSupa.setHandler('scheduled_messages:select', (call) => {
    const opts = call.args[1] as any;
    if (opts && opts.head) return { data: null, error: null, count: sharedCount } as any;
    return { data: row, error: null };
  });
  mockSupa.setHandler('scheduled_messages:update', (call) => ({ data: [{ ...row, ...(call.args[0] as any) }], error: null }));
  mockSupa.setStorageResponse('message-media:remove', [], null);
});
afterEach(() => { process.env = ORIGINAL_ENV; });

async function patch(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  jest.mock('../app/lib/audit', () => ({ logAuditEvent: jest.fn(async () => {}), hashContactRef: (x: string) => x, clientIpFromHeaders: () => null }));
  const { PATCH } = await import('../app/api/messages/route');
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  const cookies: Record<string, string> = { [AUTH_COOKIE_NAME]: await signCookie({ phone: PHONE, instanceName: `user_${PHONE}` }) };
  req.cookies = { get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) };
  return PATCH(req);
}

const updates = () => mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'update');
const removes = () => mockSupa.calls.filter((c) => c.table === 'storage:message-media' && c.operation === 'remove');

describe('PATCH /api/messages — media', () => {
  test('media: null clears the four media columns and removes the orphan file from Storage', async () => {
    const res = await patch({ id: 'msg-1', media: null });
    expect(res.status).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].args[0]).toMatchObject({ media_type: null, media_url: null, media_filename: null, media_caption: null });
    expect(removes()).toHaveLength(1);
    expect(removes()[0].args[0]).toEqual([`${PHONE}/old-foto.jpg`]);
  });

  test('media: null keeps the file when another row (recurrence occurrence) still uses it', async () => {
    sharedCount = 1;
    const res = await patch({ id: 'msg-1', media: null });
    expect(res.status).toBe(200);
    expect(removes()).toHaveLength(0);
  });

  test('media: null on a message without text is refused (a message cannot be empty)', async () => {
    row.parsed_message = ''; row.caption = '';
    const res = await patch({ id: 'msg-1', media: null });
    expect(res.status).toBe(400);
    expect(updates()).toHaveLength(0);
  });

  test('replacing the attachment writes the new fields and drops the old file', async () => {
    const res = await patch({ id: 'msg-1', media: { media_type: 'document', media_url: `${PHONE}/new-orari.pdf`, media_filename: 'orari.pdf' } });
    expect(res.status).toBe(200);
    expect(updates()[0].args[0]).toMatchObject({ media_type: 'document', media_url: `${PHONE}/new-orari.pdf`, media_filename: 'orari.pdf' });
    expect(removes()[0].args[0]).toEqual([`${PHONE}/old-foto.jpg`]);
  });

  test('a media_url outside the user prefix or with .. is refused (IDOR guard)', async () => {
    expect((await patch({ id: 'msg-1', media: { media_type: 'image', media_url: '393339999999/x.jpg', media_filename: 'x.jpg' } })).status).toBe(400);
    expect((await patch({ id: 'msg-1', media: { media_type: 'image', media_url: `${PHONE}/../x.jpg`, media_filename: 'x.jpg' } })).status).toBe(400);
    expect((await patch({ id: 'msg-1', media: { media_type: 'exe', media_url: `${PHONE}/x.exe`, media_filename: 'x.exe' } })).status).toBe(400);
    expect(updates()).toHaveLength(0);
  });

  test('a PATCH without media leaves the attachment untouched', async () => {
    const res = await patch({ id: 'msg-1', message: 'Nuovo testo' });
    expect(res.status).toBe(200);
    expect(updates()[0].args[0]).not.toHaveProperty('media_url');
    expect(updates()[0].args[0]).toMatchObject({ parsed_message: 'Nuovo testo', media_caption: 'Nuovo testo' });
    expect(removes()).toHaveLength(0);
  });
});
