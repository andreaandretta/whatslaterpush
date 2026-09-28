/**
 * /api/cron/send-messages — scenari reali dell'audit 25 set 2026.
 *
 * Harness indipendente da cron.integration.test.ts (che ha 5 test rossi noti
 * perché non simula claim_daily_quota): qui ogni select di scheduled_messages
 * è distinta dalla sua catena, così ogni scenario controlla solo ciò che serve.
 */
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

// Stato configurabile per scenario
let pendingRows: any[] = [];
let failedRows: any[] = [];          // righe 'failed' viste da checkFailures
let sentToRecipient: any[] = [];     // righe 'sent' viste dal cool-down
let storageFiles: Record<string, any[]> = {};

const HELD = 'Istanza disconnessa, retry 3/12 fra 5 min'; // motivo scritto dal cron in scaletta
const EXISTS_FALSE = 'HTTP 400: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"390811234567@s.whatsapp.net","exists":false,"number":"390811234567"}]}}';

function has(call: any, method: string, col?: string, val?: any) {
  return call.chain.some((m: any) => m.method === method && (col === undefined || m.args[0] === col) && (val === undefined || m.args[1] === val));
}

function installDb() {
  mockSupa.setHandler('scheduled_messages:select', (call: any) => {
    if (String(call.args[0]).startsWith('*, user_instances')) return { data: pendingRows, error: null };
    if (has(call, 'eq', 'status', 'failed')) {
      // Come PostgREST: ogni .gte(col, v) filtra davvero (solo sulle righe che
      // hanno la colonna, così i test vecchi senza timestamp restano uguali).
      const gtes = call.chain.filter((m: any) => m.method === 'gte');
      const rows = failedRows.filter((r) => gtes.every((g: any) => r[g.args[0]] === undefined || String(r[g.args[0]]) >= String(g.args[1])));
      return { data: rows, error: null, count: rows.length } as any;
    }
    if (has(call, 'eq', 'status', 'sent') && has(call, 'gte', 'sent_at')) return { data: sentToRecipient, error: null, count: sentToRecipient.length } as any;
    return { data: [], error: null, count: 0 } as any;
  });
  mockSupa.setHandler('scheduled_messages:update', () => ({ data: [{ id: 'x' }], error: null }));
  mockSupa.setHandler('user_instances:update', () => ({ data: [{ id: 'ui' }], error: null }));
  mockSupa.setRpcResponse('claim_daily_quota', 1);
  mockSupa.setRpcResponse('rate_limit_record', {
    key: 'default', minute_count: 1, minute_reset: Date.now() + 60000, daily_count: 1,
    daily_reset: Date.now() + 86400000, blocked: false, block_reason: null,
  });
}

const storageClient = {
  from: (_b: string) => ({
    createSignedUrl: async (path: string) => ({ data: { signedUrl: 'https://supa.test/sign/' + path }, error: null }),
    list: async (prefix: string, opts?: any) => {
      const files = storageFiles[prefix] || [];
      const search = opts?.search;
      return { data: search ? files.filter((f) => f.name === search) : files, error: null };
    },
  }),
};

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  pendingRows = []; failedRows = []; sentToRecipient = []; storageFiles = {};
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    CRON_SECRET: 'test-secret',
    NEW_RECIPIENTS_DISABLED: 'true',
    WARMUP_RAMP_DISABLED: 'true',
  };
  (mockSupa.client as any).storage = storageClient;
  (global as any).fetch = fetchMock.mockFetch;
  jest.spyOn(Math, 'random').mockReturnValue(0); // jitter minimo: 800 ms
  installDb();
  fetchMock.setJsonResponse('/message/sendText/', { key: { id: 'evo-1' } });
  fetchMock.setJsonResponse('/message/sendMedia/', { key: { id: 'evo-m' } });
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function makeRow(over: any = {}) {
  const { user_instances: inst, ...rest } = over;
  return {
    id: 'msg-1',
    scheduled_at: new Date(Date.now() - 60_000).toISOString(),
    status: 'pending',
    retry_count: 0,
    disconnect_retry_count: 0,
    recipient_number: '393401234567',
    recipient_name: 'Marco',
    parsed_message: 'Ciao',
    instance_phone: '393501234567',
    user_instances: {
      id: 'ui-1', phone_number: '393501234567', instance_name: 'SchedWhats-393501234567',
      trial_ends_at: null, subscription_plan: 'personal', connection_status: 'open',
      messages_sent_today: 0, upsell_sent_today: false, paired_at: null,
      ...inst,
    },
    ...rest,
  };
}

