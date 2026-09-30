/**
 * /api/cron/send-messages — gruppi WhatsApp come destinatario (D8-D11, D13, D20).
 * Stesso harness di send-messages-fixes: ogni select di scheduled_messages è
 * distinta dalla sua catena. Numeri e JID finti.
 */
import { createMockSupabase, createFetchMock } from './helpers/mocks';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

const OWNER = '393501234567';
const GROUP = '120363000000000001@g.us';
const GROUP_NAME = 'Under 12 – Genitori';

let pendingRows: any[] = [];
let sentToRecipient: any[] = [];
let claimLost = false;
let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

function has(call: any, method: string, col?: string, val?: any) {
  return call.chain.some((m: any) => m.method === method && (col === undefined || m.args[0] === col) && (val === undefined || m.args[1] === val));
}

function installDb() {
  mockSupa.setHandler('scheduled_messages:select', (call: any) => {
    if (String(call.args[0]).startsWith('*, user_instances')) return { data: pendingRows, error: null };
    if (has(call, 'eq', 'status', 'sent') && has(call, 'gte', 'sent_at')) return { data: sentToRecipient, error: null, count: sentToRecipient.length } as any;
    return { data: [], error: null, count: 0 } as any;
  });
  mockSupa.setHandler('scheduled_messages:update', (call: any) => {
    if (claimLost && call.args[0]?.status === 'processing') return { data: [], error: null };
    return { data: [{ id: 'x' }], error: null };
  });
  mockSupa.setHandler('user_instances:update', () => ({ data: [{ id: 'ui' }], error: null }));
  mockSupa.setRpcResponse('claim_daily_quota', 1);
  mockSupa.setRpcResponse('rate_limit_record', {
    key: 'default', minute_count: 1, minute_reset: Date.now() + 60000, daily_count: 1,
    daily_reset: Date.now() + 86400000, blocked: false, block_reason: null,
  });
}

function groupInfo(over: any = {}) {
  return {
    id: GROUP,
    subject: GROUP_NAME,
    size: 19,
    announce: false,
    isCommunity: false,
    participants: [{ id: OWNER + '@s.whatsapp.net', admin: null }, { id: '393331234567@s.whatsapp.net', admin: 'admin' }],
    ...over,
  };
}

beforeEach(() => {
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  pendingRows = []; sentToRecipient = []; claimLost = false;
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    CRON_SECRET: 'test-secret',
    AUTH_COOKIE_SECRET: 'f'.repeat(128),
    GROUPS_ENABLED: 'true',
    NEW_RECIPIENTS_DISABLED: 'true',
    WARMUP_RAMP_DISABLED: 'true',
  };
  delete process.env.GROUPS_ONLY_FOR;
  delete process.env.OWNER_SENT_NOTIFY_ENABLED;
  (global as any).fetch = fetchMock.mockFetch;
  jest.spyOn(Math, 'random').mockReturnValue(0); // jitter minimo: 800 ms
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  installDb();
  fetchMock.setJsonResponse('/message/sendText/', { key: { id: 'evo-1' } });
  fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo());
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
    recipient_number: GROUP,
    recipient_name: GROUP_NAME,
    parsed_message: 'Ciao {nome}, domani allenamento alle 18',
    instance_phone: OWNER,
    wa_message_id: null,
    user_instances: {
      id: 'ui-1', phone_number: OWNER, instance_name: 'SchedWhats-' + OWNER,
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
  const req: any = { url: 'https://x/api/cron/send-messages?secret=test-secret', headers: { get: () => null } };
  const res = await GET(req);
  return res.json();
}

const msgUpdates = (id = 'msg-1') => mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'update'
  && c.chain.some((m) => m.method === 'eq' && m.args[0] === 'id' && m.args[1] === id));
