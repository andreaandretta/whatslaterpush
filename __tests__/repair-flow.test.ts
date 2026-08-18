/**
 * TDD — catch-22 del re-pair (bug prod 2026-08-18).
 *
 * Da loggato il middleware rimbalzava /connect → /dashboard (il bottone
 * "Ricollega" sembrava morto); da sloggato il guard #8 rispondeva 409 su
 * QUALSIASI riga user_instances esistente. Risultato: re-pair impossibile
 * dalla UI in entrambi gli stati, e l'onboarding di un numero vergine si
 * murava da solo al primo retry (la riga trial upsertata dal tentativo
 * fallito ri-armava il 409).
 *
 * Fix: (1) /connect resta raggiungibile da loggati — è il percorso di
 * re-pair, e il cookie è proprio ciò che fa passare il guard; (2) il guard
 * scatta solo su account REALI, discriminati dalla nuova colonna paired_at
 * (timbrata dal webhook al primo CONNECTION_UPDATE open): una riga senza
 * paired_at è onboarding mai completato e si può re-inizializzare senza
 * cookie; (3) i rami d'errore di init cancellano la riga solo se mai
 * accoppiata.
 */
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase, createFetchMock, mockRequest, makeConnectionPayload } from './helpers/mocks';

jest.setTimeout(20000);

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
    WEBHOOK_SECRET: 'test-webhook-secret',
  };
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  mockSupa.setResponse('whatsapp_contacts:select', null, null, { count: 5 });
  mockSupa.setResponse('user_instances:select', null);
  // Teardown verificato: solo il 404 JSON della guard prova l'assenza.
  fetchMock.setHandler('/instance/connectionState/', async () => ({
    ok: false, status: 404,
    json: async () => ({ status: 404, error: 'Not Found', response: { message: ['Instance not found'] } }),
    text: async () => '{}',
  }));
  fetchMock.setHandler('/instance/logout/', async () => ({ ok: false, status: 404, json: async () => ({ status: 404 }), text: async () => '{}' }));
  fetchMock.setHandler('/instance/delete/', async () => ({ ok: false, status: 404, json: async () => ({ status: 404 }), text: async () => '{}' }));
  fetchMock.setHandler('/instance/create', async () => ({
    ok: true, status: 201,
    json: async () => ({ qrcode: { base64: 'data:image/png;base64,FAKEQR', pairingCode: 'ABCD-1234' } }),
    text: async () => '{}',
  }));
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makePageReq(pathname: string, cookieValue: string | null) {
  const url = `http://localhost${pathname}`;
  const headers: any = {};
  if (cookieValue) headers.cookie = `sw_session=${cookieValue}`;
  const req: any = new Request(url, { method: 'GET', headers });
  const cookieMap = new Map<string, string>();
  if (cookieValue) cookieMap.set('sw_session', cookieValue);
  req.cookies = {
    get: (n: string) => (cookieMap.has(n) ? { value: cookieMap.get(n) } : undefined),
  };
  req.nextUrl = Object.assign(new URL(url), { clone: () => new URL(url) });
  return req;
}