async function runCron() {
  jest.resetModules();
  jest.doMock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));
  const { GET } = await import('../app/api/cron/send-messages/route');
  const req: any = {
    url: 'https://x/api/cron/send-messages?secret=test-secret',
    headers: { get: () => null },
  };
  const res = await GET(req);
  return res.json();
}

const msgUpdates = (id?: string) => mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'update'
  && (!id || c.chain.some((m) => m.method === 'eq' && m.args[0] === 'id' && m.args[1] === id)));
const sendCalls = () => fetchMock.calls.filter((c) => /\/message\/send(Text|Media)\//.test(c.url));

// Fake SOLO l'orologio (Date): i setTimeout di jitter/timeout restano veri.
function freezeClock(iso: string) {
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'] });
  jest.setSystemTime(new Date(iso));
}

jest.setTimeout(20_000);

describe('circuit breaker: 5 numeri sbagliati non congelano i promemoria ai clienti validi', () => {
  test('5 righe failed exists:false nelle 24h → il messaggio al cliente valido PARTE', async () => {
    failedRows = ['390811', '390812', '390813', '390814', '390815'].map((r) => ({ recipient_number: r, error_message: EXISTS_FALSE }));
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(1);
    expect(fetchMock.calls.some((c) => c.url.includes('/message/sendText/') && String(c.options.body).includes('Messaggi sospesi'))).toBe(false);
  });

  test('5 guasti di trasporto verso 5 clienti diversi → il breaker scatta ancora', async () => {
    failedRows = ['1', '2', '3', '4', '5'].map((r) => ({ recipient_number: '39340000000' + r, error_message: 'HTTP 500: Internal Server Error' }));
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(0);
    expect(body.rateLimited).toBe(1);
    const upd = msgUpdates('msg-1')[0];
    expect(upd.args[0].error_message).toMatch(/Invii sospesi/);
  });

  test('BUG: domenica la pulizia allegati tocca 5 righe fallite un mese fa (updated_at = adesso) → il breaker NON scatta', async () => {
    const monthAgo = new Date(Date.now() - 35 * 86400000).toISOString();
    const justNow = new Date(Date.now() - 3 * 3600000).toISOString();
    failedRows = ['1', '2', '3', '4', '5'].map((r) => ({
      recipient_number: '39340000000' + r, error_message: 'HTTP 500: Internal Server Error',
      created_at: monthAgo, scheduled_at: monthAgo, updated_at: justNow,
    }));
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(1);
    expect(fetchMock.calls.some((c) => String(c.options?.body || '').includes('Messaggi sospesi'))).toBe(false);
  });

  test('guasti VERI di stamattina su un promemoria creato 40 giorni fa → il breaker scatta ancora', async () => {
    const createdLongAgo = new Date(Date.now() - 40 * 86400000).toISOString();
    const thisMorning = new Date(Date.now() - 3 * 3600000).toISOString();
    failedRows = ['1', '2', '3', '4', '5'].map((r) => ({
      recipient_number: '39340000000' + r, error_message: 'HTTP 500: Internal Server Error',
      created_at: createdLongAgo, scheduled_at: thisMorning, updated_at: thisMorning,
    }));
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(0);
    expect(body.rateLimited).toBe(1);
  });

  test('la finestra delle 24h guarda il momento del FALLIMENTO (updated_at), non la creazione', async () => {
    pendingRows = [makeRow()];
    await runCron();
    const q = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.operation === 'select' && has(c, 'eq', 'status', 'failed'))!;
    expect(has(q, 'gte', 'updated_at')).toBe(true);
    expect(has(q, 'gte', 'created_at')).toBe(false);
  });
});

