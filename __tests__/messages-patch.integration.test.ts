// Integration test for PATCH /api/messages — edit-in-place + pause/resume.
// Mirrors the harness style of messages-post.integration.test.ts:
// mocks @supabase/supabase-js client + auth-cookie verify + audit logger.

const cookieStore = new Map<string, string>();

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

jest.mock('../app/lib/auth-cookie', () => ({
  AUTH_COOKIE_NAME: 'sw_session',
  verifyCookie: jest.fn(async (raw?: string) => {
    if (raw === 'valid') return { phone: '393331112222', instanceName: 'SchedWhats-393331112222' };
    return null;
  }),
}));

jest.mock('../app/lib/audit', () => ({
  logAuditEvent: jest.fn(async () => {}),
  clientIpFromHeaders: () => null,
  hashContactRef: async () => 'hashed',
}));

jest.mock('../app/lib/cron-utils', () => ({
  applyJitter: (iso: string) => iso, // no jitter in tests so we can assert exact dates
}));

let currentRow: Record<string, unknown> | null = null;
let updateError: { code?: string; message?: string } | null = null;
let updateMatched = true; // simulates the .in('status', editable) guard matching

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: currentRow, error: null }),
          }),
        }),
      }),
      update: (_patch: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            in: () => ({
              select: () => ({
                single: async () => {
                  if (updateError) return { data: null, error: updateError };
                  if (!updateMatched) return { data: null, error: { code: 'PGRST116', message: 'no row matched' } };
                  return {
                    data: { ...currentRow, ..._patch, id: currentRow?.id },
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

// Stub envs needed by route module load.
process.env.SUPABASE_URL = 'https://placeholder.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder';

function makeReq(body: unknown, cookie = 'valid'): import('next/server').NextRequest {
  cookieStore.clear();
  if (cookie) cookieStore.set('sw_session', cookie);
  const req = new Request('http://localhost/api/messages', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: cookie ? `sw_session=${cookie}` : '' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
  (req as unknown as { cookies: { get: (n: string) => { value?: string } | undefined } }).cookies = {
    get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined),
  };
  return req;
}

describe('PATCH /api/messages', () => {
  beforeEach(() => {
    currentRow = {
      id: 'msg-1',
      instance_phone: '393331112222',
      status: 'pending',
      media_type: null,
      media_url: null,
    };
    updateError = null;
    updateMatched = true;
  });

  test('401 senza cookie', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', status: 'paused' }, ''));
    expect(res.status).toBe(401);
  });

  test('400 se manca id', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ status: 'paused' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('id required');
  });

  test('403 se il messaggio non è del proprietario / non esiste', async () => {
    currentRow = null;
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', status: 'paused' }));
    expect(res.status).toBe(403);
  });

  test('409 se il messaggio è in stato terminale', async () => {
    currentRow = { ...currentRow!, status: 'sent' };
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', status: 'paused' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('message_not_editable');
  });

  test('pause: status=paused → 200', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', status: 'paused' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.status).toBe('paused');
  });

  test('400 su status non valido (es. "sent")', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', status: 'sent' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_status');
  });

  test('400 su scheduled_at nel passato', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', scheduled_at: past }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_datetime');
  });

  test('edit message body → 200 con parsed_message aggiornato', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', scheduled_at: future, message: 'nuovo testo' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.parsed_message).toBe('nuovo testo');
  });

  test('400 se il body è vuoto e non c\'è media', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', message: '   ' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_message');
  });

  test('400 su recurrence_rule invalida', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', recurrence_rule: 'GARBAGE' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_recurrence_rule');
  });

  test('recurrence_rule null → cancella la ricorrenza', async () => {
    currentRow = { ...currentRow!, recurrence_rule: 'FREQ=DAILY' };
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', recurrence_rule: null }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.recurrence_rule).toBeNull();
  });

  test('400 se il body è vuoto (no fields to update)', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_fields_to_update');
  });

  test('409 se la cron ha vinto la corsa tra read e write', async () => {
    updateMatched = false;
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq({ id: 'msg-1', status: 'paused' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('message_not_editable');
  });

  describe('action: retry (failed → pending)', () => {
    test('retry di un messaggio failed → 200, status pending', async () => {
      currentRow = { ...currentRow!, status: 'failed', error_message: 'HTTP 400: bad number', retry_count: 3 };
      const { PATCH } = await import('../app/api/messages/route');
      const res = await PATCH(makeReq({ id: 'msg-1', action: 'retry' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message.status).toBe('pending');
      // clean slate: counters reset, error cleared
      expect(body.message.retry_count).toBe(0);
      expect(body.message.error_message).toBeNull();
    });

    test('retry su uno stato non-failed (es. sent) → 409 not_retryable', async () => {
      currentRow = { ...currentRow!, status: 'sent' };
      const { PATCH } = await import('../app/api/messages/route');
      const res = await PATCH(makeReq({ id: 'msg-1', action: 'retry' }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('not_retryable');
    });

    test('retry quando la cron riclaim la riga tra read e write → 409 not_retryable', async () => {
      currentRow = { ...currentRow!, status: 'failed' };
      updateMatched = false;
      const { PATCH } = await import('../app/api/messages/route');
      const res = await PATCH(makeReq({ id: 'msg-1', action: 'retry' }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('not_retryable');
    });
  });
});
