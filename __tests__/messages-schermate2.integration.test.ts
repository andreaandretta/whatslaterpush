// POST/PATCH/DELETE /api/messages — gruppo "schermate2" (fase 1b):
//  - segnaposto dei template non compilati ({giorno}, {orario}) rifiutati;
//  - "Elimina" su una riga ricorrente non ferma più la serie da sola;
//  - "Riattiva" su un messaggio in pausa già scaduto chiede cosa fare (409);
//  - la pausa decisa dall'utente toglie il vecchio motivo del cron;
//  - un orario scelto dall'utente azzera il conteggio "WhatsApp scollegato".
export {};

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

// Fake minimale di supabase-js. `row` è la riga del messaggio; `liveInChain`
// simula la query "la catena ha già una riga viva?"; `updateError` forza un
// errore sull'update (es. 23505 dell'indice uniq_recurrence_occurrence).
let row: Record<string, any> | null = null;
let liveInChain: { id: string }[] = [];
let updateError: { code: string; message: string } | null = null;
const updates: { patch: Record<string, unknown>; inStatuses?: string[] }[] = [];
const inserts: Record<string, unknown>[] = [];

function makeClient() {
  return {
    from: () => {
      const q: any = { _mode: 'select', _patch: null, _in: undefined as string[] | undefined, _or: null as string | null };
      q.select = () => q;
      q.update = (patch: Record<string, unknown>) => { q._mode = 'update'; q._patch = patch; return q; };
      q.insert = (r: Record<string, unknown>) => { q._mode = 'insert'; inserts.push(r); return q; };
      q.eq = () => q;
      q.neq = () => q;
      q.gte = () => q;
      q.gt = () => q;
      q.order = () => q;
      q.limit = () => q;
      q.or = (f: string) => { q._or = f; return q; };
      q.in = (_col: string, vals: string[]) => { q._in = vals; return q; };
      q.maybeSingle = async () => ({ data: null, error: null });
      const result = () => {
        if (q._mode === 'select') {
          if (q._or) return { data: liveInChain, error: null };
          return { data: row, error: null };
        }
        if (q._mode === 'insert') return { data: { id: 'new', scheduled_at: (inserts[inserts.length - 1] as any).scheduled_at }, error: null, single: { data: { id: 'new', scheduled_at: (inserts[inserts.length - 1] as any).scheduled_at }, error: null } };
        updates.push({ patch: q._patch, inStatuses: q._in });
        if (updateError && !('status' in q._patch && q._patch.status === 'cancelled')) {
          return { data: null, error: updateError, single: { data: null, error: updateError } };
        }
        const matched = row && (!q._in || q._in.includes(row.status));
        if (!matched) return { data: [], error: null, single: { data: null, error: { code: 'PGRST116', message: 'no rows' } } };
        const next = { ...row, ...q._patch };
        return { data: [next], error: null, single: { data: next, error: null } };
      };
      q.single = async () => {
        const r = result();
        return q._mode === 'select' ? r : r.single;
      };
      q.then = (res: any, rej: any) => Promise.resolve(result()).then(({ data, error }: any) => ({ data, error })).then(res, rej);
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

const future = (h = 3) => new Date(Date.now() + h * 3600 * 1000).toISOString();

beforeEach(() => {
  updates.length = 0;
  inserts.length = 0;
  liveInChain = [];
  updateError = null;
  row = { id: 'msg-1', instance_phone: '393331112222', status: 'pending', scheduled_at: future(), media_type: null, media_url: null, error_message: null, recurrence_rule: null };
});

describe('segnaposto dei template non compilati', () => {
  test('PATCH with "{giorno}" and "{orario}" left in the text: 400 unfilled_placeholder, no write', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', message: '🏃 Convocazione partita {giorno} ore {orario} — ciao {nome}' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unfilled_placeholder');
    expect(body.message).toBe('Completa i campi tra parentesi: {giorno}, {orario}');
    expect(updates).toHaveLength(0);
  });

  test('PATCH with only {nome} still passes (it is filled in at send time)', async () => {
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', message: 'Ciao {nome}, a sabato!' }));
    expect(res.status).toBe(200);
  });

  test('POST with "{importo}" and "{data}" is refused before anything is written', async () => {
    const { POST } = await import('../app/api/messages/route');
    const res = await POST(makeReq('POST', {
      recipient_number: '393334445566',
      message: 'Promemoria rata €{importo} in scadenza il {data}',
      scheduled_at: future(),
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unfilled_placeholder');
    expect(body.message).toBe('Completa i campi tra parentesi: {importo}, {data}');
    expect(inserts).toHaveLength(0);
  });
});

describe('Elimina su un promemoria ricorrente', () => {
  function weekly(status: string, scheduledAt: string) {
    row = {
      id: 'occ-2', instance_phone: '393331112222', status, scheduled_at: scheduledAt,
      recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU', recurrence_anchor_at: '2026-09-01T15:00:00.000Z',
      parent_recurrence_id: 'root-1', error_message: status === 'failed' ? 'HTTP 500: boom' : null,
    };
  }
  // Prossimo martedì alle 17:00 di Roma (15:00Z in ora legale) almeno 2 giorni avanti.
  function nextTuesday(): string {
    const d = new Date(Date.now() + 2 * 86400_000);
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
    d.setUTCHours(15, 0, 0, 0);
    return d.toISOString();
  }

  test('"Solo questa volta" (scope occurrence) moves the row one week ahead instead of cancelling the series', async () => {
    const tue = nextTuesday();
    weekly('pending', tue);
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2', scope: 'occurrence' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(updates[0].patch.status).not.toBe('cancelled');
    const moved = new Date(updates[0].patch.scheduled_at as string);
    const diffDays = (moved.getTime() - new Date(tue).getTime()) / 86400_000;
    expect(Math.round(diffDays)).toBe(7);
    expect(moved.getUTCDay()).toBe(2);
    expect(body.skipped_to).toBe(updates[0].patch.scheduled_at);
  });

  test('"Tutta la serie" (scope series) cancels as before', async () => {
    weekly('pending', nextTuesday());
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2', scope: 'series' }));
    expect(res.status).toBe(200);
    expect(updates[0].patch).toEqual({ status: 'cancelled' });
  });

  test('deleting the failed latest occurrence before the cron tick keeps the series alive', async () => {
    // Fallita un minuto fa, il cron non ha ancora creato la prossima.
    weekly('failed', new Date(Date.now() - 60_000).toISOString());
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2' }));
    expect(res.status).toBe(200);
    expect(updates[0].patch).toMatchObject({ status: 'pending', retry_count: 0, error_message: null });
    expect(new Date(updates[0].patch.scheduled_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(updates[0].inStatuses).toEqual(['failed']);
  });

  test('a failed row whose next occurrence already exists is simply cancelled (no duplicate)', async () => {
    weekly('failed', new Date(Date.now() - 3600_000).toISOString());
    liveInChain = [{ id: 'occ-3' }];
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2' }));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ status: 'cancelled' });
  });

  // Revisione 28 set 2026: serie fermata con "Tutta la serie", poi eliminata
  // la vecchia card rossa con "Solo questa volta" → la serie ripartiva.
  test('an old red card of a series stopped later is only cancelled, never re-queued', async () => {
    weekly('failed', new Date(Date.now() - 20 * 86400_000).toISOString());
    liveInChain = [{ id: 'occ-5-cancelled' }]; // una riga più nuova esiste (cancellata)
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2', scope: 'occurrence' }));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).toEqual({ status: 'cancelled' });
  });

  test('"Tutta la serie" on a red card also cancels the next occurrence the cron already created', async () => {
    weekly('failed', new Date(Date.now() - 3600_000).toISOString());
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2', scope: 'series' }));
    expect(res.status).toBe(200);
    expect(updates[0].patch).toEqual({ status: 'cancelled' });
    expect(updates[1]).toEqual({ patch: { status: 'cancelled' }, inStatuses: ['pending', 'paused'] });
  });

  test('if the cron created the same occurrence meanwhile (23505), the row is cancelled instead', async () => {
    weekly('failed', new Date(Date.now() - 60_000).toISOString());
    updateError = { code: '23505', message: 'duplicate key value violates unique constraint "uniq_recurrence_occurrence"' };
    const { DELETE } = await import('../app/api/messages/route');
    const res = await DELETE(makeReq('DELETE', { id: 'occ-2' }));
    expect(res.status).toBe(200);
    expect(updates[updates.length - 1].patch).toEqual({ status: 'cancelled' });
  });

  test('a paused occurrence skipped with "Solo questa volta" stays paused', async () => {
    weekly('paused', nextTuesday());
    const { DELETE } = await import('../app/api/messages/route');
    await DELETE(makeReq('DELETE', { id: 'occ-2', scope: 'occurrence' }));
    expect(updates[0].patch.status).toBe('paused');
  });
});

describe('Riattiva un messaggio in pausa con l\'orario già passato', () => {
  test('409 time_passed with an Italian message, nothing written', async () => {
    row!.status = 'paused';
    row!.scheduled_at = new Date(Date.now() - 4 * 86400_000).toISOString();
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'pending' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('time_passed');
    expect(body.message).toMatch(/già passato/);
    expect(updates).toHaveLength(0);
  });

  test('"Invia ora" (status + a new time in the same PATCH) goes through', async () => {
    row!.status = 'paused';
    row!.scheduled_at = new Date(Date.now() - 4 * 86400_000).toISOString();
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'pending', scheduled_at: new Date(Date.now() + 120_000).toISOString() }));
    expect(res.status).toBe(200);
    expect(updates[0].patch.status).toBe('pending');
  });

  test('a paused row still in the future resumes as before', async () => {
    row!.status = 'paused';
    const { PATCH } = await import('../app/api/messages/route');
    const res = await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'pending' }));
    expect(res.status).toBe(200);
  });
});

