/**
 * TDD — pairing "codice morto" (bug prod 2026-08-17, istanza zombie).
 *
 * Root cause verificata sul nodo: un'istanza zombie (DB 'open', in-memory
 * 'connecting') sopravvive a logout+delete perché v2.3.7 deleteInstance fa
 * logout prima del delete e sock.logout() lancia su un socket rotto. Il flusso
 * init ignorava OGNI risposta HTTP: forceDeleteInstance fire-and-forget,
 * /instance/create 403 "name already in use" non controllato, e il fallback
 * /instance/connect su stato 'connecting' restituisce lo stale in-memory
 * qrCode → la UI mostra un pairing code MORTO ("verifica che il numero sia
 * corretto" sul telefono) e logga pure pairing_started.
 *
 * I due errori [Validate] nei log container (requires property "webhook" +
 * events[4] enum) sono il doppio tentativo flat/nested di setWebhook, che su
 * v2.3.7 è SEMPRE fallito (anche nei pairing riusciti: il webhook lo configura
 * la create col blocco nested). Qui fissiamo anche quello: singola POST
 * conforme allo schema v2 (root `webhook`, byEvents/base64, eventi nell'enum —
 * MESSAGING_HISTORY_SET non c'è e fa 400-are l'intera config).
 */
import { forceDeleteInstance } from '../app/lib/evolution';
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase, createFetchMock } from './helpers/mocks';

jest.setTimeout(20000);

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

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
  // Cache contatti popolata → syncFullHistory=false → niente attesa semaforo.
  mockSupa.setResponse('whatsapp_contacts:select', null, null, { count: 5 });
  (global as any).fetch = fetchMock.mockFetch;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  // createFetchMock non espone un reset degli handler: le suite sotto li
  // re-impostano sempre esplicitamente prima dell'uso.
});

const NOT_FOUND = () => ({
  ok: false, status: 404,
  json: async () => ({ status: 404, error: 'Not Found', response: { message: ['Instance not found'] } }),
  text: async () => '{}',
});
const OK_EMPTY = () => ({ ok: true, status: 200, json: async () => ({ status: 'SUCCESS' }), text: async () => '{}' });
const STATE = (state: string) => () => ({
  ok: true, status: 200,
  json: async () => ({ instance: { instanceName: 'SchedWhats-393331234567', state } }),
  text: async () => '{}',
});
const CREATE_OK = () => ({
  ok: true, status: 201,
  json: async () => ({ qrcode: { base64: 'data:image/png;base64,FAKEQR', pairingCode: 'ABCD-1234' } }),
  text: async () => '{}',
});

function initRequest(phone = '393331234567') {
  const req = new Request('http://localhost/api/auth/init', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  });
  (req as any).cookies = { get: () => undefined };
  return req;
}