describe('disconnessione', () => {
  test('al 12° giro: niente avviso WhatsApp tramite la STESSA istanza morta; rinvio a domani dentro la fascia 08-21', async () => {
    pendingRows = [makeRow({ disconnect_retry_count: 11, user_instances: { connection_status: 'close' } })];
    const body = await runCron();
    expect(body.disconnected).toBe(1);
    expect(sendCalls()).toHaveLength(0);
    const upd = msgUpdates('msg-1')[0].args[0];
    expect(upd.disconnect_retry_count).toBe(12);
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23' }).format(new Date(upd.scheduled_at)));
    expect(h).toBeGreaterThanOrEqual(8);
    expect(h).toBeLessThan(21);
    expect(new Date(upd.scheduled_at).getTime()).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
  });

  test('BUG: il giorno dopo un blackout lungo (count=12) un "connecting" breve NON rinvia di un altro giorno', async () => {
    pendingRows = [makeRow({ disconnect_retry_count: 12, user_instances: { connection_status: 'connecting' } })];
    await runCron();
    const upd = msgUpdates('msg-1')[0].args[0];
    expect(upd.disconnect_retry_count).toBe(13);
    // +1 minuto (riaggancio Baileys), non +24h
    expect(new Date(upd.scheduled_at).getTime() - Date.now()).toBeLessThan(2 * 60 * 1000);
  });
});

describe('riconnessione: il backlog non esce tutto insieme', () => {
  test('3 righe arretrate dello stesso utente: 1 invio ora, le altre a +90 s / +180 s', async () => {
    pendingRows = [
      makeRow({ id: 'a', disconnect_retry_count: 2, error_message: HELD }),
      makeRow({ id: 'b', disconnect_retry_count: 2, error_message: HELD, recipient_number: '393401111111' }),
      makeRow({ id: 'c', disconnect_retry_count: 2, error_message: HELD, recipient_number: '393402222222' }),
    ];
    const before = Date.now();
    const body = await runCron();
    expect(body.sent).toBe(1);
    expect(sendCalls()).toHaveLength(1);
    const b = msgUpdates('b').find((u) => u.args[0].scheduled_at)!.args[0];
    const c = msgUpdates('c').find((u) => u.args[0].scheduled_at)!.args[0];
    expect(new Date(b.scheduled_at).getTime() - before).toBeGreaterThanOrEqual(90_000);
    expect(new Date(c.scheduled_at).getTime() - before).toBeGreaterThanOrEqual(180_000);
    // Lo spread aggiorna solo righe ancora pending: mai scavalcare un claim.
    expect(msgUpdates('b').find((u) => u.args[0].scheduled_at)!.chain.some((m) => m.method === 'eq' && m.args[0] === 'status' && m.args[1] === 'pending')).toBe(true);
  });

  test('ricollegato a mezzanotte con una riga in ritardo da >30 min → domattina, non alle 00:18', async () => {
    freezeClock('2026-09-27T22:18:00.000Z'); // 00:18 Roma
    pendingRows = [makeRow({ disconnect_retry_count: 9, error_message: HELD })];
    const body = await runCron();
    expect(sendCalls()).toHaveLength(0);
    expect(body.sent).toBe(0);
    const upd = msgUpdates('msg-1')[0].args[0];
    const t = new Date(upd.scheduled_at).getTime();
    expect(t).toBeGreaterThanOrEqual(Date.parse('2026-09-28T06:00:00.000Z')); // 08:00 Roma
    expect(t).toBeLessThanOrEqual(Date.parse('2026-09-28T06:30:00.000Z'));
  });

  test('glitch di 5 minuti alle 22:00: l\'orario scelto dall\'utente resta (parte subito)', async () => {
    freezeClock('2026-09-27T20:05:00.000Z'); // 22:05 Roma
    pendingRows = [makeRow({ disconnect_retry_count: 1, error_message: HELD })];
    const body = await runCron();
    expect(body.sent).toBe(1);
  });

  test('BUG: blip di 18 min in "connecting" (6 giri da 1+1+1+5+5+5) alle 22:00 → parte alle 22:18, non domattina', async () => {
    freezeClock('2026-09-27T20:18:00.000Z'); // 22:18 Roma
    pendingRows = [makeRow({ disconnect_retry_count: 6, error_message: 'Istanza disconnessa, retry 6/12 fra 5 min' })];
    const body = await runCron();
    expect(body.sent).toBe(1);
    expect(msgUpdates('msg-1').some((u) => /fuori orario/.test(String(u.args[0].error_message)))).toBe(false);
  });

  test('BUG: Posticipa "+1 ora" alle 20:40 dopo una disconnessione lunga → parte alle 21:40 scelto dall\'utente', async () => {
    // Il PATCH ha riscritto scheduled_at e azzerato error_message; il contatore
    // della disconnessione è rimasto a 7.
    freezeClock('2026-09-27T19:40:00.000Z'); // 21:40 Roma
    pendingRows = [
      makeRow({ id: 'a', disconnect_retry_count: 7, error_message: null }),
      makeRow({ id: 'b', disconnect_retry_count: 7, error_message: null, recipient_number: '393401111111' }),
    ];
    const body = await runCron();
    expect(body.sent).toBe(2);
    expect(msgUpdates().some((u) => /fuori orario|invii arretrati/.test(String(u.args[0].error_message)))).toBe(false);
  });
});

