/**
 * GET /api/messages → today_limit, e il cron che lo applica (rapporto 360 B3/T7).
 *
 * Lo stesso numero collegato ieri: la GET dice "limite di oggi 5" e il cron,
 * con lo stesso contatore, si ferma a 5 (stessa funzione, app/lib/daily-limit.ts).
 * Orologio fermo: sabato 3 ottobre 2026, 12:00 a Roma. Numeri finti.
 */
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

const OWNER = '393501234567';
const NOW = '2026-10-03T10:00:00.000Z';
const PAIRED_YESTERDAY = '2026-10-02T09:00:00.000Z';

function has(call: any, method: string, col?: string, val?: any) {
  return call.chain.some((m: any) => m.method === method && (col === undefined || m.args[0] === col) && (val === undefined || m.args[1] === val));
}

// Fake SOLO l'orologio (Date): i setTimeout di jitter/timeout restano veri.
function freezeClock(iso: string) {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
  jest.setSystemTime(new Date(iso));
}

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: '0'.repeat(128),
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    CRON_SECRET: 'test-secret',
    BILLING_ENABLED: 'false', // beta: 50 al giorno a regime
    NEW_RECIPIENTS_DISABLED: 'true',
  };
  delete process.env.WARMUP_RAMP_DISABLED;
  (global as any).fetch = fetchMock.mockFetch;
  freezeClock(NOW);
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ── GET /api/messages ──

const ROWS = [
  { id: 'oggi-18', status: 'pending', scheduled_at: '2026-10-03T16:00:00.000Z', recipient_number: '393401111111' },
  { id: 'in-ritardo', status: 'pending', scheduled_at: '2026-10-03T08:00:00.000Z', recipient_number: '393402222222' },
  { id: 'domani', status: 'pending', scheduled_at: '2026-10-04T08:00:00.000Z', recipient_number: '393403333333' },
  { id: 'in-invio', status: 'processing', scheduled_at: '2026-10-03T10:00:00.000Z', recipient_number: '393404444444' },
  { id: 'partito', status: 'sent', scheduled_at: '2026-10-03T07:00:00.000Z', sent_at: '2026-10-03T07:00:05.000Z', recipient_number: '393405555555' },
];

type Quota = { data: any; error: any };

