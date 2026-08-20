/**
 * TDD — Task 54 (tier pairing-resilience, 20 ago): allarme pairing tarato.
 *
 * Lezione dell'incidente 17-19 ago: il blackout-alert esisteva e ha visto
 * giusto, ma (a) scattava critical solo a >=5 tentativi/24h — i tentativi
 * sporadici reali (1-4/giorno) generavano solo warning silenziosi per
 * settimane; (b) il "Cosa fare" era un suggerimento STATICO scritto a giugno,
 * non l'errore vero; (c) l'email arrivava da mittente anonimo con subject
 * gergale (`pairing_blackout — critical`) e a un solo destinatario.
 *
 * Qui: soglia critical a 2, ultimo errore reale dai log nel messaggio,
 * subject umanizzato + display name mittente + destinatari multipli,
 * recovery email col dettaglio.
 */
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
const fetchMock = createFetchMock();

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupa.client,
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://supa.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-role-key',
    ADMIN_PHONE: '393000000000',
    ADMIN_EMAIL: 'primo@test.it, secondo@test.it',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    RESEND_API_KEY: 're_test',
  };
  mockSupa.setResponse('user_instances:select', null); // nessuna istanza operatore → cascata su email
  fetchMock.setHandler('api.resend.com', async () => ({
    ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '{}',
  }));
  (global as any).fetch = fetchMock.mockFetch;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

import { checkPairingBlackout, sendAlertWithChannel, sendRecovery, dispatchAlert } from '../app/lib/monitoring';

const started = (n: number) => Array.from({ length: n }, () => ({ event_type: 'pairing_started' }));

describe('Task 54 — soglia critical abbassata a 2', () => {
  test('2 tentativi, 0 successi → CRITICAL (prima era warning: settimane di silenzio)', async () => {
    mockSupa.setResponse('audit_events:select', started(2));
    const r = await checkPairingBlackout();
    expect(r.status).toBe('critical');
    expect(r.message).toContain('pairing rotto');
  });

  test('1 tentativo, 0 successi → warning (un singolo utente confuso non è un incidente)', async () => {
    mockSupa.setResponse('audit_events:select', started(1));
    const r = await checkPairingBlackout();
    expect(r.status).toBe('warning');
  });
});

describe('Task 54 — errore reale nel messaggio', () => {
  test('il critical include l\'ultimo instance_disconnect della finestra (reason + code)', async () => {
    mockSupa.setResponse('audit_events:select', [
      ...started(3),
      { event_type: 'instance_disconnect', payload: { instance: 'SchedWhats-393001112223', code: 401, reason: 'loggedOut (dispositivo scollegato da WhatsApp)' } },
    ]);
    const r = await checkPairingBlackout();
    expect(r.status).toBe('critical');
    expect(r.message).toContain('Ultimo errore');
    expect(r.message).toContain('loggedOut');
    expect(r.message).toContain('401');
  });

  test('i disconnect delle istanze di test NON inquinano il dettaglio', async () => {
    mockSupa.setResponse('audit_events:select', [
      ...started(2),
      { event_type: 'instance_disconnect', payload: { instance: 'wltest-p3d', code: 428, reason: 'connectionClosed' } },
    ]);
    const r = await checkPairingBlackout();
    expect(r.status).toBe('critical');
    expect(r.message).not.toContain('Ultimo errore');
  });
});

describe('Task 54 — email umanizzata', () => {
  test('from con display name, subject descrittivo (non gergale), destinatari multipli da ADMIN_EMAIL', async () => {
    await sendAlertWithChannel(
      { name: 'pairing_blackout', status: 'critical', message: '2 tentativi, 0 successi in 24h — pairing rotto', checked_at: new Date().toISOString() } as any,
      ['email']
    );
    const call = fetchMock.calls.find(c => c.url.includes('api.resend.com'));
    expect(call).toBeTruthy();
    const body = JSON.parse(call!.options.body as string);
    expect(body.from).toContain('WhatsLater Monitoring');
    expect(body.subject).toContain('connessioni di nuovi numeri'); // descrizione umana
    expect(body.subject).not.toContain('pairing_blackout');        // niente gergo interno
    expect(body.to).toEqual(['primo@test.it', 'secondo@test.it']);
  });
});

describe('Task 54 — recovery con dettaglio', () => {
  test('la mail di rientro dice QUANTO è rientrato, non solo "risolto"', async () => {
    await sendRecovery(
      { name: 'pairing_blackout', status: 'ok', message: '2/3 pairing riusciti in 24h', checked_at: new Date().toISOString() } as any
    );
    const call = fetchMock.calls.find(c => c.url.includes('api.resend.com'));
    expect(call).toBeTruthy();
    const body = JSON.parse(call!.options.body as string);
    expect(body.text).toContain('2/3 pairing riusciti');
  });
});

// Task 55 (#9 backlog): due health-check concorrenti (Vercel cron + pg_cron/self-cron)
// possono leggere entrambi previousStatus=ok e inviare DUE volte lo stesso onset.
// Stessa classe del doppio-invio messaggi (BUG #1): read-then-write non atomico.
// Fix: claim-before-send su unique index (check_name, minute_bucket) — chi perde
// il claim non invia. Fail-open su errori diversi da 23505 (meglio un alert
// doppio che nessun alert).
describe('Task 55 — claim atomico anti-alert-doppi (#9)', () => {
  const CHECK = { name: 'pairing_blackout', status: 'critical', message: '2 tentativi, 0 successi in 24h — pairing rotto', checked_at: new Date().toISOString() } as any;

  test('claim vinto → alert inviato (email) e claim registrato con minute_bucket', async () => {
    await dispatchAlert(CHECK);
    expect(fetchMock.calls.some(c => c.url.includes('api.resend.com'))).toBe(true);
    const claim = mockSupa.calls.find(c => c.table === 'monitoring_alerts' && c.operation === 'insert' && c.args[0]?.channel === 'claim');
    expect(claim).toBeTruthy();
    expect(typeof claim!.args[0].minute_bucket).toBe('number');
  });

  test('claim perso (23505: un run concorrente ha già inviato) → NESSUN invio', async () => {
    mockSupa.setResponse('monitoring_alerts:insert', null, { code: '23505', message: 'duplicate key value violates unique constraint' });
    await dispatchAlert(CHECK);
    expect(fetchMock.calls.some(c => c.url.includes('api.resend.com'))).toBe(false);
  });

  test('recovery: claim perso → nessun "Risolto" doppio', async () => {
    mockSupa.setResponse('monitoring_alerts:insert', null, { code: '23505', message: 'duplicate key value violates unique constraint' });
    await sendRecovery({ name: 'pairing_blackout', status: 'ok', message: '1/1 pairing riusciti in 24h', checked_at: new Date().toISOString() } as any);
    expect(fetchMock.calls.some(c => c.url.includes('api.resend.com'))).toBe(false);
  });
});
