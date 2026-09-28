/**
 * /api/auth/init con una sessione valida non deve scollegare un WhatsApp che
 * funziona (fase 1b). Scenario reale: la dashboard mandava a /connect per un
 * blip di rete o per un 'connecting' transitorio; l'utente reinseriva il
 * numero, il suo cookie passava il guard owner e init chiamava
 * forceDeleteInstance (logout + delete) sull'istanza viva: dispositivo
 * rimosso dal telefono, promemoria fermi, e un logout + nuovo device in più
 * nel conteggio anti-ban.
 */
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase, createFetchMock } from './helpers/mocks';

jest.setTimeout(20000);

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const PHONE = '393331234567';
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: '0'.repeat(128),
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    NEXT_PUBLIC_APP_URL: 'https://whatslaterpush.vercel.app',
    WEBHOOK_SECRET: 'whsec-test',
  };
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  mockSupa.setResponse('whatsapp_contacts:select', null, null, { count: 5 });
  (global as any).fetch = fetchMock.mockFetch;
});
afterEach(() => { process.env = ORIGINAL_ENV; });

const STATE = (state: string) => () => ({
  ok: true, status: 200,
  json: async () => ({ instance: { instanceName: 'SchedWhats-' + PHONE, state } }),
  text: async () => '{}',
});
const NOT_FOUND = () => ({ ok: false, status: 404, json: async () => ({ status: 404 }), text: async () => '{}' });
const OK = () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' });
const CREATE_OK = () => ({
  ok: true, status: 201,
  json: async () => ({ qrcode: { base64: 'data:image/png;base64,QR', pairingCode: 'ABCD-1234' } }),
  text: async () => '{}',
});

async function initAsOwner(dbStatus: string) {
  mockSupa.setResponse('user_instances:select', { phone_number: PHONE, connection_status: dbStatus, paired_at: '2026-09-01T10:00:00Z' });
  const cookie = await signCookie({ phone: PHONE, instanceName: 'SchedWhats-' + PHONE });
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  (global as any).fetch = fetchMock.mockFetch;
  const { POST } = await import('../app/api/auth/init/route');
  const req = new Request('http://localhost/api/auth/init', { method: 'POST', body: JSON.stringify({ phone: PHONE }) });
  (req as any).cookies = { get: (n: string) => (n === 'sw_session' ? { value: cookie } : undefined) };
  return POST(req as any);
}

const teardownCalls = () => fetchMock.calls.filter((c) => c.url.includes('/instance/logout/') || c.url.includes('/instance/delete/'));

test('owner + Evolution "open" → 200 already_connected, nessun logout/delete, nessuna nuova istanza', async () => {
  fetchMock.setHandler('/instance/connectionState/', STATE('open'));
  fetchMock.setHandler('/instance/logout/', OK);
  fetchMock.setHandler('/instance/delete/', OK);
  fetchMock.setHandler('/instance/create', CREATE_OK);
  const res = await initAsOwner('open');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ already_connected: true, redirect: '/dashboard' });
  expect(body.pairingCode).toBeUndefined();
  expect(teardownCalls()).toHaveLength(0);
  expect(fetchMock.calls.some((c) => c.url.includes('/instance/create'))).toBe(false);
  // la sessione di pairing appena creata non resta appesa
  expect(mockSupa.calls.some((c) => c.table === 'pending_auth_sessions' && c.operation === 'delete')).toBe(true);
});

test('anche con il DB che dice "connecting"/"close" (stato stantio) conta lo stato vivo di Evolution', async () => {
  fetchMock.setHandler('/instance/connectionState/', STATE('open'));
  const res = await initAsOwner('connecting');
  expect((await res.json()).already_connected).toBe(true);
  expect(teardownCalls()).toHaveLength(0);
});

test('owner + Evolution "close" → re-pair come prima (teardown + nuovo codice)', async () => {
  let n = 0;
  // 1ª GET: stato vivo 'close'; dopo il teardown l'istanza risulta sparita (404)
  fetchMock.setHandler('/instance/connectionState/', () => (n++ === 0 ? STATE('close')() : NOT_FOUND()));
  fetchMock.setHandler('/instance/logout/', OK);
  fetchMock.setHandler('/instance/delete/', OK);
  fetchMock.setHandler('/instance/create', CREATE_OK);
  fetchMock.setHandler('/webhook/set/', OK);
  const res = await initAsOwner('close');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.already_connected).toBeUndefined();
  expect(body.pairingCode).toBe('ABCD-1234');
  expect(teardownCalls().length).toBeGreaterThan(0);
});