const updateWith = (pred: (a: any) => boolean, id?: string) => msgUpdates(id).find((u) => pred(u.args[0]));
const sendCalls = () => fetchMock.calls.filter((c) => /\/message\/send(Text|Media)\//.test(c.url));
const lookupCalls = () => fetchMock.calls.filter((c) => c.url.includes('/group/findGroupInfos/'));
const rpcCalls = (name: string) => mockSupa.calls.filter((c) => c.table === '__rpc__' && c.operation === name);
const auditOf = (type: string) => mockSupa.calls.filter((c) => c.table === 'audit_events' && c.operation === 'insert' && c.args[0]?.event_type === type);
const allLogs = () => [...logSpy.mock.calls, ...warnSpy.mock.calls].map((c) => c.map(String).join(' ')).join('\n');

function failSendWith(status: number, body: string) {
  fetchMock.setHandler('/message/sendText/', () => ({
    ok: false, status, json: async () => ({}), text: async () => body, headers: new Headers(),
  }));
}
function failSendWithTypeError(code: string) {
  fetchMock.setHandler('/message/sendText/', () => {
    const e: any = new TypeError('fetch failed');
    e.cause = { code, name: 'Error' };
    throw e;
  });
}

jest.setTimeout(20_000);

describe('invio in un gruppo', () => {
  test('sendText col JID, niente "sta scrivendo", {nome} tolto anche con recipient_name, timeout 25 s', async () => {
    pendingRows = [makeRow()];
    const spy = jest.spyOn(global, 'setTimeout');
    const body = await runCron();
    expect(body.sent).toBe(1);
    expect(fetchMock.calls.some((c) => c.url.includes('/chat/sendPresence/'))).toBe(false);
    const sent = JSON.parse(String(sendCalls()[0].options.body));
    expect(sent.number).toBe(GROUP);
    expect(sent.text).toBe('Ciao, domani allenamento alle 18');
    expect(sent.text).not.toMatch(/nome|Under/);
    expect(spy.mock.calls.some((c) => c[1] === 25_000)).toBe(true);
  });

  test('message_sent con recipient_kind "group"; nessun log contiene il JID', async () => {
    pendingRows = [makeRow()];
    await runCron();
    const audit = auditOf('message_sent');
    expect(audit).toHaveLength(1);
    expect(audit[0].args[0].payload.recipient_kind).toBe('group');
    expect(allLogs()).not.toMatch(/@g\.us/);
    expect(allLogs()).not.toContain('120363000000000001');
  });

  test('persona: "sta scrivendo" e {nome} come prima (regressione)', async () => {
    pendingRows = [makeRow({ recipient_number: '393401234567', recipient_name: 'Marco Rossi' })];
    await runCron();
    expect(fetchMock.calls.some((c) => c.url.includes('/chat/sendPresence/'))).toBe(true);
    expect(JSON.parse(String(sendCalls()[0].options.body)).text).toBe('Ciao Marco, domani allenamento alle 18');
    expect(lookupCalls()).toHaveLength(0);
    expect(auditOf('message_sent')[0].args[0].payload.recipient_kind).toBe('person');
  });
});

describe('controllo di appartenenza dopo il claim (D8)', () => {
  test('claim perso → nessuna findGroupInfos, nessun invio', async () => {
    claimLost = true;
    pendingRows = [makeRow()];
    await runCron();
    expect(lookupCalls()).toHaveLength(0);
    expect(sendCalls()).toHaveLength(0);
  });

  test('findGroupInfos parte dopo il claim "processing" e prima di claim_daily_quota', async () => {
    pendingRows = [makeRow()];
    await runCron();
    expect(lookupCalls()).toHaveLength(1);
    expect(lookupCalls()[0].url).toContain('groupJid=' + encodeURIComponent(GROUP));
    const claimIdx = mockSupa.calls.findIndex((c) => c.table === 'scheduled_messages' && c.operation === 'update' && c.args[0]?.status === 'processing');
    const quotaIdx = mockSupa.calls.findIndex((c) => c.table === '__rpc__' && c.operation === 'claim_daily_quota');
    expect(claimIdx).toBeGreaterThan(-1);
    expect(quotaIdx).toBeGreaterThan(claimIdx);
  });

  test('due righe verso lo stesso gruppo nello stesso giro → una sola findGroupInfos', async () => {
    pendingRows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
    const body = await runCron();
    expect(lookupCalls()).toHaveLength(1);
    expect(body.sent).toBe(2);
  });

  test('non membro → paused col testo, filtrato su processing; niente invio né quota', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', { status: 404, error: 'Not Found', response: { message: ['item-not-found'] } }, 404);
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(0);
    const upd = updateWith((a) => a.status === 'paused')!;
    expect(upd.args[0].error_message).toBe('In pausa: non risulti più nel gruppo «' + GROUP_NAME + '» (o il gruppo non esiste più). Se ci rientri, tocca Riprendi.');
    expect(upd.args[0].send_attempted_at).toBeNull();
    expect(has(upd, 'eq', 'status', 'processing')).toBe(true);
    expect(sendCalls()).toHaveLength(0);
    expect(rpcCalls('claim_daily_quota')).toHaveLength(0);
  });

  test('solo amministratori e utente membro → paused col testo admin', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ announce: true }));
    pendingRows = [makeRow()];
    await runCron();
    const upd = updateWith((a) => a.status === 'paused')!;
    expect(upd.args[0].error_message).toBe('In pausa: nel gruppo «' + GROUP_NAME + '» ora scrivono solo gli amministratori.');
    expect(sendCalls()).toHaveLength(0);
  });

  test('solo amministratori e utente non trovato tra i partecipanti ("unknown") → nel cron parte', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ announce: true, participants: [{ id: '393331234567@s.whatsapp.net', admin: 'superadmin' }] }));
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(1);
  });

  test('community → paused col testo community', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ isCommunity: true }));
    pendingRows = [makeRow()];
    await runCron();
    expect(updateWith((a) => a.status === 'paused')!.args[0].error_message).toMatch(/è una community/);
    expect(sendCalls()).toHaveLength(0);
  });

  test('controllo in timeout → invio normale', async () => {
    fetchMock.setHandler('/group/findGroupInfos/', () => { const e: any = new Error('timeout'); e.name = 'TimeoutError'; throw e; });
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(1);
  });

  // Controllo senza risposta: di norma si prosegue (D8), ma non dopo un
  // "rate-overlimit" di WhatsApp né durante la rampa (gruppo di dimensione ignota).
  const RETRY_TEXT = 'Controllo del gruppo non riuscito (WhatsApp non ha risposto): si riprova più tardi, per proteggere il tuo WhatsApp';
  function expectRequeuedSoon() {
    const upd = updateWith((a) => a.error_message === RETRY_TEXT)!;
    expect(upd).toBeDefined();
    expect(upd.args[0].status).toBe('pending');
    expect(upd.args[0].send_attempted_at).toBeNull();
    expect(new Date(upd.args[0].scheduled_at).getTime()).toBeGreaterThanOrEqual(Date.now() + 14 * 60_000);
    expect(has(upd, 'eq', 'status', 'processing')).toBe(true);
    expect(sendCalls()).toHaveLength(0);
    expect(rpcCalls('claim_daily_quota')).toHaveLength(0);
    expect(updateWith((a) => a.status === 'failed')).toBeUndefined();
  }

  test('controllo con "rate-overlimit" → niente invio, di nuovo in coda più tardi, niente quota', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', { status: 404, error: 'Not Found', response: { message: ['Error fetching group', 'Error: rate-overlimit'] } }, 404);
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(0);
    expectRequeuedSoon();
  });

  test.each([
    ['timeout', () => { const e: any = new Error('timeout'); e.name = 'TimeoutError'; throw e; }],
    ['500', () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'Internal Server Error', headers: new Headers() })],
  ])('warm-up (collegato ieri) e controllo senza risposta (%s) → niente invio, di nuovo in coda più tardi', async (_label, handler) => {
    delete process.env.WARMUP_RAMP_DISABLED;
    fetchMock.setHandler('/group/findGroupInfos/', handler as any);
    pendingRows = [makeRow({ user_instances: { paired_at: new Date(Date.now() - 86_400_000).toISOString() } })];
    const body = await runCron();
    expect(body.sent).toBe(0);
    expectRequeuedSoon();
  });

  test('fuori dalla rampa, controllo in errore 500 → invio normale', async () => {
    fetchMock.setHandler('/group/findGroupInfos/', () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'Internal Server Error', headers: new Headers() }));
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(1);
  });

  test('nome del gruppo cambiato → recipient_name aggiornato', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ subject: 'Under 12 – Genitori 2026' }));
    pendingRows = [makeRow()];
    await runCron();
    expect(updateWith((a) => a.recipient_name !== undefined)!.args[0]).toEqual({ recipient_name: 'Under 12 – Genitori 2026' });
  });

  test('warm-up (collegato ieri): gruppo di 60 → domattina col motivo; gruppo di 30 → parte', async () => {
    delete process.env.WARMUP_RAMP_DISABLED;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ size: 60 }));
    pendingRows = [makeRow({ user_instances: { paired_at: yesterday } })];
    let body = await runCron();
    expect(body.sent).toBe(0);
    const upd = updateWith((a) => a.error_message === 'Gruppo con più di 50 persone: nei primi giorni dal collegamento si aspetta — riprogrammato a domattina')!;
    expect(upd.args[0].status).toBe('pending');
    expect(upd.args[0].send_attempted_at).toBeNull();
    expect(new Date(upd.args[0].scheduled_at).getTime()).toBeGreaterThan(Date.now());
    expect(has(upd, 'eq', 'status', 'processing')).toBe(true);
    expect(sendCalls()).toHaveLength(0);

    mockSupa.calls.length = 0; fetchMock.calls.length = 0;
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ size: 30 }));
    body = await runCron();
    expect(body.sent).toBe(1);
  });
});

