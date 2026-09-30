/**
 * Integration tests for /api/feedback: porta finta "foto del calendario" (D14)
 * e segnale dashboard_seen (D15). Tutto su audit_events, Supabase è un mock.
 */
import { createMockSupabase, mockRequest, type MockSupabaseCall } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = process.env;
const USER_PHONE = '393331234567';
const INSTANCE = 'SchedWhats-' + USER_PHONE;

// audit_events finto: le righe inserite si rileggono con i filtri eq/gte della query.
let rows: Array<Record<string, any>>;
let insertError: { message: string } | null;
let selectThrows: boolean;

function eqArgs(call: MockSupabaseCall): Record<string, any> {
  const out: Record<string, any> = {};
  for (const m of call.chain) if (m.method === 'eq') out[m.args[0]] = m.args[1];
  return out;
}

beforeEach(() => {
  mockSupa.calls.length = 0;
  rows = [];
  insertError = null;
  selectThrows = false;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
    FAKE_DOOR_CALENDAR_UNTIL: '2099-12-31',
  };
  mockSupa.setHandler('audit_events:select', (call) => {
    if (selectThrows) throw new Error('db down');
    const eq = eqArgs(call);
    const gte = call.chain.find((m) => m.method === 'gte');
    const data = rows.filter((r) =>
      r.user_phone === eq.user_phone &&
      r.event_type === eq.event_type &&
      (eq['payload->>feature'] === undefined || r.payload?.feature === eq['payload->>feature']) &&
      (!gte || r.created_at >= gte.args[1]));
    return { data, error: null };
  });
  mockSupa.setHandler('audit_events:insert', (call) => {
    if (insertError) return { data: null, error: insertError };
    rows.push({ ...call.args[0], created_at: new Date().toISOString() });
    return { data: null, error: null };
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function loadRoute() {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  return import('../app/api/feedback/route');
}

async function makeReq(body: any = {}, authed = true) {
  const cookies: Record<string, string> = {};
  if (authed) cookies[AUTH_COOKIE_NAME] = await signCookie({ phone: USER_PHONE, instanceName: INSTANCE });
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.url = 'https://whatslaterpush.vercel.app/api/feedback';
  req.cookies = { get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined) };
  return req;
}

const inserts = (type?: string) =>
  mockSupa.calls.filter((c) => c.table === 'audit_events' && c.operation === 'insert' && (!type || c.args[0].event_type === type));

describe('POST /api/feedback', () => {
  test.each(['lt10', '10_30', 'gt30', 'no'])('risposta valida %s → insert con payload e ip_address null', async (answer) => {
    const { POST } = await loadRoute();
    const res = await POST(await makeReq({ feature: 'calendar_photo', answer }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const ins = inserts('fake_door_answer');
    expect(ins).toHaveLength(1);
    expect(ins[0].args[0]).toEqual({
      user_phone: USER_PHONE,
      event_type: 'fake_door_answer',
      payload: { feature: 'calendar_photo', answer, v: 1 },
      ip_address: null,
    });
  });

  test('401 senza cookie', async () => {
    const { POST } = await loadRoute();
    const res = await POST(await makeReq({ feature: 'calendar_photo', answer: 'lt10' }, false));
    expect(res.status).toBe(401);
    expect(inserts()).toHaveLength(0);
  });

  test.each([
    [{ feature: 'calendar_photo', answer: 'forse' }],
    [{ feature: 'calendar_photo' }],
    [{ feature: 'altro', answer: 'lt10' }],
    [{}],
  ])('risposta fuori elenco %j → 400 invalid_answer, nessun insert', async (body) => {
    const { POST } = await loadRoute();
    const res = await POST(await makeReq(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_answer');
    expect(inserts()).toHaveLength(0);
  });

  test('già risposto → already:true senza un secondo insert', async () => {
    rows.push({ user_phone: USER_PHONE, event_type: 'fake_door_answer', payload: { feature: 'calendar_photo', answer: 'gt30', v: 1 }, created_at: '2026-09-01T10:00:00Z' });
    const { POST } = await loadRoute();
    const res = await POST(await makeReq({ feature: 'calendar_photo', answer: 'lt10' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, already: true });
    expect(inserts()).toHaveLength(0);
  });

  test('seconda risposta → una sola salvata', async () => {
    const { POST } = await loadRoute();
    await POST(await makeReq({ feature: 'calendar_photo', answer: 'lt10' }));
    const second = await (await POST(await makeReq({ feature: 'calendar_photo', answer: 'lt10' }))).json();
    expect(second.already).toBe(true);
    expect(inserts('fake_door_answer')).toHaveLength(1);
  });

  test('insert in errore → 500 save_failed', async () => {
    insertError = { message: 'insert failed' };
    const { POST } = await loadRoute();
    const res = await POST(await makeReq({ feature: 'calendar_photo', answer: 'no' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('save_failed');
    expect(body.message).toBe('Non sono riuscito a salvare la risposta: riprova.');
  });

  test.each([undefined, '2020-01-01', 'domani'])('porta chiusa (FAKE_DOOR_CALENDAR_UNTIL=%s) → 409 fake_door_closed', async (until) => {
    if (until === undefined) delete process.env.FAKE_DOOR_CALENDAR_UNTIL;
    else process.env.FAKE_DOOR_CALENDAR_UNTIL = until;
    const { POST } = await loadRoute();
    const res = await POST(await makeReq({ feature: 'calendar_photo', answer: 'lt10' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('fake_door_closed');
    expect(inserts()).toHaveLength(0);
  });
});

describe('GET /api/feedback', () => {
  test('401 senza cookie', async () => {
    const { GET } = await loadRoute();
    const res = await GET(await makeReq({}, false));
    expect(res.status).toBe(401);
    expect(inserts()).toHaveLength(0);
  });

  test('attiva e senza risposta → answered:false; dopo la risposta → answered:true', async () => {
    const { GET, POST } = await loadRoute();
    expect(await (await GET(await makeReq())).json()).toEqual({ calendar_photo: { active: true, answered: false } });
    await POST(await makeReq({ feature: 'calendar_photo', answer: '10_30' }));
    expect(await (await GET(await makeReq())).json()).toEqual({ calendar_photo: { active: true, answered: true } });
  });

  test('porta spenta → active:false', async () => {
    delete process.env.FAKE_DOOR_CALENDAR_UNTIL;
    const { GET } = await loadRoute();
    const body = await (await GET(await makeReq())).json();
    expect(body.calendar_photo.active).toBe(false);
  });

  test('dashboard_seen una sola volta nello stesso giorno di Roma, con ip_address null', async () => {
    // 22:30 UTC del 1 ottobre = 00:30 del 2 ottobre a Roma: il giorno di Roma parte alle 22:00 UTC.
    jest.useFakeTimers({ now: new Date('2026-10-01T22:30:00Z'), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask', 'performance'] });
    // Visto alle 23:30 di Roma del giorno prima: non conta.
    rows.push({ user_phone: USER_PHONE, event_type: 'dashboard_seen', payload: {}, created_at: '2026-10-01T21:30:00.000Z' });
    const { GET } = await loadRoute();
    await GET(await makeReq());
    await GET(await makeReq());
    const seen = inserts('dashboard_seen');
    expect(seen).toHaveLength(1);
    expect(seen[0].args[0]).toEqual({ user_phone: USER_PHONE, event_type: 'dashboard_seen', payload: {}, ip_address: null });
    const gte = mockSupa.calls
      .filter((c) => c.table === 'audit_events' && c.operation === 'select' && eqArgs(c).event_type === 'dashboard_seen')
      .map((c) => c.chain.find((m) => m.method === 'gte')!.args);
    expect(gte[0]).toEqual(['created_at', '2026-10-01T22:00:00.000Z']);
  });

  test('un errore di scrittura non fa fallire il GET', async () => {
    insertError = { message: 'insert failed' };
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ calendar_photo: { active: true, answered: false } });
  });

  test('un errore di lettura non fa fallire il GET', async () => {
    selectThrows = true;
    const { GET } = await loadRoute();
    const res = await GET(await makeReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ calendar_photo: { active: true, answered: false } });
    expect(inserts()).toHaveLength(0);
  });
});