describe('cool-down 3/24h con orario onesto', () => {
  test('3 inviati allo stesso cliente: riprogrammato all\'uscita del più vecchio dalla finestra, con il motivo vero', async () => {
    freezeClock('2026-09-27T16:00:00.000Z'); // 18:00 Roma
    sentToRecipient = [
      { sent_at: '2026-09-27T07:05:00.000Z' }, // 09:05 Roma
      { sent_at: '2026-09-27T10:00:00.000Z' },
      { sent_at: '2026-09-27T13:00:00.000Z' },
    ];
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.rateLimited).toBe(1);
    const upd = msgUpdates('msg-1')[0].args[0];
    expect(upd.scheduled_at).toBe('2026-09-28T07:05:00.000Z');
    expect(upd.error_message).not.toMatch(/\+30 min/);
    expect(upd.error_message).toMatch(/09:05/);
  });
});

describe('allegati', () => {
  test('timeout proporzionale alla dimensione, mimetype esplicito, niente typing', async () => {
    storageFiles['393501234567'] = [{ name: 'u-circolare.pdf', metadata: { size: 4.5 * 1024 * 1024, mimetype: 'application/pdf' } }];
    pendingRows = [makeRow({ media_url: '393501234567/u-circolare.pdf', media_type: 'document', media_filename: 'circolare.pdf', parsed_message: 'Ecco la circolare di questo mese, leggila con calma' })];
    const spy = jest.spyOn(global, 'setTimeout');
    const body = await runCron();
    expect(body.sent).toBe(1);
    const media = fetchMock.calls.find((c) => c.url.includes('/message/sendMedia/'))!;
    expect(JSON.parse(String(media.options.body)).mimetype).toBe('application/pdf');
    expect(fetchMock.calls.some((c) => c.url.includes('/chat/sendPresence/'))).toBe(false);
    expect(spy.mock.calls.some((c) => c[1] === 18_000)).toBe(true);
  });

  test('timeout su allegato: resta "sent" col marcatore send_timeout_indeterminate (per il "Da verificare")', async () => {
    pendingRows = [makeRow({ media_url: '393501234567/x.mp4', media_type: 'video' })];
    fetchMock.setHandler('/message/sendMedia/', () => { const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; });
    await runCron();
    const upd = msgUpdates('msg-1').map((u) => u.args[0]).find((a) => a.status === 'sent')!;
    expect(upd.error_message).toMatch(/^send_timeout_indeterminate/);
    expect(upd.error_message).toMatch(/40 s/);
  });

  test('allegato tolto dalla pulizia (media_type senza media_url): niente invio del solo testo, riga fallita col motivo', async () => {
    pendingRows = [makeRow({ media_url: null, media_type: 'document', media_filename: 'circolare.pdf', parsed_message: 'Ecco la circolare' })];
    const body = await runCron();
    expect(sendCalls()).toHaveLength(0);
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    const upd = msgUpdates('msg-1').map((u) => u.args[0]).find((a) => a.status === 'failed')!;
    expect(upd.error_message).toMatch(/Allegato non più disponibile/);
    // nessuna quota consumata, nessun avviso al titolare
    expect(mockSupa.calls.some((c) => c.table === '__rpc__' && c.operation === 'claim_daily_quota')).toBe(false);
    expect(fetchMock.calls.some((c) => c.url.includes('/message/sendText/'))).toBe(false);
  });

  test('la route dichiara un maxDuration che contiene il timeout massimo', async () => {
    const mod = await import('../app/api/cron/send-messages/route');
    expect((mod as any).maxDuration).toBeGreaterThanOrEqual(60);
  });
});