describe('interruttori e origine (D13, D20)', () => {
  test('GROUPS_ENABLED assente → paused col testo dell\'interruttore, nessuna chiamata a Evolution', async () => {
    delete process.env.GROUPS_ENABLED;
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.sent).toBe(0);
    const upd = updateWith((a) => a.status === 'paused')!;
    expect(upd.args[0].error_message).toBe('In pausa: gli invii nei gruppi sono sospesi per ora. Tocca Riprendi più tardi.');
    expect(has(upd, 'eq', 'status', 'pending')).toBe(true);
    expect(fetchMock.calls.filter((c) => c.url.startsWith('https://evo.test'))).toHaveLength(0);
  });

  test('GROUPS_ENABLED assente: una persona parte come sempre', async () => {
    delete process.env.GROUPS_ENABLED;
    pendingRows = [makeRow({ recipient_number: '393401234567', recipient_name: 'Marco' })];
    const body = await runCron();
    expect(body.sent).toBe(1);
  });

  test('riga di gruppo nata dalla chat con se stessi (wa_message_id) → paused', async () => {
    pendingRows = [makeRow({ wa_message_id: 'wamid-1' })];
    await runCron();
    expect(updateWith((a) => a.status === 'paused')!.args[0].error_message).toBe('In pausa: i messaggi nei gruppi si programmano solo dall\'app.');
    expect(fetchMock.calls.filter((c) => c.url.startsWith('https://evo.test'))).toHaveLength(0);
  });
});

