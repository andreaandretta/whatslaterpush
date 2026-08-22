/**
 * GET /api/cron/calendar-sync — il cron che riconcilia i calendari Google
 * collegati dentro scheduled_messages.
 *
 * Copre: auth cron (Bearer + ?secret=, pattern #4), gating del flag, happy
 * path insert/update/cancel (con enrichment user_instance_id/retry), 23505
 * benigno su insert concorrente, invalid_grant → reauth_required + disable
 * SENZA delete, e una connessione rotta che non blocca le altre.
 */
import { createMockSupabase } from './helpers/mocks';

let mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

jest.mock('next/server', () => {
  const { NextRequest } = jest.requireActual('next/server');
  return {
    NextRequest,
    NextResponse: {
      json: (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { 'content-type': 'application/json' },
        }),
    },
  };
});

jest.mock('../app/lib/google-calendar', () => {
  class GoogleApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'GoogleApiError';
      this.status = status;
    }
  }
  return {
    GoogleApiError,
    exchangeAuthCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    listUpcomingEvents: jest.fn(),
  };
});

jest.mock('../app/lib/heartbeat', () => ({
  stampHeartbeat: jest.fn(async () => {}),
}));

import { GoogleApiError, refreshAccessToken, listUpcomingEvents } from '../app/lib/google-calendar';
import { stampHeartbeat } from '../app/lib/heartbeat';
import { encryptToken } from '../app/lib/calendar-crypto';

