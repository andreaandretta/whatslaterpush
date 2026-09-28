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

// Review fase 1b: il dialogo dice "Hai N messaggi in coda" contando solo i
// 'pending'. 'Annullali' cancellava anche i 'paused' messi in pausa apposta
// (pausa stagionale, destinatari sospesi): 2 annunciati, 7 cancellati, catene
// ricorrenti comprese. Si annulla solo ciò che il dialogo ha contato.
test('queue=cancel: only the pending rows the dialog counted are cancelled — paused rows stay paused', async () => {
  const { POST } = await import('../app/api/auth/logout/route');
  await POST(req({ queue: 'cancel' }));
  const w = queueWrites();
  expect(w[0].patch).toEqual({ status: 'cancelled' });
  expect(w[0].inStatuses).toEqual(['pending']);
});

// "Esci da questo dispositivo" (fase 1b): solo il cookie. Su un PC condiviso
// l'utente esce come da qualsiasi sito, e i promemoria continuano a partire.
test('scope=device: clears the cookie only — no queue change, no status change, no Evolution teardown', async () => {
  forceDelete.mockClear();
  const { POST } = await import('../app/api/auth/logout/route');
  const res = await POST(req({ scope: 'device', queue: 'cancel' }));
  expect(res.status).toBe(200);
  expect(calls).toHaveLength(0);
  expect(forceDelete).not.toHaveBeenCalled();
  expect((res.headers.get('set-cookie') || '').toLowerCase()).toContain('max-age=0');
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'auth_logout', payload: { scope: 'device' } }));
});

test('no scope (old client) keeps the full unlink', async () => {
  forceDelete.mockClear();
  const { POST } = await import('../app/api/auth/logout/route');
  await POST(req({ queue: 'keep' }));
  expect(forceDelete).toHaveBeenCalled();
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
