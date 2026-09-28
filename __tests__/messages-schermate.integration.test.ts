// PATCH/DELETE /api/messages — gruppo "schermate" (audit 25 set 2026):
//  - "Elimina" su una card rossa (failed) deve funzionare, non 409;
//  - "Riprova" su un numero che WhatsApp non conosce va rifiutato dal server;
//  - riprogrammare/riprendere a mano toglie il motivo scritto dal cron.
export {}; // modulo: niente collisioni di nomi globali con gli altri test


jest.mock('next/server', () => {
  const { NextRequest } = jest.requireActual('next/server');
  return {
    NextRequest,
    NextResponse: {
      json: (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { 'content-type': 'application/json' } }),
    },
  };
});

jest.mock('../app/lib/auth-cookie', () => ({
  AUTH_COOKIE_NAME: 'sw_session',
  verifyCookie: jest.fn(async (raw?: string) => (raw === 'valid' ? { phone: '393331112222', instanceName: 'SchedWhats-393331112222' } : null)),
}));

jest.mock('../app/lib/audit', () => ({
  logAuditEvent: jest.fn(async () => {}),
  clientIpFromHeaders: () => null,
  hashContactRef: async () => 'hashed',
}));

jest.mock('../app/lib/cron-utils', () => ({ applyJitter: (iso: string) => iso }));
jest.mock('../lib/evolution/client', () => ({ evolutionClient: { whatsappNumbers: jest.fn() } }));

// Fake minimale di supabase-js: registra update e filtri, simula il filtro
// .in('status', [...]) contro lo stato corrente della riga.
let row: Record<string, any> | null = null;
const updates: { patch: Record<string, unknown>; inStatuses?: string[] }[] = [];

function makeClient() {
  return {
    from: () => {
      const q: any = { _mode: 'select', _patch: null, _in: undefined as string[] | undefined };
      q.select = () => q;
      q.update = (patch: Record<string, unknown>) => { q._mode = 'update'; q._patch = patch; return q; };
      q.eq = () => q;
      q.in = (_col: string, vals: string[]) => { q._in = vals; return q; };
      const result = () => {
        if (q._mode === 'select') return { data: row, error: null };
        updates.push({ patch: q._patch, inStatuses: q._in });
        const matched = row && (!q._in || q._in.includes(row.status));
        if (!matched) return { data: [], error: null, single: { data: null, error: { code: 'PGRST116', message: 'no rows' } } };
        const next = { ...row, ...q._patch };
        return { data: [next], error: null, single: { data: next, error: null } };
      };
      q.single = async () => {
        const r = result();
        return q._mode === 'select' ? r : r.single;
      };
      q.then = (res: any, rej: any) => Promise.resolve(result()).then(({ data, error }) => ({ data, error })).then(res, rej);
      return q;
    },
    storage: { from: () => ({ remove: async () => ({}) }) },
  };
}

jest.mock('../app/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => makeClient(),
  getSupabaseAdminOrNull: () => makeClient(),
}));

function makeReq(method: string, body: unknown): any {
  const req = new Request('http://localhost/api/messages', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
  req.cookies = { get: (n: string) => (n === 'sw_session' ? { value: 'valid' } : undefined) };
  return req;
}

const EXISTS_FALSE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"393331234567@s.whatsapp.net","exists":false,"number":"393331234567"}]}}';

beforeEach(() => {
  updates.length = 0;
  row = { id: 'msg-1', instance_phone: '393331112222', status: 'pending', media_type: null, media_url: null, error_message: null };
});

describe('DELETE /api/messages', () => {
  test('a failed row is cancelled (the red card\'s "Elimina" works)', async () => {
    row!.status = 'failed';
    row!.error_message = EXISTS_FALSE;
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'msg-1' }));
    expect(res.status).toBe(200);
    expect(updates[0].patch).toEqual({ status: 'cancelled' });
    expect(updates[0].inStatuses).toEqual(expect.arrayContaining(['pending', 'paused', 'failed']));
  });

  test('a row already sent stays 409 with an Italian message', async () => {
    row!.status = 'sent';
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'msg-1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/già in invio o inviato/);
    expect(updates[0].inStatuses).not.toContain('processing');
  });
});

describe('PATCH action=retry', () => {
  test('refuses a permanent "exists": false failure with 409 + Italian message, no write', async () => {
    row!.status = 'failed';
    row!.error_message = EXISTS_FALSE;
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', action: 'retry' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not_retryable_permanent');
    expect(body.message).toMatch(/WhatsApp non conosce questo numero/);
    expect(updates).toHaveLength(0);
  });

  test('a transient failure is still re-queued', async () => {
    row!.status = 'failed';
    row!.error_message = 'HTTP 500: boom';
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', action: 'retry' }));
    expect(res.status).toBe(200);
    expect(updates[0].patch).toMatchObject({ status: 'pending', retry_count: 0, error_message: null });
  });
});

describe('PATCH: il motivo del cron sparisce quando decide l\'utente', () => {
  const future = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString();

  test('rescheduling a pending row moved by the cron clears its reason', async () => {
    row!.error_message = 'Limite giornaliero raggiunto (5/5) nei primi giorni dal collegamento — riprogrammato a domattina';
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', scheduled_at: future() }));
    expect(res.status).toBe(200);
    expect(updates[0].patch).toHaveProperty('error_message', null);
  });

  test('resuming a paused row clears the pause reason', async () => {
    row!.status = 'paused';
    row!.error_message = 'In pausa: ti eri disconnesso da WhatsLater. Riprendilo quando vuoi.';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'pending' }));
    expect(updates[0].patch).toMatchObject({ status: 'pending', error_message: null });
  });

  test('snoozing a row that stays paused keeps the reason (e.g. the recipient wrote "stop")', async () => {
    row!.status = 'paused';
    row!.error_message = 'In pausa: il destinatario ha chiesto di non ricevere più messaggi (ha scritto "stop").';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', scheduled_at: future() }));
    expect(updates[0].patch).not.toHaveProperty('error_message');
    expect(updates[0].patch).not.toHaveProperty('status');
  });

  test('a text-only edit does not touch error_message', async () => {
    row!.error_message = 'Cool-down: max 3 messaggi allo stesso contatto in 24h. Riprogrammato +30 min.';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', message: 'Nuovo testo' }));
    expect(updates[0].patch).not.toHaveProperty('error_message');
  });
});
