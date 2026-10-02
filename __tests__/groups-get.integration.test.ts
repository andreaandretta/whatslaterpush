/**
 * Integration tests for GET /api/groups (lista gruppi per il picker, D3/D6).
 * Supabase è il mock condiviso; Evolution risponde dal mock globale di fetch.
 * Numeri e JID finti.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const realFetch = global.fetch;
const USER_PHONE = '393331234567';
const OTHER = '393339876543';
const MEMBER = '393330000001';
const INSTANCE = 'SchedWhats-' + USER_PHONE;
const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const LIST_PATH = '/group/fetchAllGroups/' + INSTANCE + '?getParticipants=true';

const RAW = [
  {
    id: G1, subject: 'Under 12 – Genitori', size: 3, announce: false, pictureUrl: 'https://pps.example/p.jpg', owner: OTHER + '@s.whatsapp.net',
    participants: [{ id: USER_PHONE + '@s.whatsapp.net', admin: null }, { id: OTHER + '@s.whatsapp.net', admin: 'admin' }, { id: MEMBER + '@s.whatsapp.net', admin: null }],
  },
  {
    id: G2, subject: 'Avvisi squadra', announce: true,
    participants: [{ id: USER_PHONE + '@s.whatsapp.net', admin: null }, { id: OTHER + '@s.whatsapp.net', admin: 'superadmin' }],
  },
  { id: '120363000000000099@g.us', subject: 'Polisportiva', isCommunity: true, participants: [] },
];

function jsonRes(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function timeoutError() {
  return Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
}

let minuteCount: number;
let slowUntil: number | null;

beforeEach(() => {
  mockSupa.calls.length = 0;
  minuteCount = 1;
  slowUntil = null;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
    EVOLUTION_API_URL: 'http://evo.test',
    EVOLUTION_API_KEY: 'test-evo-key',
    GROUPS_ENABLED: 'true',
  };
  delete process.env.GROUPS_ONLY_FOR;
  mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE, connection_status: 'open' });
  mockSupa.setHandler('rate_limit_state:select', () => ({
    data: slowUntil == null ? null : { minute_reset: slowUntil }, error: null,
  }));
  mockSupa.setRpcHandler('rate_limit_record', () => ({ data: { minute_count: minuteCount }, error: null }));
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

// Un solo import per test: la cache e le chiamate in volo di app/lib/groups.ts
// restano tra una GET e l'altra dello stesso test, come nella stessa lambda.
async function loadRoute() {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  return import('../app/api/groups/route');
}

async function makeReq(opts: { authed?: boolean; refresh?: boolean } = {}) {
  const cookies: Record<string, string> = {};
  if (opts.authed !== false) cookies[AUTH_COOKIE_NAME] = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
  const req: any = mockRequest({}, {});
  req.url = 'https://whatslaterpush.vercel.app/api/groups' + (opts.refresh ? '?refresh=1' : '');
  req.cookies = { get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined) };
  return req;
}

function listFetches(f: jest.Mock) {
  return f.mock.calls.filter((c) => String(c[0]).includes('/group/fetchAllGroups/'));
}
function rpcKeys() {
  return mockSupa.calls.filter((c) => c.table === '__rpc__' && c.operation === 'rate_limit_record').map((c) => c.args[0].p_key as string);
}

describe('GET /api/groups', () => {
  test('401 senza cookie', async () => {
    const { GET } = await loadRoute();
    const res = await GET(await makeReq({ authed: false }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  test('spento (senza GROUPS_ENABLED) → enabled:false, senza Evolution né DB', async () => {
    delete process.env.GROUPS_ENABLED;
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false, connected: false, groups: [] });
    expect(f).not.toHaveBeenCalled();
    expect(mockSupa.calls).toHaveLength(0);
  });

  test('GROUPS_ONLY_FOR con un altro numero → enabled:false, senza fetch', async () => {
    process.env.GROUPS_ONLY_FOR = OTHER;
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const body = await (await GET(await makeReq())).json();
    expect(body.enabled).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  test('404 senza instance_name', async () => {
    mockSupa.setResponse('user_instances:select', null);
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('User not found');
    expect(f).not.toHaveBeenCalled();
  });

  test.each(['close', null])('scollegato (%s) → connected:false, senza fetch né gettone', async (status) => {
    mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE, connection_status: status });
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, connected: false, groups: [] });
    expect(f).not.toHaveBeenCalled();
    expect(rpcKeys()).toEqual([]);
  });

  test('live: una sola fetchAllGroups?getParticipants=true, lista mappata, header', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(RAW));
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(listFetches(f)).toHaveLength(1);
    expect(String(f.mock.calls[0][0])).toBe('http://evo.test' + LIST_PATH);
    expect(body).toMatchObject({ enabled: true, connected: true, source: 'live' });
    expect(body.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.groups).toEqual([
      { jid: G1, name: 'Under 12 – Genitori', size: 3, can_send: true },
      { jid: G2, name: 'Avvisi squadra', size: 2, can_send: false, locked_reason: 'solo_admin' },
    ]);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-groups-source')).toBe('live');
    expect(res.headers.get('server-timing')).toMatch(/total;dur=[\d.]+/);
    expect(rpcKeys()).toHaveLength(1);
    expect(rpcKeys()[0]).toMatch(/^grp:list:[0-9a-f]{16}$/);
  });

  test('connecting conta come collegato', async () => {
    mockSupa.setResponse('user_instances:select', { instance_name: INSTANCE, connection_status: 'connecting' });
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    const { GET } = await loadRoute();
    const body = await (await GET(await makeReq())).json();
    expect(body).toMatchObject({ connected: true, source: 'live' });
  });

  test('la risposta non contiene mai partecipanti, foto, owner né le loro cifre', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    const { GET } = await loadRoute();
    const text = JSON.stringify(await (await GET(await makeReq())).json());
    for (const digits of [USER_PHONE, OTHER, MEMBER]) expect(text).not.toContain(digits);
    expect(text).not.toMatch(/participants|pictureUrl|owner|pps\.example/);
  });

  test('seconda chiamata entro 30 min → source:cache, nessuna fetch né gettone', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(RAW));
    global.fetch = f as any;
    const { GET } = await loadRoute();
    await GET(await makeReq());
    const res = await GET(await makeReq());
    const body = await res.json();
    expect(body.source).toBe('cache');
    expect(body.groups).toHaveLength(2);
    expect(res.headers.get('x-groups-source')).toBe('cache');
    expect(listFetches(f)).toHaveLength(1);
    expect(rpcKeys()).toHaveLength(1);
  });

  test('?refresh=1 con cache fresca → fetch live e gettone consumato', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(RAW));
    global.fetch = f as any;
    const { GET } = await loadRoute();
    await GET(await makeReq());
    const body = await (await GET(await makeReq({ refresh: true }))).json();
    expect(body.source).toBe('live');
    expect(listFetches(f)).toHaveLength(2);
    expect(rpcKeys()).toHaveLength(2);
  });

  test('?refresh=1 con gettone negato → nessuna fetch, throttled:true e la cache', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(RAW));
    global.fetch = f as any;
    const { GET } = await loadRoute();
    await GET(await makeReq());
    minuteCount = 2;
    const res = await GET(await makeReq({ refresh: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(listFetches(f)).toHaveLength(1);
    expect(body).toMatchObject({ throttled: true, source: 'cache', connected: true });
    expect(body.groups).toHaveLength(2);
  });

  test('gettone negato senza cache → 200 throttled:true e nessun gruppo', async () => {
    minuteCount = 2;
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: true, connected: true, groups: [], source: 'none', throttled: true, fetched_at: null });
    expect(f).not.toHaveBeenCalled();
  });

  // Rapporto 360, T31: il picker dice tra quanto riprovare. Il dato viene dalla
  // riga che la RPC del gettone già restituisce (minute_reset): nessuna query in più.
  test('gettone negato → retry_in_s dai minuti che mancano alla fine della finestra', async () => {
    const resetAt = Date.now() + 12 * 60_000;
    mockSupa.setRpcHandler('rate_limit_record', () => ({ data: { minute_count: 2, minute_reset: resetAt }, error: null }));
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const body = await (await GET(await makeReq())).json();
    expect(body.throttled).toBe(true);
    expect(body.retry_in_s).toBeGreaterThan(11 * 60);
    expect(body.retry_in_s).toBeLessThanOrEqual(12 * 60);
    expect(f).not.toHaveBeenCalled();
    // Una sola RPC del gettone, nessuna lettura in più di rate_limit_state oltre al controllo "lento".
    expect(rpcKeys().filter((k) => k.startsWith('grp:list:'))).toHaveLength(1);
  });

  test('gettone concesso → nessun retry_in_s', async () => {
    mockSupa.setRpcHandler('rate_limit_record', () => ({ data: { minute_count: 1, minute_reset: Date.now() + 30 * 60_000 }, error: null }));
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    const { GET } = await loadRoute();
    const body = await (await GET(await makeReq())).json();
    expect(body.source).toBe('live');
    expect(body.retry_in_s).toBeUndefined();
    expect(body.throttled).toBeUndefined();
  });

  test('due GET concorrenti → una sola fetch e un solo gettone', async () => {
    let release: (v: any) => void = () => {};
    const f = jest.fn(() => new Promise((res) => { release = res; }));
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const [reqA, reqB] = [await makeReq(), await makeReq()];
    const a = GET(reqA);
    const b = GET(reqB);
    // Si rilascia la fetch solo quando è partita e ENTRAMBE le GET hanno letto
    // user_instances (la verifica del cookie è crypto vera: con la suite intera
    // 5 giri fissi non bastavano e il rilascio andava a vuoto).
    const instanceReads = () => mockSupa.calls.filter((c) => c.table === 'user_instances').length;
    const deadline = Date.now() + 3000;
    while ((f.mock.calls.length === 0 || instanceReads() < 2) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1));
    }
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    release(jsonRes(RAW));
    const [ra, rb] = await Promise.all([a, b]);
    expect(listFetches(f as any)).toHaveLength(1);
    expect(rpcKeys()).toHaveLength(1);
    expect((await ra.json()).groups).toEqual((await rb.json()).groups);
  });

  test('Evolution in errore con cache vecchia → 200 source:stale e X-Groups-Stale', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask', 'performance'] });
    try {
      const f = jest.fn().mockResolvedValueOnce(jsonRes(RAW)).mockResolvedValue(jsonRes({ error: 'boom' }, 500));
      global.fetch = f as any;
      const { GET } = await loadRoute();
      await GET(await makeReq());
      jest.setSystemTime(new Date('2026-10-01T10:31:00Z'));
      const res = await GET(await makeReq());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.source).toBe('stale');
      expect(body.groups).toHaveLength(2);
      expect(res.headers.get('x-groups-stale')).toBe('1');
      expect(listFetches(f)).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('Evolution in errore senza cache → 502 groups_unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes({ error: 'boom' }, 500)) as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('groups_unavailable');
    expect(body.message).toBe('Non riesco a leggere i gruppi adesso: riprova tra poco.');
    expect(rpcKeys().some((k) => k.startsWith('grp:slow:'))).toBe(false);
  });

  test('Evolution in timeout senza cache → 504 groups_timeout e "lento" su grp:slow:', async () => {
    global.fetch = jest.fn().mockRejectedValue(timeoutError()) as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe('groups_timeout');
    expect(body.message).toBe('I gruppi ci mettono troppo a rispondere: riprova tra poco.');
    const slow = mockSupa.calls.find((c) => c.table === '__rpc__' && String(c.args[0].p_key).startsWith('grp:slow:'));
    expect(slow).toBeDefined();
    expect(slow!.args[0].p_key).not.toContain(USER_PHONE);
    // Finestra di 6 h.
    expect(slow!.args[0].p_minute_reset - slow!.args[0].p_now).toBe(6 * 3_600_000);
  });

  test('"lento" attivo → nessuna fetch né gettone, 200 slow:true', async () => {
    slowUntil = Date.now() + 3_600_000;
    const f = jest.fn();
    global.fetch = f as any;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, slow: true, groups: [], source: 'none' });
    expect(f).not.toHaveBeenCalled();
    expect(rpcKeys()).toEqual([]);
  });

  test('i log non contengono JID di gruppo né numeri', async () => {
    const lines: string[] = [];
    (console.log as jest.Mock).mockImplementation((...a: any[]) => { lines.push(a.join(' ')); });
    (console.warn as jest.Mock).mockImplementation((...a: any[]) => { lines.push(a.join(' ')); });
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    const { GET } = await loadRoute();
    await GET(await makeReq());
    const all = lines.join('\n');
    expect(all).not.toMatch(/@g\.us|120363/);
    expect(all).not.toContain(USER_PHONE);
  });
});