describe('forceDeleteInstance — teardown verificato', () => {
  test('ritorna true quando l\'istanza risulta rimossa (connectionState 404)', async () => {
    fetchMock.setHandler('/instance/logout/', OK_EMPTY);
    fetchMock.setHandler('/instance/delete/', OK_EMPTY);
    fetchMock.setHandler('/instance/connectionState/', NOT_FOUND);
    const ok = await forceDeleteInstance('SchedWhats-393331234567');
    expect(ok).toBe(true);
    const urls = fetchMock.calls.map(c => c.url);
    expect(urls.some(u => u.includes('/instance/logout/SchedWhats-393331234567'))).toBe(true);
    expect(urls.some(u => u.includes('/instance/delete/SchedWhats-393331234567'))).toBe(true);
    // niente escalation se la verifica passa al primo giro
    expect(urls.some(u => u.includes('/instance/restart/'))).toBe(false);
  });

  test('zombie inamovibile: escalation restart POST e ritorna false', async () => {
    fetchMock.setHandler('/instance/logout/', () => ({ ok: false, status: 500, json: async () => ({ status: 500 }), text: async () => '{}' }));
    fetchMock.setHandler('/instance/delete/', () => ({ ok: false, status: 400, json: async () => ({ status: 400 }), text: async () => '{}' }));
    fetchMock.setHandler('/instance/connectionState/', STATE('connecting'));
    const ok = await forceDeleteInstance('SchedWhats-393331234567');
    expect(ok).toBe(false);
    const restart = fetchMock.calls.find(c => c.url.includes('/instance/restart/SchedWhats-393331234567'));
    expect(restart).toBeTruthy();
    expect((restart!.options.method || 'GET').toUpperCase()).toBe('POST');
  });

  test('zombie guarito dall\'escalation: è la delete POST-restart a rimuoverla, non il restart', async () => {
    // Fedele a v2.3.7: restart fa solo client.end() e l'istanza RESTA nel
    // registry; solo una delete riuscita la rimuove. Il mock lega la
    // sparizione alla delete-dopo-restart, così una regressione che salti la
    // seconda delete fa fallire il test.
    let restarted = false;
    let deletedAfterRestart = false;
    fetchMock.setHandler('/instance/logout/', () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '{}' }));
    fetchMock.setHandler('/instance/restart/', () => { restarted = true; return OK_EMPTY(); });
    fetchMock.setHandler('/instance/delete/', () => {
      if (!restarted) return { ok: false, status: 400, json: async () => ({}), text: async () => '{}' };
      deletedAfterRestart = true;
      return OK_EMPTY();
    });
    fetchMock.setHandler('/instance/connectionState/', () =>
      deletedAfterRestart ? NOT_FOUND() : STATE('connecting')());
    const ok = await forceDeleteInstance('SchedWhats-393331234567');
    expect(ok).toBe(true);
    expect(deletedAfterRestart).toBe(true);
    const urls = fetchMock.calls.map(c => c.url);
    const restartIdx = urls.findIndex(u => u.includes('/instance/restart/'));
    const lastDeleteIdx = urls.reduce((acc, u, i) => (u.includes('/instance/delete/') ? i : acc), -1);
    expect(restartIdx).toBeGreaterThan(-1);
    expect(lastDeleteIdx).toBeGreaterThan(restartIdx);
  });

  test('fail-closed: 401 JSON, 200 {ok:true} e 404 HTML del proxy NON valgono come "sparita"', async () => {
    // Solo il 404 JSON della guard Evolution prova l'assenza. Qualsiasi altra
    // risposta (apikey ruotata male, error page del reverse-proxy, shape
    // inattesa) deve tenere il teardown fail-closed: mai pairing alla cieca.
    fetchMock.setHandler('/instance/logout/', OK_EMPTY);
    fetchMock.setHandler('/instance/delete/', OK_EMPTY);
    fetchMock.setHandler('/instance/restart/', OK_EMPTY);

    fetchMock.setHandler('/instance/connectionState/', () => ({
      ok: false, status: 401,
      json: async () => ({ status: 401, error: 'Unauthorized', response: { message: ['Unauthorized'] } }),
      text: async () => '{}',
    }));
    expect(await forceDeleteInstance('SchedWhats-393331234567')).toBe(false);

    fetchMock.setHandler('/instance/connectionState/', () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    }));
    expect(await forceDeleteInstance('SchedWhats-393331234567')).toBe(false);

    fetchMock.setHandler('/instance/connectionState/', () => ({
      ok: false, status: 404,
      json: async () => { throw new Error('not json'); },
      text: async () => '<html>404 page not found</html>',
    }));
    expect(await forceDeleteInstance('SchedWhats-393331234567')).toBe(false);
  });
});