describe('invio fallito in un gruppo (D10)', () => {
  test('controllo in timeout + sendText 400 [object Object] → paused "non risulti più", rimborso, niente failed né avviso', async () => {
    fetchMock.setHandler('/group/findGroupInfos/', () => { const e: any = new Error('timeout'); e.name = 'TimeoutError'; throw e; });
    failSendWith(400, '{"status":400,"error":"Bad Request","response":{"message":["[object Object]"]}}');
    pendingRows = [makeRow({ retry_count: 1 })];
    const body = await runCron();
    expect(body.failed).toBe(0);
    const upd = updateWith((a) => a.status === 'paused')!;
    expect(upd.args[0].error_message).toMatch(/^In pausa: non risulti più nel gruppo «Under 12 – Genitori»/);
    expect(upd.args[0].send_attempted_at).toBeNull();
    expect(rpcCalls('refund_daily_quota')).toHaveLength(1);
    expect(msgUpdates().some((u) => u.args[0].status === 'failed' || u.args[0].retry_count !== undefined)).toBe(false);
    expect(sendCalls()).toHaveLength(1); // solo l'invio fallito, nessun avviso al proprietario
  });

  test('sendText 400 not-acceptable → paused col testo #2521', async () => {
    failSendWith(400, '{"status":400,"response":{"message":["Error: not-acceptable"]}}');
    pendingRows = [makeRow()];
    await runCron();
    expect(updateWith((a) => a.status === 'paused')!.args[0].error_message).toMatch(/^In pausa: WhatsApp non è riuscito a mandare il messaggio nel gruppo «Under 12 – Genitori»/);
    expect(rpcCalls('refund_daily_quota')).toHaveLength(1);
  });

  test.each([
    ['502', 502, 'Bad Gateway'],
    ['400 PrismaClient', 400, '{"response":{"message":["PrismaClientKnownRequestError: boom"]}}'],
  ])('%s → sent con send_indeterminate, niente rimborso né retry', async (_l, status, text) => {
    failSendWith(status as number, text as string);
    pendingRows = [makeRow()];
    await runCron();
    const upd = updateWith((a) => a.status === 'sent')!;
    expect(upd.args[0].error_message).toMatch(/^send_indeterminate: /);
    expect(rpcCalls('refund_daily_quota')).toHaveLength(0);
    expect(msgUpdates().some((u) => u.args[0].retry_count !== undefined)).toBe(false);
  });

  test('500 → retry come oggi', async () => {
    failSendWith(500, '{"status":500,"error":"Internal Server Error"}');
    pendingRows = [makeRow()];
    await runCron();
    const upd = updateWith((a) => a.retry_count !== undefined)!;
    expect(upd.args[0]).toMatchObject({ status: 'pending', retry_count: 1 });
    expect(rpcCalls('refund_daily_quota')).toHaveLength(1);
  });

  test('502 su una persona → retry come oggi (regressione)', async () => {
    failSendWith(502, 'Bad Gateway');
    pendingRows = [makeRow({ recipient_number: '393401234567', recipient_name: 'Marco' })];
    await runCron();
    expect(updateWith((a) => a.retry_count !== undefined)!.args[0]).toMatchObject({ status: 'pending', retry_count: 1 });
    expect(msgUpdates().some((u) => u.args[0].status === 'sent')).toBe(false);
  });

  test.each(['ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'])('%s su un gruppo → retry', async (code) => {
    failSendWithTypeError(code);
    pendingRows = [makeRow()];
    await runCron();
    expect(updateWith((a) => a.retry_count !== undefined)!.args[0]).toMatchObject({ status: 'pending', retry_count: 1 });
  });

  test('ECONNRESET su un gruppo → incerto (sent), nessun retry', async () => {
    failSendWithTypeError('ECONNRESET');
    pendingRows = [makeRow()];
    await runCron();
    expect(updateWith((a) => a.status === 'sent')!.args[0].error_message).toMatch(/^send_indeterminate/);
  });

  test('3° retry fallito su un gruppo → failed, audit con recipient_kind group, nessun avviso al proprietario', async () => {
    failSendWith(500, '{"status":500,"error":"Internal Server Error"}');
    pendingRows = [makeRow({ retry_count: 2 })];
    const body = await runCron();
    expect(body.failed).toBe(1);
    expect(updateWith((a) => a.status === 'failed')).toBeDefined();
    const audit = auditOf('message_failed');
    expect(audit).toHaveLength(1);
    expect(audit[0].args[0].payload.recipient_kind).toBe('group');
    expect(sendCalls()).toHaveLength(1);
    expect(sendCalls().some((c) => String(c.options.body).includes('Impossibile inviare'))).toBe(false);
  });

  test('3° retry fallito su una persona → avviso al proprietario come prima (regressione)', async () => {
    failSendWith(500, '{"status":500,"error":"Internal Server Error"}');
    pendingRows = [makeRow({ retry_count: 2, recipient_number: '393401234567', recipient_name: 'Marco' })];
    await runCron();
    expect(sendCalls().some((c) => String(c.options.body).includes('Impossibile inviare a Marco'))).toBe(true);
  });
});

