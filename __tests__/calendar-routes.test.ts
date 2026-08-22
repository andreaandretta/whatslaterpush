/**
 * Google Calendar sync — user-facing routes:
 *   GET  /api/calendar/auth      → 302 verso il consent screen Google
 *   GET  /api/calendar/callback  → scambio code, upsert connessione, redirect
 *   GET/PATCH/DELETE /api/calendar → stato + settings + disconnect
 *
 * Copre: gating del flag CALENDAR_SYNC_ENABLED, auth cookie, state HMAC
 * (tamper + TTL 10min), upsert con token cifrato (round-trip verificato),
 * bounds di validazione PATCH, cascade-cancel su DELETE.
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
      redirect: (url: string | URL, status?: number) =>
        new Response(null, { status: status ?? 307, headers: { location: String(url) } }),
    },
  };
});

jest.mock('../app/lib/auth-cookie', () => ({
  AUTH_COOKIE_NAME: 'sw_session',
  verifyCookie: jest.fn(async (raw?: string) => {
    if (raw === 'valid') return { phone: '393331112222', instanceName: 'SchedWhats-393331112222' };
    return null;
  }),
}));

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

import { exchangeAuthCode } from '../app/lib/google-calendar';
import { signOAuthState, verifyOAuthState } from '../app/lib/calendar-oauth-state';
import { decryptToken } from '../app/lib/calendar-crypto';

const ORIGIN = 'https://whatslaterpush.vercel.app';
const PHONE = '393331112222';
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  mockSupa = createMockSupabase();
  process.env = {
    ...ORIGINAL_ENV,
    CALENDAR_SYNC_ENABLED: 'true',
    AUTH_COOKIE_SECRET: '0'.repeat(64),
    CALENDAR_TOKEN_SECRET: 'ab'.repeat(32), // 64 hex chars
    GOOGLE_CALENDAR_CLIENT_ID: 'test-client-id',
    GOOGLE_CALENDAR_CLIENT_SECRET: 'test-client-secret',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
  };
  delete process.env.NEXT_PUBLIC_APP_URL; // origin derivato dalla request salvo test dedicato
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

function makeReq(url: string, opts: { cookie?: string; body?: unknown } = {}) {
  return {
    url,
    cookies: {
      get: (n: string) =>
        opts.cookie && n === 'sw_session' ? { value: opts.cookie } : undefined,
    },
    headers: { get: () => null },
    json: async () => opts.body,
  } as any;
}

// ── GET /api/calendar/auth ──

describe('GET /api/calendar/auth', () => {
  const path = `${ORIGIN}/api/calendar/auth`;

  test('flag off → 404 calendar_sync_disabled', async () => {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const { GET } = await import('../app/api/calendar/auth/route');
    const res = await GET(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('calendar_sync_disabled');
  });

  test('senza cookie → 401', async () => {
    const { GET } = await import('../app/api/calendar/auth/route');
    const res = await GET(makeReq(path));
    expect(res.status).toBe(401);
  });

  test('client id mancante con flag on → 500 misconfigured (fail loud, no redirect)', async () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID;
    const { GET } = await import('../app/api/calendar/auth/route');
    const res = await GET(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('calendar_sync_misconfigured');
  });

  test('autenticato → 302 al consent Google con offline+consent e state firmato', async () => {
    const { GET } = await import('../app/api/calendar/auth/route');
    const res = await GET(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(302);

    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin).toBe('https://accounts.google.com');
    expect(loc.pathname).toBe('/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('test-client-id');
    expect(loc.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/calendar/callback`);
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly');
    expect(loc.searchParams.get('access_type')).toBe('offline');
    expect(loc.searchParams.get('prompt')).toBe('consent');

    // Lo state deve essere verificabile e legato al phone della sessione.
    const state = loc.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(await verifyOAuthState(state)).toBe(true);
  });

  test('NEXT_PUBLIC_APP_URL vince sulla origin della request', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/';
    const { GET } = await import('../app/api/calendar/auth/route');
    const res = await GET(makeReq('https://other-alias.vercel.app/api/calendar/auth', { cookie: 'valid' }));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.searchParams.get('redirect_uri')).toBe('https://app.example.com/api/calendar/callback');
  });
});

// ── GET /api/calendar/callback ──

describe('GET /api/calendar/callback', () => {
  const path = (qs: string) => `${ORIGIN}/api/calendar/callback${qs}`;

  function expectErrorRedirect(res: Response) {
    expect(res.status).toBe(302);
    // Mai dettagli nell'URL: solo il flag generico.
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard?calendar=error`);
  }

  test('flag off → redirect errore (mai strandare il browser dell\'utente)', async () => {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path('?code=x&state=y'), { cookie: 'valid' }));
    expectErrorRedirect(res);
  });

  test('code mancante → redirect errore, nessuno scambio token', async () => {
    const state = await signOAuthState();
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?state=${encodeURIComponent(state)}`), { cookie: 'valid' }));
    expectErrorRedirect(res);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
  });

  test('state manomesso → redirect errore, nessuno scambio token', async () => {
    const state = await signOAuthState();
    const tampered = state.slice(0, -2) + (state.endsWith('AA') ? 'BB' : 'AA');
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?code=auth-code&state=${encodeURIComponent(tampered)}`), { cookie: 'valid' }));
    expectErrorRedirect(res);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
  });

  test('senza cookie di sessione → redirect errore, nessuno scambio token (identità = cookie, mai lo state)', async () => {
    const state = await signOAuthState();
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?code=auth-code&state=${encodeURIComponent(state)}`)));
    expectErrorRedirect(res);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
  });

  test('state più vecchio di 10 minuti → redirect errore', async () => {
    const state = await signOAuthState(new Date(Date.now() - 11 * 60 * 1000));
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?code=auth-code&state=${encodeURIComponent(state)}`), { cookie: 'valid' }));
    expectErrorRedirect(res);
    expect(exchangeAuthCode).not.toHaveBeenCalled();
  });

  test('happy path: scambia il code, upserta la connessione col token CIFRATO, redirect connected', async () => {
    (exchangeAuthCode as jest.Mock).mockResolvedValue({
      refresh_token: 'g-refresh-1',
      access_token: 'g-access-1',
      email: 'user@gmail.com',
    });
    const state = await signOAuthState();
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?code=auth-code&state=${encodeURIComponent(state)}`), { cookie: 'valid' }));

    expect(exchangeAuthCode).toHaveBeenCalledWith({
      code: 'auth-code',
      redirectUri: `${ORIGIN}/api/calendar/callback`,
    });

    const upsert = mockSupa.calls.find(
      (c) => c.table === 'calendar_connections' && c.operation === 'upsert'
    );
    expect(upsert).toBeTruthy();
    const payload = upsert!.args[0];
    expect(payload.user_phone).toBe(PHONE);
    expect(payload.google_email).toBe('user@gmail.com');
    expect(payload.enabled).toBe(true);
    expect(payload.last_sync_error).toBeNull();
    // Mai il token in chiaro a riposo: il payload deve decifrarsi al valore originale.
    expect(payload.google_refresh_token_enc).not.toContain('g-refresh-1');
    expect(decryptToken(payload.google_refresh_token_enc)).toBe('g-refresh-1');
    expect(upsert!.args[1]).toEqual({ onConflict: 'user_phone' });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard?calendar=connected`);
  });

  test('exchange fallito (es. refresh_token assente) → redirect errore', async () => {
    (exchangeAuthCode as jest.Mock).mockRejectedValue(
      new Error('Google token response missing refresh_token/access_token')
    );
    const state = await signOAuthState();
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?code=auth-code&state=${encodeURIComponent(state)}`), { cookie: 'valid' }));
    expectErrorRedirect(res);
    expect(
      mockSupa.calls.find((c) => c.table === 'calendar_connections' && c.operation === 'upsert')
    ).toBeUndefined();
  });

  test('upsert fallito → redirect errore', async () => {
    (exchangeAuthCode as jest.Mock).mockResolvedValue({
      refresh_token: 'g-refresh-1',
      access_token: 'g-access-1',
    });
    mockSupa.setResponse('calendar_connections:upsert', null, { message: 'db down' });
    const state = await signOAuthState();
    const { GET } = await import('../app/api/calendar/callback/route');
    const res = await GET(makeReq(path(`?code=auth-code&state=${encodeURIComponent(state)}`), { cookie: 'valid' }));
    expectErrorRedirect(res);
  });
});

// ── /api/calendar (GET / PATCH / DELETE) ──

const CONN_ROW = {
  id: 'conn-1',
  google_email: 'user@gmail.com',
  calendar_id: 'primary',
  reminder_offset_minutes: 60,
  message_template: null,
  enabled: true,
  last_synced_at: '2026-08-22T10:00:00.000Z',
  last_sync_error: null,
};

describe('GET /api/calendar', () => {
  const path = `${ORIGIN}/api/calendar`;

  test('flag off → 200 {enabled:false}', async () => {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const { GET } = await import('../app/api/calendar/route');
    const res = await GET(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  test('senza cookie → 401', async () => {
    const { GET } = await import('../app/api/calendar/route');
    const res = await GET(makeReq(path));
    expect(res.status).toBe(401);
  });

  test('non connesso → connected:false con campi null', async () => {
    mockSupa.setResponse('calendar_connections:select', []);
    const { GET } = await import('../app/api/calendar/route');
    const res = await GET(makeReq(path, { cookie: 'valid' }));
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      connected: false,
      email: null,
      calendar_id: null,
      reminder_offset_minutes: null,
      message_template: null,
      sync_enabled: null,
      last_synced_at: null,
      last_sync_error: null,
    });
  });

  test('connesso → mapping dei campi (sync_enabled = enabled della riga)', async () => {
    mockSupa.setResponse('calendar_connections:select', [{ ...CONN_ROW, enabled: false, last_sync_error: 'reauth_required' }]);
    const { GET } = await import('../app/api/calendar/route');
    const res = await GET(makeReq(path, { cookie: 'valid' }));
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.email).toBe('user@gmail.com');
    expect(body.calendar_id).toBe('primary');
    expect(body.reminder_offset_minutes).toBe(60);
    expect(body.sync_enabled).toBe(false);
    expect(body.last_sync_error).toBe('reauth_required');
  });
});

describe('PATCH /api/calendar', () => {
  const path = `${ORIGIN}/api/calendar`;

  test('flag off → 404', async () => {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const { PATCH } = await import('../app/api/calendar/route');
    const res = await PATCH(makeReq(path, { cookie: 'valid', body: { enabled: false } }));
    expect(res.status).toBe(404);
  });

  test('senza cookie → 401', async () => {
    const { PATCH } = await import('../app/api/calendar/route');
    const res = await PATCH(makeReq(path, { body: { enabled: false } }));
    expect(res.status).toBe(401);
  });

  test.each([
    ['offset sotto il minimo', { reminder_offset_minutes: 4 }],
    ['offset sopra il massimo', { reminder_offset_minutes: 2881 }],
    ['offset non intero', { reminder_offset_minutes: 60.5 }],
    ['offset stringa', { reminder_offset_minutes: '60' }],
    ['template troppo lungo', { message_template: 'x'.repeat(3501) }],
    ['template non stringa', { message_template: 42 }],
    ['enabled non booleano', { enabled: 'yes' }],
    ['nessun campo valido', { foo: 'bar' }],
  ])('validazione: %s → 400', async (_label, body) => {
    const { PATCH } = await import('../app/api/calendar/route');
    const res = await PATCH(makeReq(path, { cookie: 'valid', body }));
    expect(res.status).toBe(400);
  });

  test('bound validi accettati (5 e 2880)', async () => {
    mockSupa.setResponse('calendar_connections:select', [{ id: 'conn-1' }]);
    const { PATCH } = await import('../app/api/calendar/route');
    for (const v of [5, 2880]) {
      const res = await PATCH(makeReq(path, { cookie: 'valid', body: { reminder_offset_minutes: v } }));
      expect(res.status).toBe(200);
    }
  });

  test('non connesso → 404 not_connected', async () => {
    mockSupa.setResponse('calendar_connections:select', []);
    const { PATCH } = await import('../app/api/calendar/route');
    const res = await PATCH(makeReq(path, { cookie: 'valid', body: { enabled: false } }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_connected');
  });

  test('patch valido → update dei soli campi passati, scoped su user_phone', async () => {
    mockSupa.setResponse('calendar_connections:select', [{ id: 'conn-1' }]);
    const { PATCH } = await import('../app/api/calendar/route');
    const res = await PATCH(
      makeReq(path, {
        cookie: 'valid',
        body: { reminder_offset_minutes: 120, message_template: 'Ciao {nome}!', enabled: false },
      })
    );
    expect(res.status).toBe(200);

    const upd = mockSupa.calls.find(
      (c) => c.table === 'calendar_connections' && c.operation === 'update'
    );
    expect(upd).toBeTruthy();
    expect(upd!.args[0]).toEqual({
      reminder_offset_minutes: 120,
      message_template: 'Ciao {nome}!',
      enabled: false,
    });
    expect(upd!.chain).toContainEqual({ method: 'eq', args: ['user_phone', PHONE] });
  });

  test('template vuoto/blank → salvato null (torna al default)', async () => {
    mockSupa.setResponse('calendar_connections:select', [{ id: 'conn-1' }]);
    const { PATCH } = await import('../app/api/calendar/route');
    const res = await PATCH(makeReq(path, { cookie: 'valid', body: { message_template: '   ' } }));
    expect(res.status).toBe(200);
    const upd = mockSupa.calls.find(
      (c) => c.table === 'calendar_connections' && c.operation === 'update'
    );
    expect(upd!.args[0]).toEqual({ message_template: null });
  });
});

describe('DELETE /api/calendar', () => {
  const path = `${ORIGIN}/api/calendar`;

  test('flag off → 404', async () => {
    process.env.CALENDAR_SYNC_ENABLED = 'false';
    const { DELETE } = await import('../app/api/calendar/route');
    const res = await DELETE(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(404);
  });

  test('non connesso → 404', async () => {
    mockSupa.setResponse('calendar_connections:select', []);
    const { DELETE } = await import('../app/api/calendar/route');
    const res = await DELETE(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(404);
  });

  test('disconnect: cancella i reminder pending col prefisso della connessione, POI la riga', async () => {
    mockSupa.setResponse('calendar_connections:select', [{ id: 'conn-1' }]);
    const { DELETE } = await import('../app/api/calendar/route');
    const res = await DELETE(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const cancel = mockSupa.calls.find(
      (c) => c.table === 'scheduled_messages' && c.operation === 'update'
    );
    expect(cancel).toBeTruthy();
    expect(cancel!.args[0]).toEqual({ status: 'cancelled', error_message: 'calendar_disconnected' });
    expect(cancel!.chain).toContainEqual({ method: 'eq', args: ['instance_phone', PHONE] });
    expect(cancel!.chain).toContainEqual({ method: 'eq', args: ['status', 'pending'] });
    expect(cancel!.chain).toContainEqual({ method: 'like', args: ['calendar_event_key', 'conn-1:%'] });

    const del = mockSupa.calls.find(
      (c) => c.table === 'calendar_connections' && c.operation === 'delete'
    );
    expect(del).toBeTruthy();
    expect(del!.chain).toContainEqual({ method: 'eq', args: ['user_phone', PHONE] });

    // Ordine: prima il cancel dei reminder, poi la delete della connessione
    // (se il cancel fallisse, la riga sopravvive per il retry).
    expect(mockSupa.calls.indexOf(cancel!)).toBeLessThan(mockSupa.calls.indexOf(del!));
  });

  test('cancel dei reminder fallito → 500 e la connessione NON viene cancellata', async () => {
    mockSupa.setResponse('calendar_connections:select', [{ id: 'conn-1' }]);
    mockSupa.setResponse('scheduled_messages:update', null, { message: 'db down' });
    const { DELETE } = await import('../app/api/calendar/route');
    const res = await DELETE(makeReq(path, { cookie: 'valid' }));
    expect(res.status).toBe(500);
    expect(
      mockSupa.calls.find((c) => c.table === 'calendar_connections' && c.operation === 'delete')
    ).toBeUndefined();
  });
});
