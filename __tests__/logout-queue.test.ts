// POST /api/auth/logout — cosa succede alla coda quando l'utente si disconnette.
// Incidente 7 set 2026: logout, coda intatta, e al ricollegamento settimane
// dopo i promemoria di eventi già passati sarebbero partiti tutti insieme.
export {}; // modulo: niente collisioni di nomi globali con gli altri test


jest.mock('../app/lib/auth-cookie', () => ({
  AUTH_COOKIE_NAME: 'sw_session',
  verifyCookie: jest.fn(async (raw?: string) => (raw === 'valid' ? { phone: '393331112222', instanceName: 'SchedWhats-393331112222' } : null)),
}));

const audit = jest.fn(async (_e: unknown) => {});
jest.mock('../app/lib/audit', () => ({
  logAuditEvent: (e: unknown) => audit(e),
  clientIpFromHeaders: () => null,
}));

const forceDelete = jest.fn(async () => {});
jest.mock('../app/lib/evolution', () => ({
  forceDeleteInstance: () => forceDelete(),
  instanceNameForPhone: (p: string) => 'SchedWhats-' + p,
}));

type Call = { table: string; patch: Record<string, unknown>; eqs: [string, unknown][]; inStatuses?: string[] };
const calls: Call[] = [];
jest.mock('../app/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const c: Call = { table, patch: {}, eqs: [] };
      const q: any = {
        update: (p: Record<string, unknown>) => { c.patch = p; calls.push(c); return q; },
        eq: (col: string, v: unknown) => { c.eqs.push([col, v]); return q; },
        in: (_col: string, vals: string[]) => { c.inStatuses = vals; return q; },
        select: () => q,
        then: (res: any, rej: any) => Promise.resolve({ data: [{ id: 'a' }, { id: 'b' }], error: null }).then(res, rej),
      };
      return q;
    },
  }),
}));

function req(body?: unknown, cookie = 'valid'): any {
  const r = new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }) as any;
  r.cookies = { get: (n: string) => (n === 'sw_session' && cookie ? { value: cookie } : undefined) };
  return r;
}

const queueWrites = () => calls.filter((c) => c.table === 'scheduled_messages');

beforeEach(() => { calls.length = 0; audit.mockClear(); });

test('queue=pause: pending rows become paused with a reason, before the connection closes', async () => {
  const { POST } = await import('../app/api/auth/logout/route');
  const res = await POST(req({ queue: 'pause' }));
  expect(res.status).toBe(200);
  const w = queueWrites();
  expect(w).toHaveLength(1);
  expect(w[0].patch).toMatchObject({ status: 'paused' });
  expect(String(w[0].patch.error_message)).toMatch(/^In pausa:/);
  expect(w[0].eqs).toContainEqual(['instance_phone', '393331112222']);
  expect(w[0].inStatuses).toEqual(['pending']);
  // ordine: prima la coda, poi user_instances → 'close'
  expect(calls.findIndex((c) => c.table === 'scheduled_messages')).toBeLessThan(calls.findIndex((c) => c.table === 'user_instances'));
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ payload: { queue: 'pause', queue_affected: 2 } }));
});

test('no choice sent (old client) → pause by default: nothing fires on a future re-pair', async () => {
  const { POST } = await import('../app/api/auth/logout/route');
  await POST(req());
  expect(queueWrites()[0].patch).toMatchObject({ status: 'paused' });
});

test('queue=cancel: pending and paused rows are cancelled', async () => {
  const { POST } = await import('../app/api/auth/logout/route');
  await POST(req({ queue: 'cancel' }));
  const w = queueWrites();
  expect(w[0].patch).toEqual({ status: 'cancelled' });
  expect(w[0].inStatuses).toEqual(['pending', 'paused']);
});

test('queue=keep: the queue is not touched', async () => {
  const { POST } = await import('../app/api/auth/logout/route');
  await POST(req({ queue: 'keep' }));
  expect(queueWrites()).toHaveLength(0);
  expect(calls.some((c) => c.table === 'user_instances')).toBe(true);
});

test('anonymous logout touches nothing and still clears the cookie', async () => {
  const { POST } = await import('../app/api/auth/logout/route');
  const res = await POST(req({ queue: 'cancel' }, ''));
  expect(calls).toHaveLength(0);
  expect((res.headers.get('set-cookie') || '').toLowerCase()).toContain('max-age=0');
});
