/**
 * /api/auth/check — finestra di grazia per una sessione GIÀ autenticata
 * (fase 1b). Scenario reale: l'utente inserisce il codice sul telefono, il
 * webhook marca la sessione 'authenticated', ma lui torna nel browser dopo i
 * 10 minuti di TTL. Il filtro expires_at > now nascondeva anche le righe
 * autenticate → 410, il browser smetteva di interrogare e non riceveva mai il
 * cookie; al nuovo tentativo paired_at era già timbrato → 409, bloccato fuori.
 */
import { createMockSupabase } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('../app/lib/supabase-admin', () => ({ getSupabaseAdmin: () => mockSupa.client }));
jest.mock('../app/lib/audit', () => ({ logAuditEvent: jest.fn(async () => {}), clientIpFromHeaders: () => null }));

const ORIGINAL_ENV = process.env;
const SID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: '0'.repeat(128) };
});
afterEach(() => { process.env = ORIGINAL_ENV; });

async function check() {
  const { POST } = await import('../app/api/auth/check/route');
  const req = new Request('http://localhost/api/auth/check', { method: 'POST', body: JSON.stringify({ sessionId: SID }) });
  return POST(req as any);
}

// Il mock non applica i filtri: la riga restituita è quella che il DB avrebbe.
function row(status: 'pending' | 'authenticated', expiresAt: string) {
  mockSupa.setResponse('pending_auth_sessions:select', { id: SID, phone: '393331234567', status, instance_name: 'SchedWhats-393331234567', expires_at: expiresAt, pairing_code: 'ABCD-1234', conn_state: null });
}

test('autenticata e scaduta da 20 minuti → cookie emesso comunque', async () => {
  row('authenticated', minutesAgo(20));
  const res = await check();
  expect(res.status).toBe(200);
  expect((await res.json()).authenticated).toBe(true);
  expect(res.headers.get('set-cookie') || '').toContain('sw_session=');
});

test('la query non filtra più su expires_at (altrimenti la riga autenticata sparisce)', async () => {
  row('authenticated', minutesAgo(20));
  await check();
  const sel = mockSupa.calls.find((c) => c.table === 'pending_auth_sessions' && c.operation === 'select')!;
  expect(sel.chain.some((m) => m.method === 'gt' && m.args[0] === 'expires_at')).toBe(false);
});

test('in attesa, scaduta da 5 minuti → si continua a interrogare (Evolution ruota ancora il codice)', async () => {
  row('pending', minutesAgo(5));
  const res = await check();
  expect(res.status).toBe(200);
  expect((await res.json()).authenticated).toBe(false);
});

test('in attesa oltre la grazia → 410', async () => {
  row('pending', minutesAgo(25));
  const res = await check();
  expect(res.status).toBe(410);
});

test('autenticata ma oltre la finestra di grazia → 410', async () => {
  row('authenticated', minutesAgo(65));
  const res = await check();
  expect(res.status).toBe(410);
});

test('in attesa e non scaduta → codice corrente, come prima', async () => {
  row('pending', new Date(Date.now() + 5 * 60_000).toISOString());
  const res = await check();
  expect(await res.json()).toMatchObject({ authenticated: false, pairingCode: 'ABCD-1234' });
});
