/**
 * CONNECTION_UPDATE fuori ordine (review fase 1b).
 *
 * Il webhook risponde 503 quando non riesce a salvare lo stato, così Evolution
 * 2.3.7 lo ritrasmette (backoff da 5 s). Ma gli eventi non sono ordinati: il
 * 'close' fallito può tornare DOPO l'"open" arrivato nel frattempo e riportare
 * la riga a 'close' mentre il socket è aperto. Nessun altro CONNECTION_UPDATE
 * arriva finché resta collegato → il cron trattiene tutto e il banner rosso
 * spinge a un re-pair inutile (segnale di ban). Regola: un evento che
 * contraddice lo stato VIVO di Evolution in quel momento non sovrascrive
 * connection_status. Stato vivo ignoto (rete, 404, timeout) → si scrive
 * l'evento come prima.
 */
import { createMockSupabase, mockRequest } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;
const INSTANCE = 'SchedWhats-393331234567';

let liveState: string | null = null; // null → Evolution non risponde
const evoCalls: string[] = [];

beforeEach(() => {
  mockSupa.calls.length = 0;
  evoCalls.length = 0;
  liveState = null;
  mockSupa.setResponse('user_instances:update', [{ id: 'ui-1', phone_number: '393331234567' }]);
  mockSupa.setResponse('pending_auth_sessions:update', []);
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    WEBHOOK_SECRET: 'whk-test',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
  };
  (global as any).fetch = jest.fn(async (url: string) => {
    evoCalls.push(String(url));
    if (String(url).includes('/instance/connectionState/')) {
      if (liveState === null) throw new Error('ECONNREFUSED');
      return { ok: true, status: 200, json: async () => ({ instance: { instanceName: INSTANCE, state: liveState } }) };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  });
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
  (global as any).fetch = ORIGINAL_FETCH;
});

async function postWebhook(body: any) {
  jest.resetModules();
  jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { POST } = await import('../app/api/webhook/route');
  const req: any = mockRequest(body, { 'x-webhook-secret': 'whk-test', 'Content-Type': 'application/json' });
  return POST(req);
}

const statusWrites = () => mockSupa.calls.filter(
  (c) => c.table === 'user_instances' && c.operation === 'update' && 'connection_status' in (c.args[0] || {}),
);

describe('CONNECTION_UPDATE — un evento vecchio non sovrascrive uno stato più nuovo', () => {
  test('retry tardivo di un "close" (428) mentre Evolution dice "open" → connection_status NON toccato, 200', async () => {
    liveState = 'open';
    const res = await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 428 } });
    expect(res.status).toBe(200);
    expect(statusWrites()).toHaveLength(0);
    expect(evoCalls.some((u) => u.endsWith('/instance/connectionState/' + INSTANCE))).toBe(true);
  });

  test('retry tardivo di un "connecting" mentre Evolution dice "open" → niente scrittura', async () => {
    liveState = 'open';
    const res = await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'connecting' } });
    expect(res.status).toBe(200);
    expect(statusWrites()).toHaveLength(0);
  });

  test('il disconnect resta registrato (last_disconnect_* + audit) anche se lo stato non cambia', async () => {
    liveState = 'open';
    await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 428 } });
    const upd = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update' && 'last_disconnect_code' in (c.args[0] || {}));
    expect(upd?.args[0]).toMatchObject({ last_disconnect_code: 428 });
    expect(upd?.args[0]).not.toHaveProperty('connection_status');
    expect(mockSupa.calls.some((c) => c.table === 'audit_events' && c.operation === 'insert' && c.args[0]?.event_type === 'instance_disconnect')).toBe(true);
  });

  test('retry tardivo di un "open" dopo un logout vero (Evolution dice "close") → resta close', async () => {
    liveState = 'close';
    const res = await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'open', wuid: '393331234567@s.whatsapp.net' } });
    expect(res.status).toBe(200);
    expect(statusWrites()).toHaveLength(0);
  });

  test('"close" confermato da Evolution → scritto come prima', async () => {
    liveState = 'close';
    await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 401 } });
    expect(statusWrites().map((c) => c.args[0].connection_status)).toEqual(['close']);
  });

  test('"open" durante il pairing con Evolution "open" → scritto, e la sessione di pairing viene autenticata', async () => {
    liveState = 'open';
    await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'open', wuid: '393331234567@s.whatsapp.net' } });
    expect(statusWrites().map((c) => c.args[0].connection_status)).toEqual(['open']);
    expect(mockSupa.calls.some((c) => c.table === 'pending_auth_sessions' && c.operation === 'update')).toBe(true);
  });

  test('stato vivo ignoto (Evolution non risponde) → si scrive l\'evento, come prima', async () => {
    liveState = null;
    await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 401 } });
    expect(statusWrites().map((c) => c.args[0].connection_status)).toEqual(['close']);
  });

  test('"open" autentica anche una sessione di pairing scaduta da poco (codice inserito al minuto 12)', async () => {
    liveState = 'open';
    await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'open', wuid: '393331234567@s.whatsapp.net' } });
    const upd = mockSupa.calls.find((c) => c.table === 'pending_auth_sessions' && c.operation === 'update' && c.args[0]?.status === 'authenticated')!;
    const gt = upd.chain.find((m) => m.method === 'gt' && m.args[0] === 'expires_at')!;
    const cutoffMs = new Date(gt.args[1]).getTime();
    // il limite è nel passato di ~20 minuti, non "adesso"
    expect(Date.now() - cutoffMs).toBeGreaterThan(15 * 60_000);
    expect(Date.now() - cutoffMs).toBeLessThan(25 * 60_000);
    expect(upd.chain).toContainEqual({ method: 'eq', args: ['phone', '393331234567'] });
  });

  test('"close" e "connecting" non si contraddicono: close con Evolution "connecting" → scritto', async () => {
    liveState = 'connecting';
    await postWebhook({ event: 'connection.update', instance: INSTANCE, data: { state: 'close', statusReason: 428 } });
    expect(statusWrites().map((c) => c.args[0].connection_status)).toEqual(['close']);
  });
});
