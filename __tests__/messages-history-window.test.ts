/**
 * GET /api/messages — finestra dello storico (audit 28 set 2026, gruppo cron2).
 *
 * Il mock registra solo la stringa `.or(...)`: qui la si valuta davvero contro
 * righe realistiche (stessa sintassi PostgREST: col.op.valore, status.in.(…)),
 * così il test dice quali righe la dashboard vede, non com'è scritto il filtro.
 */
import { signCookie } from '../app/lib/auth-cookie';
import { createMockSupabase } from './helpers/mocks';

const SECRET = '0'.repeat(128);
const mockSupa = createMockSupabase();
const ORIGINAL_ENV = process.env;
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  mockSupa.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    AUTH_COOKIE_SECRET: SECRET,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    BILLING_ENABLED: 'false', // beta: historyDays = 90
  };
});
afterEach(() => { process.env = ORIGINAL_ENV; });

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function matchesOr(orFilter: string, row: Record<string, any>): boolean {
  return splitTopLevel(orFilter).some((term) => {
    const [col, op, ...rest] = term.split('.');
    const val = rest.join('.');
    const v = row[col];
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    if (op === 'eq') return String(v) === val;
    if (op === 'gte') return v != null && new Date(v).getTime() >= new Date(val).getTime();
    throw new Error('operatore non gestito nel test: ' + op);
  });
}

async function visibleIds(rows: Array<Record<string, any>>): Promise<string[]> {
  jest.resetModules();
  jest.doMock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  mockSupa.setResponse('user_instances:select', { id: 'u1', subscription_plan: 'trial', trial_ends_at: null, connection_status: 'open' }, null);
  mockSupa.setHandler('scheduled_messages:select', (call: any) => {
    const or = call.chain.find((m: any) => m.method === 'or');
    return { data: or ? rows.filter((r) => matchesOr(String(or.args[0]), r)) : rows, error: null };
  });
  const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
  const { GET } = await import('../app/api/messages/route');
  const req: any = new Request('http://localhost/api/messages');
  req.cookies = { get: (n: string) => (n === 'sw_session' ? { value: cookie } : undefined) };
  const res = await GET(req);
  const body = await res.json();
  return (body.messages as Array<{ id: string }>).map((m) => m.id);
}

const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

describe('storico: conta quando la riga è finita, non quando è stata creata', () => {
  test('BUG: promemoria creato 120 gg fa, fallito ieri → la card rossa si vede', async () => {
    const ids = await visibleIds([
      { id: 'foglio-rosa', status: 'failed', created_at: ago(120), scheduled_at: ago(1), sent_at: null },
    ]);
    expect(ids).toEqual(['foglio-rosa']);
  });

  test('BUG: promemoria creato 120 gg fa, inviato ieri → resta nello storico', async () => {
    const ids = await visibleIds([
      { id: 'inviato', status: 'sent', created_at: ago(120), scheduled_at: ago(1), sent_at: ago(1) },
    ]);
    expect(ids).toEqual(['inviato']);
  });

  test('un fallito resta visibile anche oltre la finestra, finché l\'utente non lo toglie', async () => {
    const ids = await visibleIds([
      { id: 'vecchio-fallito', status: 'failed', created_at: ago(200), scheduled_at: ago(150), sent_at: null },
    ]);
    expect(ids).toEqual(['vecchio-fallito']);
  });

  test('inviati e annullati fuori dalla finestra restano nascosti; la coda si vede sempre', async () => {
    const ids = await visibleIds([
      { id: 'inviato-vecchio', status: 'sent', created_at: ago(200), scheduled_at: ago(150), sent_at: ago(150) },
      { id: 'annullato-vecchio', status: 'cancelled', created_at: ago(200), scheduled_at: ago(150), sent_at: null },
      { id: 'in-coda', status: 'pending', created_at: ago(200), scheduled_at: ago(-10), sent_at: null },
    ]);
    expect(ids).toEqual(['in-coda']);
  });
});