describe('POST /api/auth/init — niente codice morto', () => {
  test('teardown fallito → 503, sessione pending pulita, /instance/create MAI chiamata', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    fetchMock.setHandler('/instance/logout/', () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '{}' }));
    fetchMock.setHandler('/instance/delete/', () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{}' }));
    fetchMock.setHandler('/instance/restart/', OK_EMPTY);
    fetchMock.setHandler('/instance/connectionState/', STATE('connecting'));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initRequest() as any);
    expect(res.status).toBe(503);
    expect(fetchMock.calls.some(c => c.url.includes('/instance/create'))).toBe(false);
    const sessionCleanup = mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'delete');
    expect(sessionCleanup).toBeTruthy();
  });

  test('create rigettata (403 name in use) → 500, sessione pulita, fallback /instance/connect MAI chiamato, niente pairing_started', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    fetchMock.setHandler('/instance/logout/', OK_EMPTY);
    fetchMock.setHandler('/instance/delete/', OK_EMPTY);
    fetchMock.setHandler('/instance/connectionState/', NOT_FOUND);
    fetchMock.setHandler('/instance/create', () => ({
      ok: false, status: 403,
      json: async () => ({ status: 403, error: 'Forbidden', response: { message: ['This name "SchedWhats-393331234567" is already in use.'] } }),
      text: async () => '{}',
    }));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initRequest() as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Errore creazione istanza Evolution API');
    expect(fetchMock.calls.some(c => c.url.includes('/instance/connect/'))).toBe(false);
    expect(mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'delete')).toBeTruthy();
    expect(mockSupa.calls.find(c => c.table === 'audit_events' && c.operation === 'insert')).toBeFalsy();
  });

  test('happy path: teardown verificato ok → 200 con pairingCode', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    fetchMock.setHandler('/instance/logout/', NOT_FOUND);
    fetchMock.setHandler('/instance/delete/', NOT_FOUND);
    fetchMock.setHandler('/instance/connectionState/', NOT_FOUND);
    fetchMock.setHandler('/instance/create', CREATE_OK);
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initRequest() as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pairingCode).toBe('ABCD-1234');
    expect(body.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('setWebhook: UNA sola POST, body nested v2 (root webhook, byEvents/base64), senza MESSAGING_HISTORY_SET', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    fetchMock.setHandler('/instance/logout/', NOT_FOUND);
    fetchMock.setHandler('/instance/delete/', NOT_FOUND);
    fetchMock.setHandler('/instance/connectionState/', NOT_FOUND);
    fetchMock.setHandler('/instance/create', CREATE_OK);
    fetchMock.setHandler('/webhook/set/', OK_EMPTY);
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    await POST(initRequest() as any);
    const setCalls = fetchMock.calls.filter(c => c.url.includes('/webhook/set/'));
    expect(setCalls.length).toBe(1);
    const parsed = JSON.parse(setCalls[0].options.body as string);
    // Schema v2.3.7: required root `webhook`, chiavi byEvents/base64 (NON webhook_by_events)
    expect(Object.keys(parsed)).toEqual(['webhook']);
    expect(parsed.webhook.enabled).toBe(true);
    expect(parsed.webhook.url).toBe('https://whatslaterpush.vercel.app/api/webhook');
    expect(parsed.webhook.byEvents).toBe(false);
    expect(parsed.webhook.base64).toBe(false);
    expect(parsed.webhook.headers).toEqual({ 'x-webhook-secret': 'whsec-test' });
    // toEqual ESATTO, non arrayContaining: un solo evento extra fuori enum
    // farebbe 400-are l'intera config in prod — il superset è la regressione.
    expect(parsed.webhook.events).toEqual(['MESSAGES_UPSERT', 'CONTACTS_SET', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']);
  });

  test('payload /instance/create: blocco webhook con chiavi v2 e senza MESSAGING_HISTORY_SET', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    fetchMock.setHandler('/instance/logout/', NOT_FOUND);
    fetchMock.setHandler('/instance/delete/', NOT_FOUND);
    fetchMock.setHandler('/instance/connectionState/', NOT_FOUND);
    fetchMock.setHandler('/instance/create', CREATE_OK);
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    await POST(initRequest() as any);
    const createCall = fetchMock.calls.find(c => c.url.includes('/instance/create'));
    expect(createCall).toBeTruthy();
    const parsed = JSON.parse(createCall!.options.body as string);
    expect(parsed.webhook).toBeTruthy();
    expect(parsed.webhook.byEvents).toBe(false);
    expect(parsed.webhook.base64).toBe(false);
    expect(parsed.webhook.webhook_by_events).toBeUndefined();
    // toEqual ESATTO (vedi test setWebhook): il superset È la regressione.
    expect(parsed.webhook.events).toEqual(['MESSAGES_UPSERT', 'CONTACTS_SET', 'CONTACTS_UPSERT', 'CONTACTS_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']);
  });

  // Il guard #8 scatta su QUALSIASI row user_instances esistente e il cookie
  // arriva solo a CONNECTION_UPDATE open: se un init fallito lascia la row
  // trial appena upsertata, il retry di un numero vergine prende 409 per
  // sempre (lockout, recovery solo operatore). I rami d'errore devono quindi
  // rimuovere la row creata da QUESTA richiesta — e mai quella di un account
  // pre-esistente.
  const trialRowCleanups = () => mockSupa.calls.filter(c =>
    c.table === 'user_instances' && c.operation === 'delete' &&
    c.chain.some(m => m.method === 'eq' && m.args[0] === 'phone_number') &&
    !c.chain.some(m => m.method === 'neq'));

  test('numero vergine + teardown fallito → la row trial appena creata viene rimossa (niente 409 al retry)', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', null); // vergine
    fetchMock.setHandler('/instance/logout/', () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '{}' }));
    fetchMock.setHandler('/instance/delete/', () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '{}' }));
    fetchMock.setHandler('/instance/restart/', OK_EMPTY);
    fetchMock.setHandler('/instance/connectionState/', STATE('connecting'));
    (global as any).fetch = fetchMock.mockFetch;
    const { POST } = await import('../app/api/auth/init/route');
    const res = await POST(initRequest() as any);
    expect(res.status).toBe(503);
    expect(trialRowCleanups().length).toBe(1);
  });

  test('account pre-esistente (owner con cookie) + create fallita → la SUA row NON viene toccata', async () => {
    jest.resetModules();
    jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
    mockSupa.setResponse('user_instances:select', { phone_number: '393331234567', connection_status: 'close' });
    fetchMock.setHandler('/instance/logout/', NOT_FOUND);
    fetchMock.setHandler('/instance/delete/', NOT_FOUND);
    fetchMock.setHandler('/instance/connectionState/', NOT_FOUND);
    fetchMock.setHandler('/instance/create', () => ({
      ok: false, status: 403,
      json: async () => ({ status: 403, error: 'Forbidden', response: { message: ['already in use'] } }),
      text: async () => '{}',
    }));
    (global as any).fetch = fetchMock.mockFetch;
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const { POST } = await import('../app/api/auth/init/route');
    const req = new Request('http://localhost/api/auth/init', { method: 'POST', body: JSON.stringify({ phone: '393331234567' }) });
    const cm = new Map([['sw_session', cookie]]);
    (req as any).cookies = { get: (n: string) => cm.has(n) ? { value: cm.get(n) } : undefined };
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    expect(trialRowCleanups().length).toBe(0);
    // la pending session invece va sempre pulita
    expect(mockSupa.calls.find(c => c.table === 'pending_auth_sessions' && c.operation === 'delete')).toBeTruthy();
    // reset per i test successivi (mock condiviso a livello di file)
    mockSupa.setResponse('user_instances:select', null);
  });
});