const PHONE = '393331112222';
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  mockSupa = createMockSupabase();
  process.env = {
    ...ORIGINAL_ENV,
    CALENDAR_SYNC_ENABLED: 'true',
    CALENDAR_TOKEN_SECRET: 'ab'.repeat(32), // 64 hex chars
    CRON_SECRET: 'test-cron',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReq(opts: { bearer?: string; query?: string } = {}) {
  const url = 'https://whatslaterpush.vercel.app/api/cron/calendar-sync' + (opts.query ?? '');
  const headers: Record<string, string> = {};
  if (opts.bearer) headers['authorization'] = 'Bearer ' + opts.bearer;
  return { url, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as any;
}

function days(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function makeConn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    user_phone: PHONE,
    google_refresh_token_enc: encryptToken('g-refresh-1'),
    calendar_id: 'primary',
    reminder_offset_minutes: 60,
    message_template: null,
    enabled: true,
    last_synced_at: null,
    ...overrides,
  };
}

async function runCron() {
  const { GET } = await import('../app/api/cron/calendar-sync/route');
  return GET(makeReq({ bearer: 'test-cron' }));
}

describe('auth cron (pattern #4: Bearer + ?secret=)', () => {
  test('secret sbagliato → 401', async () => {
    const { GET } = await import('../app/api/cron/calendar-sync/route');
    const res = await GET(makeReq({ bearer: 'wrong' }));
    expect(res.status).toBe(401);
  });

  test('nessun secret → 401', async () => {
    const { GET } = await import('../app/api/cron/calendar-sync/route');
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  test('accetta Authorization: Bearer <CRON_SECRET>', async () => {
    mockSupa.setResponse('calendar_connections:select', []);
    const { GET } = await import('../app/api/cron/calendar-sync/route');
    const res = await GET(makeReq({ bearer: 'test-cron' }));
    expect(res.status).not.toBe(401);
  });

  test('accetta ancora la legacy ?secret=', async () => {
    mockSupa.setResponse('calendar_connections:select', []);
    const { GET } = await import('../app/api/cron/calendar-sync/route');
    const res = await GET(makeReq({ query: '?secret=test-cron' }));
    expect(res.status).not.toBe(401);
  });
});

describe('gating del flag', () => {
  test('flag off → {enabled:false}, zero lavoro e zero heartbeat', async () => {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const res = await runCron();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
    expect(mockSupa.calls.length).toBe(0);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(stampHeartbeat).not.toHaveBeenCalled();
  });
});

describe('sync — happy path', () => {
  test('insert nuovo evento + update evento cambiato + cancel evento sparito', async () => {
    const conn = makeConn();
    (refreshAccessToken as jest.Mock).mockResolvedValue('access-token-1');
    (listUpcomingEvents as jest.Mock).mockResolvedValue([
      // Nuovo: telefono nel summary → insert
      { id: 'evt-new', summary: 'Mario Rossi 3401234567', start: { dateTime: days(3).toISOString() } , creator: { self: true } },
      // Esistente con testo/orario diversi → update
      { id: 'evt-upd', summary: 'Luigi 3402222222', start: { dateTime: days(5).toISOString() } , creator: { self: true } },
    ]);
    mockSupa.setResponse('calendar_connections:select', [conn]);
    mockSupa.setResponse('user_instances:select', [{ id: 'ui-1' }]);
    mockSupa.setResponse('scheduled_messages:select', [
      { id: 'row-upd', status: 'pending', scheduled_at: days(4).toISOString(), parsed_message: 'old text', calendar_event_key: 'conn-1:evt-upd' },
      // Riga il cui evento è sparito dalla finestra → cancel
      { id: 'row-gone', status: 'pending', scheduled_at: days(2).toISOString(), parsed_message: 'x', calendar_event_key: 'conn-1:evt-gone' },
    ]);

    const res = await runCron();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.connections).toBe(1);
    expect(body.results[0]).toMatchObject({
      connection_id: 'conn-1',
      status: 'ok',
      events: 2,
      inserted: 1,
      updated: 1,
      cancelled: 1,
      skipped_conflicts: 0,
      cap_hit: false,
    });

    // Token: decrypt round-trip → refresh col token in chiaro, listing col Bearer fresco.
    expect(refreshAccessToken).toHaveBeenCalledWith('g-refresh-1');
    expect(listUpcomingEvents).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token-1', calendarId: 'primary' })
    );

    // INSERT arricchito come le righe della dashboard (user_instance_id + retry).
    const ins = mockSupa.calls.find(
      (c) => c.table === 'scheduled_messages' && c.operation === 'insert'
    );
    expect(ins).toBeTruthy();
    expect(ins!.args[0]).toMatchObject({
      user_instance_id: 'ui-1',
      retry_count: 0,
      max_retries: 3,
      instance_phone: PHONE,
      recipient_number: '393401234567',
      recipient_name: 'Mario Rossi',
      status: 'pending',
      calendar_event_key: 'conn-1:evt-new',
    });
    // {nome} resta irrisolto: lo risolve il cron di invio da recipient_name.
    expect(ins!.args[0].parsed_message).toContain('{nome}');
    expect(ins!.args[0].caption).toBe(ins!.args[0].parsed_message);

    // UPDATE della riga esistente, ri-guardato su pending/paused a write time.
    const upd = mockSupa.calls.find(
      (c) =>
        c.table === 'scheduled_messages' &&
        c.operation === 'update' &&
        c.chain.some((s) => s.method === 'eq' && s.args[0] === 'id' && s.args[1] === 'row-upd')
    );
    expect(upd).toBeTruthy();
    expect(upd!.args[0].parsed_message).toBeTruthy();
    expect(upd!.chain).toContainEqual({ method: 'in', args: ['status', ['pending', 'paused']] });

    // CANCEL della riga orfana: status cancelled + error_message dedicato.
    const cancel = mockSupa.calls.find(
      (c) =>
        c.table === 'scheduled_messages' &&
        c.operation === 'update' &&
        c.args[0]?.status === 'cancelled'
    );
    expect(cancel).toBeTruthy();
    expect(cancel!.args[0]).toEqual({ status: 'cancelled', error_message: 'calendar_event_removed' });
    expect(cancel!.chain).toContainEqual({ method: 'in', args: ['id', ['row-gone']] });
    expect(cancel!.chain).toContainEqual({ method: 'eq', args: ['status', 'pending'] });

    // Bookkeeping: last_synced_at stampato, last_sync_error azzerato.
    const book = mockSupa.calls.find(
      (c) =>
        c.table === 'calendar_connections' &&
        c.operation === 'update' &&
        c.args[0]?.last_sync_error === null
    );
    expect(book).toBeTruthy();
    expect(book!.args[0].last_synced_at).toBeTruthy();
    expect(book!.chain).toContainEqual({ method: 'eq', args: ['id', 'conn-1'] });

    expect(stampHeartbeat).toHaveBeenCalledWith('calendar-sync');
  });

  test('23505 su insert (run concorrente ha vinto la unique) → benigno, non errore', async () => {
    (refreshAccessToken as jest.Mock).mockResolvedValue('access-token-1');
    (listUpcomingEvents as jest.Mock).mockResolvedValue([
      { id: 'evt-new', summary: 'Mario Rossi 3401234567', start: { dateTime: days(3).toISOString() } , creator: { self: true } },
    ]);
    mockSupa.setResponse('calendar_connections:select', [makeConn()]);
    mockSupa.setResponse('user_instances:select', [{ id: 'ui-1' }]);
    mockSupa.setResponse('scheduled_messages:select', []);
    mockSupa.setResponse('scheduled_messages:insert', null, { code: '23505', message: 'duplicate key' });

    const res = await runCron();
    const body = await res.json();
    expect(body.results[0]).toMatchObject({ status: 'ok', inserted: 0, skipped_conflicts: 1 });
  });

  test('errore insert NON-23505 → connessione in error, last_sync_error valorizzato', async () => {
    (refreshAccessToken as jest.Mock).mockResolvedValue('access-token-1');
    (listUpcomingEvents as jest.Mock).mockResolvedValue([
      { id: 'evt-new', summary: 'Mario Rossi 3401234567', start: { dateTime: days(3).toISOString() } , creator: { self: true } },
    ]);
    mockSupa.setResponse('calendar_connections:select', [makeConn()]);
    mockSupa.setResponse('user_instances:select', [{ id: 'ui-1' }]);
    mockSupa.setResponse('scheduled_messages:select', []);
    mockSupa.setResponse('scheduled_messages:insert', null, { code: '42P01', message: 'db down' });

    const res = await runCron();
    const body = await res.json();
    expect(body.results[0].status).toBe('error');
    expect(body.results[0].error).toContain('insert failed');

    const book = mockSupa.calls.find(
      (c) =>
        c.table === 'calendar_connections' &&
        c.operation === 'update' &&
        typeof c.args[0]?.last_sync_error === 'string'
    );
    expect(book!.args[0].last_sync_error).toContain('insert failed');
    expect(book!.args[0].last_synced_at).toBeTruthy();
  });
});

describe('sync — revoca e resilienza', () => {
  test('invalid_grant (400) al refresh → reauth_required + disable, MAI delete', async () => {
    (refreshAccessToken as jest.Mock).mockRejectedValue(
      new (GoogleApiError as any)('invalid_grant', 400)
    );
    mockSupa.setResponse('calendar_connections:select', [makeConn()]);

    const res = await runCron();
    const body = await res.json();
    expect(body.results[0]).toEqual({ connection_id: 'conn-1', status: 'reauth_required' });

    const upd = mockSupa.calls.find(
      (c) => c.table === 'calendar_connections' && c.operation === 'update'
    );
    expect(upd!.args[0]).toEqual({ enabled: false, last_sync_error: 'reauth_required' });
    expect(upd!.chain).toContainEqual({ method: 'eq', args: ['id', 'conn-1'] });

    expect(
      mockSupa.calls.find((c) => c.table === 'calendar_connections' && c.operation === 'delete')
    ).toBeUndefined();
    expect(listUpcomingEvents).not.toHaveBeenCalled();
  });

  test('401 al refresh → stesso trattamento reauth_required', async () => {
    (refreshAccessToken as jest.Mock).mockRejectedValue(
      new (GoogleApiError as any)('unauthorized', 401)
    );
    mockSupa.setResponse('calendar_connections:select', [makeConn()]);
    const res = await runCron();
    expect((await res.json()).results[0].status).toBe('reauth_required');
  });

  test('5xx Google al refresh → error generico, la connessione RESTA enabled', async () => {
    (refreshAccessToken as jest.Mock).mockRejectedValue(
      new (GoogleApiError as any)('server error', 503)
    );
    mockSupa.setResponse('calendar_connections:select', [makeConn()]);
    const res = await runCron();
    const body = await res.json();
    expect(body.results[0].status).toBe('error');

    // Nessun update con enabled:false — un blip di Google non disattiva nulla.
    const disable = mockSupa.calls.find(
      (c) =>
        c.table === 'calendar_connections' &&
        c.operation === 'update' &&
        c.args[0]?.enabled === false
    );
    expect(disable).toBeUndefined();
  });

  test('una connessione rotta non blocca le altre', async () => {
    const conn1 = makeConn();
    const conn2 = makeConn({ id: 'conn-2', user_phone: '393334445555' });
    (refreshAccessToken as jest.Mock)
      .mockRejectedValueOnce(new Error('network boom'))
      .mockResolvedValueOnce('access-2');
    (listUpcomingEvents as jest.Mock).mockResolvedValue([]);
    mockSupa.setResponse('calendar_connections:select', [conn1, conn2]);
    mockSupa.setResponse('user_instances:select', [{ id: 'ui-2' }]);
    mockSupa.setResponse('scheduled_messages:select', []);

    const res = await runCron();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toBe(2);
    expect(body.results[0].status).toBe('error');
    expect(body.results[0].error).toContain('network boom');
    expect(body.results[1]).toMatchObject({ connection_id: 'conn-2', status: 'ok' });

    // La seconda è stata processata davvero (listing eseguito una volta sola).
    expect(listUpcomingEvents).toHaveBeenCalledTimes(1);

    // La prima ha comunque il timestamp stampato → ruota in fondo alla coda
    // oldest-first invece di affamare le altre ad ogni run.
    const errBook = mockSupa.calls.find(
      (c) =>
        c.table === 'calendar_connections' &&
        c.operation === 'update' &&
        c.chain.some((s) => s.method === 'eq' && s.args[1] === 'conn-1')
    );
    expect(errBook!.args[0].last_sync_error).toContain('network boom');
    expect(errBook!.args[0].last_synced_at).toBeTruthy();
  });

  test('user_instance mancante → error per quella connessione, niente insert', async () => {
    (refreshAccessToken as jest.Mock).mockResolvedValue('access-token-1');
    (listUpcomingEvents as jest.Mock).mockResolvedValue([
      { id: 'evt-new', summary: 'Mario Rossi 3401234567', start: { dateTime: days(3).toISOString() } , creator: { self: true } },
    ]);
    mockSupa.setResponse('calendar_connections:select', [makeConn()]);
    mockSupa.setResponse('user_instances:select', []);

    const res = await runCron();
    const body = await res.json();
    expect(body.results[0].status).toBe('error');
    expect(body.results[0].error).toBe('user_instance_not_found');
    expect(
      mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'insert')
    ).toBeUndefined();
  });
});
