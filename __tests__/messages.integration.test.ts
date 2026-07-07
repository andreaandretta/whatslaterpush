import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase } from './helpers/mocks';

const SECRET = '0'.repeat(128);
const mockSupa = createMockSupabase();
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function reqWithCookie(method: string, url: string, cookieValue: string | null, body?: any) {
  const headers: any = { 'content-type': 'application/json' };
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  const req = new Request(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // Mock the cookies property that NextRequest provides
  const cookieMap = new Map<string, string>();
  if (cookieValue) {
    cookieMap.set('sw_session', cookieValue);
  }
  (req as any).cookies = {
    get: (name: string) => cookieMap.has(name) ? { value: cookieMap.get(name) } : undefined,
  };
  return req;
}

describe('GET /api/messages', () => {
  test('returns 401 without cookie', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', null) as any);
    expect(res.status).toBe(401);
  });

  test('returns messages for cookie phone', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('user_instances:select', { id: 'u1', subscription_plan: 'free', trial_ends_at: null, connection_status: 'open' }, null);
    mockSupa.setResponse('scheduled_messages:select', [{ id: 'm1', recipient_name: 'Mario' }], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', cookie) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.messages)).toBe(true);
  });

  // Payload contract with the client (free beta): subscription_plan is the
  // plan whose limits/UI apply — the dashboard gates ALL plan UI on it —
  // while raw_plan mirrors the stored one (the Stripe portal button keys on
  // it, or paying users would lose portal access during the beta).
  test('billing ON: subscription_plan = raw plan, raw_plan mirrors it, billing_enabled true', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { id: 'u1', subscription_plan: 'free', trial_ends_at: null, connection_status: 'open' }, null);
    mockSupa.setResponse('scheduled_messages:select', [], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', cookie) as any);
    const body = await res.json();
    expect(body.subscription_plan).toBe('free');
    expect(body.raw_plan).toBe('free');
    expect(body.billing_enabled).toBe(true);
  });

  test('billing OFF: subscription_plan = beta (effective), raw_plan keeps the DB value', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.BILLING_ENABLED = 'false';
    mockSupa.setResponse('user_instances:select', { id: 'u1', subscription_plan: 'trial', trial_ends_at: '2026-01-01T00:00:00.000Z', connection_status: 'open' }, null);
    mockSupa.setResponse('scheduled_messages:select', [], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/messages/route');
    const res = await GET(reqWithCookie('GET', 'http://localhost/api/messages', cookie) as any);
    const body = await res.json();
    expect(body.subscription_plan).toBe('beta');
    expect(body.raw_plan).toBe('trial');
    expect(body.billing_enabled).toBe(false);
  });

  // History-window fix (runbook §2): pending/paused/awaiting rows are the
  // user's queue, not history — they must stay visible (and thus editable/
  // resumable) past historyDays, or the cron keeps sending rows the user can
  // no longer see. The window keeps bounding terminal rows only.
  test('history window: in-flight statuses stay visible past historyDays (or-filter)', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { id: 'u1', subscription_plan: 'free', trial_ends_at: null, connection_status: 'open' }, null);
    mockSupa.setResponse('scheduled_messages:select', [], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { GET } = await import('../app/api/messages/route');
    await GET(reqWithCookie('GET', 'http://localhost/api/messages', cookie) as any);
    const q = mockSupa.calls.find(
      (c) => c.table === 'scheduled_messages' && c.operation === 'select' && c.chain.some((s: any) => s.method === 'or')
    );
    expect(q).toBeDefined();
    const or = q!.chain.find((s: any) => s.method === 'or');
    expect(String(or!.args[0])).toContain('created_at.gte.');
    expect(String(or!.args[0])).toContain('status.in.(pending,paused,processing,awaiting_time,awaiting_recipient,awaiting_confirm)');
  });
});

describe('DELETE /api/messages', () => {
  test('returns 401 without cookie', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(reqWithCookie('DELETE', 'http://localhost/api/messages', null, { id: 'm1' }) as any);
    expect(res.status).toBe(401);
  });

  test('deletes only when message belongs to cookie phone', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    process.env.AUTH_COOKIE_SECRET = SECRET;
    mockSupa.setResponse('scheduled_messages:select', { id: 'm1', instance_phone: '393331234567' }, null);
    mockSupa.setResponse('scheduled_messages:update', [{ id: 'm1' }], null);
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(reqWithCookie('DELETE', 'http://localhost/api/messages', cookie, { id: 'm1' }) as any);
    expect(res.status).toBe(200);
  });
});