function initReq(phone: string, cookieValue?: string) {
  const req = new Request('http://localhost/api/auth/init', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  const cm = new Map<string, string>();
  if (cookieValue) cm.set('sw_session', cookieValue);
  (req as any).cookies = { get: (n: string) => (cm.has(n) ? { value: cm.get(n) } : undefined) };
  return req;
}

describe('middleware — /connect raggiungibile da loggati (fine del catch-22)', () => {
  test('utente loggato su /connect NON viene rimbalzato (è il percorso di re-pair)', async () => {
    const { middleware } = await import('../middleware');
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const res: any = await middleware(makePageReq('/connect', cookie) as any);
    expect(res.headers.get('location')).toBeNull();
  });

  test('utente loggato su / e /login viene ancora rimbalzato a /dashboard (regressione)', async () => {
    const { middleware } = await import('../middleware');
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    for (const path of ['/', '/login']) {
      const res: any = await middleware(makePageReq(path, cookie) as any);
      expect(res.headers.get('location') || '').toContain('/dashboard');
    }
  });

  test('utente NON loggato su /connect passa (invariato)', async () => {
    const { middleware } = await import('../middleware');
    const res: any = await middleware(makePageReq('/connect', null) as any);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('guard #8 su paired_at — solo gli account REALI sono owner-only', () => {
  test('riga con paired_at (account reale) + niente cookie → 409 (hijack resta chiuso)', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { phone_number: '393331234567', connection_status: 'close', paired_at: '2026-07-05T15:22:07Z' });
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initReq('393331234567') as any);
    expect(res.status).toBe(409);
  });

  test('riga SENZA paired_at (onboarding mai completato) + niente cookie → il retry procede fino al codice', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { phone_number: '393331234567', connection_status: 'close', paired_at: null });
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initReq('393331234567') as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pairingCode).toBe('ABCD-1234');
  });

  test('riga con paired_at + cookie del proprietario → procede (re-pair owner, invariato)', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { phone_number: '393331234567', connection_status: 'close', paired_at: '2026-07-05T15:22:07Z' });
    (global as any).fetch = fetchMock.mockFetch;
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initReq('393331234567', cookie) as any);
    expect(res.status).toBe(200);
  });

  test('riga garbage (senza paired_at) + tentativo fallito → la riga viene rimossa (il 409 non si ri-arma)', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { phone_number: '393331234567', connection_status: 'close', paired_at: null });
    fetchMock.setHandler('/instance/create', async () => ({
      ok: false, status: 403,
      json: async () => ({ status: 403, error: 'Forbidden', response: { message: ['already in use'] } }),
      text: async () => '{}',
    }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initReq('393331234567') as any);
    expect(res.status).toBe(500);
    const rowCleanup = mockSupa.calls.find(c =>
      c.table === 'user_instances' && c.operation === 'delete' &&
      c.chain.some(m => m.method === 'eq' && m.args[0] === 'phone_number') &&
      !c.chain.some(m => m.method === 'neq'));
    expect(rowCleanup).toBeTruthy();
    // ripristina il create OK per i test successivi (handler condivisi a livello file)
    fetchMock.setHandler('/instance/create', async () => ({
      ok: true, status: 201,
      json: async () => ({ qrcode: { base64: 'x', pairingCode: 'ABCD-1234' } }),
      text: async () => '{}',
    }));
  });
});

describe('webhook — paired_at timbrato al primo open', () => {
  async function callWebhook(body: any) {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/webhook/route');
    const req = mockRequest(body, { 'x-webhook-secret': 'test-webhook-secret' });
    return POST(req as any);
  }

  test('CONNECTION_UPDATE open → update paired_at con guardia is-null (timbro una tantum)', async () => {
    mockSupa.setResponse('user_instances:update', [{ id: 'ui-1', phone_number: '393331234567' }]);
    await callWebhook(makeConnectionPayload('SchedWhats-393331234567', 'open'));
    const stamp = mockSupa.calls.find(c =>
      c.table === 'user_instances' && c.operation === 'update' &&
      c.args[0] && Object.prototype.hasOwnProperty.call(c.args[0], 'paired_at') &&
      c.chain.some(m => m.method === 'is' && m.args[0] === 'paired_at' && m.args[1] === null));
    expect(stamp).toBeTruthy();
  });

  test('CONNECTION_UPDATE close → nessun timbro paired_at', async () => {
    mockSupa.setResponse('user_instances:update', [{ id: 'ui-1', phone_number: '393331234567' }]);
    await callWebhook(makeConnectionPayload('SchedWhats-393331234567', 'close'));
    const stamp = mockSupa.calls.find(c =>
      c.table === 'user_instances' && c.operation === 'update' &&
      c.args[0] && Object.prototype.hasOwnProperty.call(c.args[0], 'paired_at'));
    expect(stamp).toBeFalsy();
  });
});