describe('freni (D9)', () => {
  test('cooldown su un gruppo → "nello stesso gruppo"', async () => {
    sentToRecipient = [
      { sent_at: new Date(Date.now() - 3 * 3600_000).toISOString() },
      { sent_at: new Date(Date.now() - 2 * 3600_000).toISOString() },
      { sent_at: new Date(Date.now() - 1 * 3600_000).toISOString() },
    ];
    pendingRows = [makeRow()];
    const body = await runCron();
    expect(body.rateLimited).toBe(1);
    expect(msgUpdates()[0].args[0].error_message).toMatch(/^Massimo 3 messaggi in 24 ore nello stesso gruppo: parte /);
    expect(allLogs()).not.toMatch(/@g\.us/);
  });

  describe('corsia lenta: il primo invio a un gruppo conta come un destinatario nuovo', () => {
    let groupSentBefore = 0;
    beforeEach(() => {
      delete process.env.NEW_RECIPIENTS_DISABLED;
      groupSentBefore = 0;
      mockSupa.setHandler('scheduled_messages:select', (call: any) => {
        if (String(call.args[0]).startsWith('*, user_instances')) return { data: pendingRows, error: null };
        // isKnownRecipient: invii 'sent' precedenti verso il gruppo
        if (call.args[0] === 'id' && has(call, 'eq', 'recipient_number', GROUP) && has(call, 'eq', 'status', 'sent')) return { data: null, error: null, count: groupSentBefore } as any;
        // countNewRecipientsSentToday: 5 numeri nuovi già scritti oggi
        if (call.args[0] === 'recipient_number' && has(call, 'gte', 'sent_at')) {
          return { data: ['1', '2', '3', '4', '5'].map((d) => ({ recipient_number: '39340000000' + d })), error: null } as any;
        }
        return { data: [], error: null, count: 0 } as any;
      });
      mockSupa.setResponse('whatsapp_contacts:select', [], null, { count: 0 });
    });

    test('corsia piena e gruppo mai scritto → domattina', async () => {
      pendingRows = [makeRow()];
      const body = await runCron();
      expect(body.rateLimited).toBe(1);
      expect(msgUpdates()[0].args[0].error_message).toMatch(/^Numeri nuovi/);
      expect(lookupCalls()).toHaveLength(0);
    });

    test('gruppo già scritto ieri → parte', async () => {
      groupSentBefore = 1;
      pendingRows = [makeRow()];
      const body = await runCron();
      expect(body.sent).toBe(1);
    });
  });
});
