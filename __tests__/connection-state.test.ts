/**
 * Riconciliazione di connection_status con lo stato VERO di Evolution.
 * Il DB lo scrive solo il webhook: un CONNECTION_UPDATE perso (Supabase in
 * Gateway Timeout, il webhook risponde 200 lo stesso) lascia lo stato sbagliato
 * fino al prossimo evento. Qui: lettura puntuale, una istanza per volta.
 */
import { createMockSupabase } from './helpers/mocks';
import { mapEvolutionState, fetchEvolutionState, reconcileInstanceStates } from '../app/lib/connection-state';

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, EVOLUTION_API_URL: 'https://evo.test', EVOLUTION_API_KEY: 'k' };
});
afterEach(() => { process.env = ORIGINAL_ENV; });

function jsonRes(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as any;
}

describe('mapEvolutionState — stessa mappa del webhook', () => {
  test.each([
    ['open', 'open'], ['connected', 'open'],
    ['close', 'close'], ['disconnected', 'close'], ['logged_out', 'close'],
    ['connecting', 'connecting'], ['qr', 'connecting'],
  ])('%s → %s', (raw, mapped) => {
    expect(mapEvolutionState(raw)).toBe(mapped);
  });
  test('valori ignoti → null (mai scrivere un dato non provato)', () => {
    expect(mapEvolutionState(undefined)).toBeNull();
    expect(mapEvolutionState('boh')).toBeNull();
  });
});

describe('fetchEvolutionState', () => {
  test('legge instance.state da /instance/connectionState/<nome>', async () => {
    const fetchImpl = jest.fn(async () => jsonRes({ instance: { instanceName: 'SchedWhats-1', state: 'close' } }));
    await expect(fetchEvolutionState('SchedWhats-1', fetchImpl as any)).resolves.toBe('close');
    expect((fetchImpl.mock.calls[0] as any[])[0]).toBe('https://evo.test/instance/connectionState/SchedWhats-1');
  });
  test('HTTP non-ok (401 apikey, 404 istanza sparita, 5xx) → null', async () => {
    const fetchImpl = jest.fn(async () => jsonRes({ status: 404 }, 404));
    await expect(fetchEvolutionState('x', fetchImpl as any)).resolves.toBeNull();
  });
  test('errore di rete → null, mai eccezione', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('fetch failed'); });
    await expect(fetchEvolutionState('x', fetchImpl as any)).resolves.toBeNull();
  });
});

describe('reconcileInstanceStates — daily-report, una chiamata per istanza al giorno', () => {
  test('DB "open" ma Evolution "close" (close perso) → scrive close; DB "close" ma Evolution "open" → scrive open', async () => {
    const supa = createMockSupabase();
    supa.setResponse('user_instances:select', [
      { instance_name: 'A', connection_status: 'open' },
      { instance_name: 'B', connection_status: 'close' },
      { instance_name: 'C', connection_status: 'open' },
    ]);
    const states: Record<string, string> = { A: 'close', B: 'open', C: 'open' };
    const fetchImpl = jest.fn(async (url: string) => {
      const name = url.split('/').pop()!;
      return jsonRes({ instance: { instanceName: name, state: states[name] } });
    });
    const out = await reconcileInstanceStates(supa.client as any, fetchImpl as any);
    expect(out).toEqual({ checked: 3, fixed: 2, unknown: 0, skipped: false });
    const updates = supa.calls.filter((c) => c.table === 'user_instances' && c.operation === 'update');
    expect(updates.map((u) => [u.args[0].connection_status, u.chain.find((m) => m.method === 'eq' && m.args[0] === 'instance_name')!.args[1]]))
      .toEqual([['close', 'A'], ['open', 'B']]);
  });

  test('Evolution irraggiungibile → nessuna scrittura', async () => {
    const supa = createMockSupabase();
    supa.setResponse('user_instances:select', [{ instance_name: 'A', connection_status: 'open' }]);
    const fetchImpl = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const out = await reconcileInstanceStates(supa.client as any, fetchImpl as any);
    expect(out).toEqual({ checked: 1, fixed: 0, unknown: 1, skipped: false });
    expect(supa.calls.filter((c) => c.operation === 'update')).toHaveLength(0);
  });

  test('CONNECTION_RECONCILE_DISABLED=true la spegne', async () => {
    process.env.CONNECTION_RECONCILE_DISABLED = 'true';
    const supa = createMockSupabase();
    const out = await reconcileInstanceStates(supa.client as any, jest.fn() as any);
    expect(out.skipped).toBe(true);
    expect(supa.calls).toHaveLength(0);
  });
});