describe('pausa decisa dall\'utente', () => {
  test('pausing a row the cron left with "HTTP 500" clears the stale reason', async () => {
    row!.error_message = 'HTTP 500: Internal Server Error';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'paused' }));
    expect(updates[0].patch).toMatchObject({ status: 'paused', error_message: null });
  });

  test('pausing a row moved for quota clears "riprogrammato a domattina"', async () => {
    row!.error_message = 'Numeri nuovi: max 5 al giorno — riprogrammato a domattina';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'paused' }));
    expect(updates[0].patch).toHaveProperty('error_message', null);
  });

  test('a real pause reason set by the system ("In pausa: ...") is kept', async () => {
    row!.status = 'paused';
    row!.error_message = 'In pausa: il destinatario ha chiesto di non ricevere più messaggi (ha scritto "stop").';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', status: 'paused' }));
    expect(updates[0].patch).not.toHaveProperty('error_message');
  });
});

describe('spostare UNA volta un promemoria ricorrente non sposta la serie', () => {
  test('keep_recurrence_anchor (Invia ora / Posticipa) leaves recurrence_anchor_at alone', async () => {
    row!.recurrence_rule = 'FREQ=WEEKLY;BYDAY=FR';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', scheduled_at: future(1), keep_recurrence_anchor: true }));
    expect(updates[0].patch).toHaveProperty('scheduled_at');
    expect(updates[0].patch).not.toHaveProperty('recurrence_anchor_at');
  });

  test('a real edit of the time still re-anchors the series (unchanged)', async () => {
    row!.recurrence_rule = 'FREQ=WEEKLY;BYDAY=FR';
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', scheduled_at: future(1) }));
    expect(updates[0].patch).toHaveProperty('recurrence_anchor_at');
  });
});

describe('orario scelto dall\'utente e conteggio "WhatsApp scollegato"', () => {
  test('a user reschedule (edit or snooze) resets disconnect_retry_count to 0', async () => {
    row!.disconnect_retry_count = 9;
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', scheduled_at: future(5) }));
    expect(updates[0].patch).toHaveProperty('disconnect_retry_count', 0);
  });

  test('a text-only edit does not touch it', async () => {
    row!.disconnect_retry_count = 9;
    const { PATCH } = await import('../app/api/messages/route');
    await PATCH(makeReq('PATCH', { id: 'msg-1', message: 'Nuovo testo' }));
    expect(updates[0].patch).not.toHaveProperty('disconnect_retry_count');
  });
});