describe('invio fallito per istanza disconnessa (DB diceva "open")', () => {
  const closedErr = { status: 400, body: { status: 400, error: 'Bad Request', response: { message: ['Connection Closed'] } } };

  test('Evolution conferma "close" → stato riallineato, riga nella scaletta disconnessione, nessun retry bruciato, nessun avviso via istanza morta', async () => {
    pendingRows = [makeRow({ retry_count: 2 })];
    fetchMock.setJsonResponse('/message/sendText/', closedErr.body, closedErr.status);
    fetchMock.setJsonResponse('/instance/connectionState/', { instance: { instanceName: 'SchedWhats-393501234567', state: 'close' } });
    const body = await runCron();
    expect(body.failed).toBe(0);
    const inst = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update' && 'connection_status' in c.args[0])!;
    expect(inst.args[0]).toEqual({ connection_status: 'close' });
    const upd = msgUpdates('msg-1').map((u) => u.args[0]).find((a) => a.disconnect_retry_count !== undefined)!;
    expect(upd.status).toBe('pending');
    expect(upd.retry_count).toBeUndefined();
    expect(upd.disconnect_retry_count).toBe(1);
    expect(upd.send_attempted_at).toBeNull();
    // un solo sendText: l'invio fallito. Nessun "Impossibile inviare" al titolare.
    expect(fetchMock.calls.filter((c) => c.url.includes('/message/sendText/'))).toHaveLength(1);
  });

  test('Evolution dice "open" → percorso di retry generico come prima', async () => {
    pendingRows = [makeRow({ retry_count: 0 })];
    fetchMock.setJsonResponse('/message/sendText/', closedErr.body, closedErr.status);
    fetchMock.setJsonResponse('/instance/connectionState/', { instance: { state: 'open' } });
    await runCron();
    expect(mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update' && 'connection_status' in c.args[0])).toBeUndefined();
    const upd = msgUpdates('msg-1').map((u) => u.args[0]).find((a) => a.retry_count !== undefined)!;
    expect(upd.retry_count).toBe(1);
    expect(upd.status).toBe('pending');
  });
});

describe('contatore giornaliero: il reset non deve "perdonare" gli invii di oggi', () => {
  test('BUG: data di reset vecchia e 0 invii → il cron la porta a OGGI (Roma), così il reset di metà giornata non azzera i claim di stamattina', async () => {
    freezeClock('2026-09-28T08:00:00.000Z'); // 10:00 Roma
    await runCron();
    const stamp = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update' && 'last_daily_reset_at' in c.args[0]);
    expect(stamp).toBeDefined();
    expect(stamp!.args[0]).toEqual({ last_daily_reset_at: '2026-09-28' });
    // Solo righe dove "azzerare" non cambia niente: 0 invii e upsell non inviato.
    expect(has(stamp, 'eq', 'messages_sent_today', 0)).toBe(true);
    expect(has(stamp, 'eq', 'upsell_sent_today', false)).toBe(true);
    const or = stamp!.chain.find((m: any) => m.method === 'or');
    expect(String(or!.args[0])).toBe('last_daily_reset_at.is.null,last_daily_reset_at.lt.2026-09-28');
    // Dopo il reset RPC (che gestisce le righe con invii > 0), prima degli invii.
    const idxReset = mockSupa.calls.findIndex((c) => c.table === '__rpc__' && c.operation === 'reset_daily_counters');
    expect(mockSupa.calls.indexOf(stamp!)).toBeGreaterThan(idxReset);
  });

  test('a mezzanotte e mezza Roma (22:30 UTC del giorno prima) la data è quella di Roma', async () => {
    freezeClock('2026-09-27T22:30:00.000Z'); // 00:30 Roma del 28
    await runCron();
    const stamp = mockSupa.calls.find((c) => c.table === 'user_instances' && c.operation === 'update' && 'last_daily_reset_at' in c.args[0]);
    expect(stamp!.args[0]).toEqual({ last_daily_reset_at: '2026-09-28' });
  });
});