async function getMessages(quota: Quota, rows: any[] = ROWS) {
  jest.resetModules();
  jest.doMock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  mockSupa.setHandler('user_instances:select', (call: any) => {
    if (String(call.args[0]).includes('paired_at')) return quota;
    return { data: { id: 'u1', subscription_plan: 'trial', trial_ends_at: null, connection_status: 'open' }, error: null };
  });
  mockSupa.setHandler('scheduled_messages:select', () => ({ data: rows, error: null }));
  const cookie = await signCookie({ phone: OWNER, instanceName: 'SchedWhats-' + OWNER });
  const { GET } = await import('../app/api/messages/route');
  const req: any = new Request('http://localhost/api/messages');
  req.cookies = { get: (n: string) => (n === 'sw_session' ? { value: cookie } : undefined) };
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

describe('GET /api/messages restituisce il limite di OGGI', () => {
  test('collegato ieri: limite 5 (non 50), invii fatti, coda di oggi', async () => {
    const { status, body } = await getMessages({ data: { paired_at: PAIRED_YESTERDAY, messages_sent_today: 2, last_daily_reset_at: '2026-10-03' }, error: null });
    expect(status).toBe(200);
    expect(body.today_limit).toEqual({
      limit: 5, plan_limit: 50, sent: 2, queued: 2, later: 0, later_days: 0,
      warmup: true, paired_at: PAIRED_YESTERDAY, day: '2026-10-03',
    });
    // Letto dalla riga dell'utente collegato, non da un'altra.
    const q = mockSupa.calls.find((c) => c.table === 'user_instances' && String(c.args[0]).includes('paired_at'))!;
    expect(String(q.args[0])).toBe('paired_at, messages_sent_today, last_daily_reset_at');
    expect(has(q, 'eq', 'phone_number', OWNER)).toBe(true);
  });

  test('15 genitori il primo giorno: 5 oggi, gli altri 10 nei prossimi giorni', async () => {
    const rows = Array.from({ length: 15 }, (_, k) => ({ id: 'g' + k, status: 'pending', scheduled_at: '2026-10-03T16:00:00.000Z', recipient_number: '3934000000' + String(k).padStart(2, '0') }));
    const { body } = await getMessages({ data: { paired_at: PAIRED_YESTERDAY, messages_sent_today: 0, last_daily_reset_at: '2026-10-03' }, error: null }, rows);
    expect(body.today_limit).toMatchObject({ limit: 5, sent: 0, queued: 15, later: 10, later_days: 2 });
  });

  test('contatore di ieri non ancora azzerato → oggi 0 invii', async () => {
    const { body } = await getMessages({ data: { paired_at: PAIRED_YESTERDAY, messages_sent_today: 5, last_daily_reset_at: '2026-10-02' }, error: null });
    expect(body.today_limit.sent).toBe(0);
  });

  test('a regime (collegato da 10 giorni): il limite del piano, niente rampa', async () => {
    const { body } = await getMessages({ data: { paired_at: '2026-09-23T09:00:00.000Z', messages_sent_today: 1, last_daily_reset_at: '2026-10-03' }, error: null });
    expect(body.today_limit).toMatchObject({ limit: 50, plan_limit: 50, warmup: false });
  });

  test('WARMUP_RAMP_DISABLED=true → piano pieno e paired_at nascosto al browser', async () => {
    process.env.WARMUP_RAMP_DISABLED = 'true';
    const { body } = await getMessages({ data: { paired_at: PAIRED_YESTERDAY, messages_sent_today: 0, last_daily_reset_at: '2026-10-03' }, error: null });
    expect(body.today_limit).toMatchObject({ limit: 50, warmup: false, paired_at: null });
  });

  test('lettura del contatore in errore → today_limit null, la lista arriva lo stesso', async () => {
    const { status, body } = await getMessages({ data: null, error: { message: 'column does not exist' } });
    expect(status).toBe(200);
    expect(body.today_limit).toBeNull();
    expect(body.messages.map((m: any) => m.id)).toEqual(ROWS.map((r) => r.id));
  });
});

// ── Il cron applica lo stesso limite ──

let pendingRows: any[] = [];

function installCronDb() {
  mockSupa.setHandler('scheduled_messages:select', (call: any) => {
    if (String(call.args[0]).startsWith('*, user_instances')) return { data: pendingRows, error: null };
    return { data: [], error: null, count: 0 } as any;
  });
  mockSupa.setHandler('scheduled_messages:update', () => ({ data: [{ id: 'x' }], error: null }));
  mockSupa.setHandler('user_instances:update', () => ({ data: [{ id: 'ui' }], error: null }));
  mockSupa.setRpcResponse('claim_daily_quota', 1);
  mockSupa.setRpcResponse('rate_limit_record', {
    key: 'default', minute_count: 1, minute_reset: Date.now() + 60000, daily_count: 1,
    daily_reset: Date.now() + 86400000, blocked: false, block_reason: null,
  });
  fetchMock.setJsonResponse('/message/sendText/', { key: { id: 'evo-1' } });
}

function cronRow(sentToday: number) {
  return {
    id: 'msg-1',
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'pending', retry_count: 0, disconnect_retry_count: 0,
    recipient_number: '393401234567', recipient_name: 'Marco', parsed_message: 'Ciao',
    instance_phone: OWNER, wa_message_id: null,
    user_instances: {
      id: 'ui-1', phone_number: OWNER, instance_name: 'SchedWhats-' + OWNER,
      trial_ends_at: null, subscription_plan: 'trial', connection_status: 'open',
      messages_sent_today: sentToday, upsell_sent_today: false, paired_at: PAIRED_YESTERDAY,
    },
  };
}

async function runCron() {
  jest.resetModules();
  jest.doMock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { GET } = await import('../app/api/cron/send-messages/route');
  const req: any = { url: 'https://x/api/cron/send-messages?secret=test-secret', headers: { get: () => null } };
  const res = await GET(req);
  return res.json();
}

describe('il cron si ferma dove la GET dice', () => {
  beforeEach(() => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    installCronDb();
  });

  const limitUpdates = () => mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'update'
    && String(c.args[0]?.error_message || '').startsWith('Limite giornaliero raggiunto'));

  test('5 invii fatti, collegato ieri → domattina col motivo dei primi giorni (stesso 5 della GET)', async () => {
    pendingRows = [cronRow(5)];
    const body = await runCron();
    expect(body.sent).toBe(0);
    const upd = limitUpdates();
    expect(upd).toHaveLength(1);
    expect(upd[0].args[0].error_message).toBe('Limite giornaliero raggiunto (5/5) nei primi giorni dal collegamento — riprogrammato a domattina');
    expect(new Date(upd[0].args[0].scheduled_at).toISOString()).toBe('2026-10-04T06:00:00.000Z'); // domenica 08:00 a Roma (jitter 0)

    // La GET, con lo stesso contatore, dice la stessa cosa.
    const { body: get } = await getMessages({ data: { paired_at: PAIRED_YESTERDAY, messages_sent_today: 5, last_daily_reset_at: '2026-10-03' }, error: null }, []);
    expect(get.today_limit).toMatchObject({ limit: 5, sent: 5 });
  });

  test('4 invii fatti → parte, e la quota atomica usa lo stesso limite 5', async () => {
    pendingRows = [cronRow(4)];
    const body = await runCron();
    expect(body.sent).toBe(1);
    expect(limitUpdates()).toHaveLength(0);
    const claim = mockSupa.calls.find((c) => c.table === '__rpc__' && c.operation === 'claim_daily_quota')!;
    expect(claim.args[0]).toEqual({ p_phone: OWNER, p_limit: 5 });
  });

  test('WARMUP_RAMP_DISABLED=true → il cron usa il piano (50), come la GET', async () => {
    process.env.WARMUP_RAMP_DISABLED = 'true';
    pendingRows = [cronRow(5)];
    const body = await runCron();
    expect(body.sent).toBe(1);
    const claim = mockSupa.calls.find((c) => c.table === '__rpc__' && c.operation === 'claim_daily_quota')!;
    expect(claim.args[0].p_limit).toBe(50);
  });
});
