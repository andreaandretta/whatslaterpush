/**
 * /api/messages — gruppi WhatsApp come destinatario (D1, D2, D7, D11-D13, D21).
 * POST, PATCH e GET su un solo modulo per test (niente resetModules tra le
 * chiamate): la memoria dei controlli recenti di groups.ts vive nel modulo, e
 * "12 POST in fila" deve vederla. Numeri e JID finti.
 */
import { createMockSupabase, createFetchMock, mockRequest } from './helpers/mocks';
import { signCookie, AUTH_COOKIE_NAME } from '../app/lib/auth-cookie';
import { getPlanLimits } from '../app/lib/plans';

const mockSupa = createMockSupabase();
jest.mock('@supabase/supabase-js', () => ({ createClient: () => mockSupa.client }));

const whatsappNumbersMock = jest.fn();
jest.mock('../lib/evolution/client', () => ({ evolutionClient: { whatsappNumbers: whatsappNumbersMock } }));

const fetchMock = createFetchMock();
const ORIGINAL_ENV = process.env;

const OWNER = '393331234567';
const INSTANCE = 'SchedWhats-' + OWNER;
const GROUP = '120363000000000001@g.us';
const OTHER_GROUP = '120363000000000002@g.us';
const GROUP_NAME = 'Under 12 – Genitori';
const PERSON = '393339876543';

let instanceRow: any;
let scheduledContacts: any[];
let recentGroupRows: any[];
let currentRow: any;
let tokenCount: number;

function groupInfo(over: any = {}) {
  return {
    id: GROUP,
    subject: GROUP_NAME,
    size: 19,
    announce: false,
    isCommunity: false,
    participants: [{ id: OWNER + '@s.whatsapp.net', admin: null }, { id: '393330000001@s.whatsapp.net', admin: 'admin' }],
    ...over,
  };
}

function installDb() {
  mockSupa.setHandler('user_instances:select', () => ({ data: instanceRow, error: null }));
  mockSupa.setResponse('pending_contacts:select', []);
  mockSupa.setHandler('scheduled_messages:select', (call: any) => {
    const cols = String(call.args[0]);
    if (cols.startsWith('recipient_number, status')) return { data: scheduledContacts, error: null };
    if (cols === 'recipient_name') return { data: recentGroupRows, error: null };
    if (cols === 'id' && call.args[1]?.head) return { data: null, error: null, count: 0 } as any;
    if (cols === '*') return { data: [], error: null };
    // PATCH: la riga esistente
    if (cols.startsWith('id, instance_phone, status')) return { data: currentRow, error: null };
    return { data: [], error: null };
  });
  mockSupa.setResponse('scheduled_messages:insert', { id: 'new-msg', scheduled_at: new Date(Date.now() + 3600_000).toISOString() });
  mockSupa.setHandler('scheduled_messages:update', (call: any) => ({ data: { ...currentRow, ...call.args[0] }, error: null }));
  mockSupa.setRpcHandler('rate_limit_record', () => ({
    data: { key: 'k', minute_count: tokenCount, minute_reset: Date.now() + 600_000, daily_count: 1, daily_reset: Date.now() + 86_400_000 },
    error: null,
  }));
}

beforeEach(() => {
  jest.resetModules();
  mockSupa.calls.length = 0;
  fetchMock.calls.length = 0;
  whatsappNumbersMock.mockReset();
  whatsappNumbersMock.mockResolvedValue([{ exists: true }]);
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    AUTH_COOKIE_SECRET: 'a'.repeat(128),
    EVOLUTION_API_URL: 'https://evo.test',
    EVOLUTION_API_KEY: 'evo-key',
    GROUPS_ENABLED: 'true',
  };
  delete process.env.GROUPS_ONLY_FOR;
  (global as any).fetch = fetchMock.mockFetch;
  instanceRow = { id: 'ui-1', subscription_plan: 'personal', instance_name: INSTANCE, connection_status: 'open' };
  scheduledContacts = [];
  recentGroupRows = [];
  currentRow = null;
  tokenCount = 1;
  installDb();
  fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo());
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.restoreAllMocks();
});

async function loadRoute() {
  return import('../app/api/messages/route');
}

async function authedReq(body: any) {
  const cookie = await signCookie({ phone: OWNER, instanceName: INSTANCE });
  const req: any = mockRequest(body, { 'Content-Type': 'application/json' });
  req.cookies = { get: (n: string) => (n === AUTH_COOKIE_NAME ? { value: cookie } : undefined) };
  return req;
}

const at = () => new Date(Date.now() + 3600_000).toISOString();
const postBody = (over: any = {}) => ({ recipient_number: GROUP, recipient_name: 'Nome dal client', message: 'Domani allenamento alle 18', scheduled_at: at(), ...over });

async function post(body: any, route?: any) {
  const { POST } = route || await loadRoute();
  const res = await POST(await authedReq(body));
  return { status: res.status, body: await res.json() };
}
async function patch(body: any) {
  const { PATCH } = await loadRoute();
  const res = await PATCH(await authedReq(body));
  return { status: res.status, body: await res.json() };
}

const lookupCalls = () => fetchMock.calls.filter((c) => c.url.includes('/group/findGroupInfos/'));
const inserts = () => mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'insert');
const msgUpdates = () => mockSupa.calls.filter((c) => c.table === 'scheduled_messages' && c.operation === 'update');
const auditOf = (type: string) => mockSupa.calls.filter((c) => c.table === 'audit_events' && c.operation === 'insert' && c.args[0]?.event_type === type);

describe('POST /api/messages — riconoscimento del destinatario (D2)', () => {
  test.each(['12345@g.us', 'status@broadcast', '120363000000000001@newsletter', '123456789012345@lid'])('%s → 400 invalid_phone', async (raw) => {
    const r = await post(postBody({ recipient_number: raw }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_phone');
    expect(lookupCalls()).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  test('gruppi spenti: il testo di invalid_phone resta quello di sempre', async () => {
    delete process.env.GROUPS_ENABLED;
    const r = await post(postBody({ recipient_number: '12345@g.us' }));
    expect(r.body.message).toBe('Si può programmare un messaggio solo verso un numero di telefono.');
  });
});

describe('POST /api/messages — gruppo valido', () => {
  test('membro → 200: JID e nome dal server, niente whatsappNumbers né rubrica, audit e risposta con recipient_kind', async () => {
    const r = await post(postBody({ recipient_number: '  ' + GROUP.toUpperCase() + ' ', manual_entry: true }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recipient_kind: 'group', recipient_name: GROUP_NAME, status: 'pending' });
    const ins = inserts()[0].args[0];
    expect(ins.recipient_number).toBe(GROUP);
    expect(ins.recipient_name).toBe(GROUP_NAME);
    expect(lookupCalls()).toHaveLength(1);
    expect(lookupCalls()[0].url).toBe('https://evo.test/group/findGroupInfos/' + INSTANCE + '?groupJid=' + encodeURIComponent(GROUP));
    expect(whatsappNumbersMock).not.toHaveBeenCalled();
    expect(mockSupa.calls.some((c) => c.table === 'whatsapp_contacts')).toBe(false);
    expect(auditOf('schedule_created')[0].args[0].payload.recipient_kind).toBe('group');
    // il gettone "check" si consuma per il controllo live
    const rpc = mockSupa.calls.filter((c) => c.table === '__rpc__' && c.operation === 'rate_limit_record');
    expect(rpc).toHaveLength(1);
    expect(rpc[0].args[0].p_key).toMatch(/^grp:check:[0-9a-f]{16}$/);
  });

  test('connection_status "connecting" → controllo live e 200', async () => {
    instanceRow.connection_status = 'connecting';
    const r = await post(postBody());
    expect(r.status).toBe(200);
    expect(lookupCalls()).toHaveLength(1);
  });

  test('gruppo senza nome → recipient_name null (mai le cifre del JID)', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ subject: '   ' }));
    const r = await post(postBody());
    expect(r.status).toBe(200);
    expect(inserts()[0].args[0].recipient_name).toBeNull();
  });

  test('persona: nessun controllo di gruppo, recipient_kind "person" (regressione)', async () => {
    const r = await post(postBody({ recipient_number: PERSON, recipient_name: 'Marco' }));
    expect(r.status).toBe(200);
    expect(r.body.recipient_kind).toBe('person');
    expect(inserts()[0].args[0].recipient_name).toBe('Marco');
    expect(lookupCalls()).toHaveLength(0);
    expect(whatsappNumbersMock).toHaveBeenCalledWith(INSTANCE, [PERSON]);
  });
});

describe('POST /api/messages — controllo live che blocca (D7)', () => {
  test('404 + forbidden → 400 recipient_not_group_member, nessun insert', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', { status: 404, error: 'Not Found', response: { message: ['forbidden'] } }, 404);
    const r = await post(postBody());
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('recipient_not_group_member');
    expect(r.body.message).toMatch(/Non fai parte di questo gruppo/);
    expect(inserts()).toHaveLength(0);
  });

  test.each([
    ['timeout', () => { const e: any = new Error('timeout'); e.name = 'TimeoutError'; throw e; }],
    ['500', () => ({ ok: false, status: 500, text: async () => 'Internal Server Error', json: async () => ({}), headers: new Headers() })],
    ['overlimit', () => ({ ok: false, status: 404, text: async () => '{"response":{"message":["rate-overlimit"]}}', json: async () => ({}), headers: new Headers() })],
  ])('%s → 503 group_check_unavailable, nessun insert', async (_l, handler) => {
    fetchMock.setHandler('/group/findGroupInfos/', handler as any);
    const r = await post(postBody());
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('group_check_unavailable');
    expect(inserts()).toHaveLength(0);
  });

  test('solo amministratori e utente membro → 400 group_admins_only', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ announce: true }));
    const r = await post(postBody());
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('group_admins_only');
    expect(inserts()).toHaveLength(0);
  });

  test('solo amministratori e utente admin → 200', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ announce: true, participants: [{ id: OWNER + '@s.whatsapp.net', admin: 'superadmin' }] }));
    expect((await post(postBody())).status).toBe(200);
  });

  test('community → 400 group_is_community', async () => {
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ isCommunity: true }));
    const r = await post(postBody());
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('group_is_community');
  });

  test('WhatsApp scollegato → 409 senza chiamare Evolution', async () => {
    instanceRow.connection_status = 'close';
    const r = await post(postBody());
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('whatsapp_disconnected');
    expect(lookupCalls()).toHaveLength(0);
  });

  test('istanza senza nome → 503 senza chiamare Evolution', async () => {
    instanceRow.instance_name = null;
    const r = await post(postBody());
    expect(r.status).toBe(503);
    expect(lookupCalls()).toHaveLength(0);
  });

  test('gettone "check" esaurito (minute_count 11) → 429, nessuna fetch', async () => {
    tokenCount = 11;
    const r = await post(postBody());
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('group_check_rate_limited');
    expect(lookupCalls()).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  test('12 POST in fila verso lo stesso gruppo → una sola findGroupInfos, nessun 429', async () => {
    const route = await loadRoute();
    let n = 0;
    mockSupa.setRpcHandler('rate_limit_record', () => {
      n++;
      return { data: { key: 'k', minute_count: n, minute_reset: Date.now() + 600_000 }, error: null };
    });
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post(postBody(), route)).status);
    expect(statuses).toEqual(Array(12).fill(200));
    expect(lookupCalls()).toHaveLength(1);
    expect(inserts()).toHaveLength(12);
    expect(inserts().every((c) => c.args[0].recipient_name === GROUP_NAME)).toBe(true);
  });

  test('riga dell\'app verso lo stesso gruppo creata 5 min fa (memoria vuota) → nessuna fetch, nome dalla riga', async () => {
    recentGroupRows = [{ recipient_name: GROUP_NAME }];
    const r = await post(postBody());
    expect(r.status).toBe(200);
    expect(lookupCalls()).toHaveLength(0);
    expect(inserts()[0].args[0].recipient_name).toBe(GROUP_NAME);
    const q = mockSupa.calls.find((c) => c.table === 'scheduled_messages' && c.args[0] === 'recipient_name')!;
    expect(q.chain).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['recipient_number', GROUP] },
      { method: 'eq', args: ['instance_phone', OWNER] },
    ]));
    const since = q.chain.find((m) => m.method === 'gte' && m.args[0] === 'created_at')!;
    expect(Date.now() - new Date(since.args[1]).getTime()).toBeLessThanOrEqual(10 * 60_000 + 1000);
  });

  test('riga recente nata dalla chat con se stessi (wa_message_id) → non vale come verificata: controllo live e nome dal server', async () => {
    // DB finto che applica i filtri .is(col, null) della scorciatoia.
    const rows = [{ recipient_name: 'Nome scritto a mano', wa_message_id: 'wamid-1', parent_recurrence_id: null }];
    mockSupa.setHandler('scheduled_messages:select', (call: any) => {
      if (call.args[0] !== 'recipient_name') return { data: [], error: null };
      const nullCols = call.chain.filter((m: any) => m.method === 'is' && m.args[1] === null).map((m: any) => m.args[0]);
      return { data: rows.filter((r: any) => nullCols.every((c: string) => r[c] == null)), error: null };
    });
    const r = await post(postBody());
    expect(r.status).toBe(200);
    expect(lookupCalls()).toHaveLength(1);
    expect(inserts()[0].args[0].recipient_name).toBe(GROUP_NAME);
  });
});

describe('POST /api/messages — {nome} e interruttori (D11, D13)', () => {
  test('{nome} nel testo → 400 placeholder_not_for_group, nessuna fetch', async () => {
    const r = await post(postBody({ message: 'Ciao {nome}, domani allenamento' }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('placeholder_not_for_group');
    expect(lookupCalls()).toHaveLength(0);
  });

  test('{nome} solo in media_caption → 400 placeholder_not_for_group', async () => {
    const r = await post(postBody({
      message: '', media_type: 'image', media_url: OWNER + '/abc-foto.jpg', media_caption: 'Ciao { nome }',
    }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('placeholder_not_for_group');
  });

  test('{nome} verso una persona resta permesso (regressione)', async () => {
    const r = await post(postBody({ recipient_number: PERSON, message: 'Ciao {nome}' }));
    expect(r.status).toBe(200);
  });

  test('senza GROUPS_ENABLED → 403 groups_disabled, nessuna chiamata', async () => {
    delete process.env.GROUPS_ENABLED;
    const r = await post(postBody());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('groups_disabled');
    expect(fetchMock.calls).toHaveLength(0);
    expect(mockSupa.calls.filter((c) => c.table === 'scheduled_messages')).toHaveLength(0);
  });

  test('GROUPS_ONLY_FOR con un altro numero → 403, nessuna chiamata', async () => {
    process.env.GROUPS_ONLY_FOR = '393330000099';
    const r = await post(postBody());
    expect(r.status).toBe(403);
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('GROUPS_ONLY_FOR col proprio numero → 200', async () => {
    process.env.GROUPS_ONLY_FOR = '393330000099,' + OWNER;
    expect((await post(postBody())).status).toBe(200);
  });
});

describe('POST /api/messages — tetto contatti (D12)', () => {
  const active = (n: string) => ({ recipient_number: n, status: 'pending', sent_at: null, scheduled_at: at() });
  // Rubrica piena (tetto del piano free): il primo posto è un gruppo, gli altri persone.
  const full = (first: string) => {
    const cap = getPlanLimits('free').maxContacts;
    return [active(first), ...Array.from({ length: cap - 1 }, (_, i) => active('39333000' + String(1000 + i)))];
  };
  beforeEach(() => {
    instanceRow.subscription_plan = 'free';
    process.env.BILLING_ENABLED = 'true';
  });

  test('tetto pieno: lo stesso gruppo già attivo passa', async () => {
    scheduledContacts = full(GROUP);
    const r = await post(postBody());
    expect(r.status).toBe(200);
  });

  test('tetto pieno: un gruppo nuovo → 403, nessuna fetch', async () => {
    scheduledContacts = full(OTHER_GROUP);
    const r = await post(postBody());
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('plan_contacts_limit_exceeded');
    expect(lookupCalls()).toHaveLength(0);
  });
});

describe('PATCH /api/messages — righe di gruppo (D11, D21)', () => {
  const groupRow = (over: any = {}) => ({
    id: 'msg-1', instance_phone: OWNER, status: 'paused', scheduled_at: new Date(Date.now() + 7200_000).toISOString(),
    media_type: null, media_url: null, recurrence_rule: null, parsed_message: 'Domani allenamento', caption: 'Domani allenamento',
    error_message: 'In pausa: non risulti più nel gruppo «' + GROUP_NAME + '» (o il gruppo non esiste più). Se ci rientri, tocca Riprendi.',
    recipient_number: GROUP, recipient_name: GROUP_NAME, ...over,
  });

  test('{nome} nel testo di una riga di gruppo → 400; su una persona passa', async () => {
    currentRow = groupRow({ status: 'pending' });
    let r = await patch({ id: 'msg-1', message: 'Ciao {nome}' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('placeholder_not_for_group');
    expect(msgUpdates()).toHaveLength(0);

    currentRow = groupRow({ status: 'pending', recipient_number: PERSON, recipient_name: 'Marco' });
    r = await patch({ id: 'msg-1', message: 'Ciao {nome}' });
    expect(r.status).toBe(200);
  });

  test('ripresa di una riga di gruppo: controllo live con gettone; ok → pending e motivo tolto', async () => {
    currentRow = groupRow();
    const r = await patch({ id: 'msg-1', status: 'pending' });
    expect(r.status).toBe(200);
    expect(lookupCalls()).toHaveLength(1);
    expect(mockSupa.calls.some((c) => c.table === '__rpc__' && c.operation === 'rate_limit_record')).toBe(true);
    expect(msgUpdates()[0].args[0]).toMatchObject({ status: 'pending', error_message: null });
    expect(msgUpdates()[0].args[0].recipient_name).toBeUndefined();
  });

  test('ripresa: nome del gruppo cambiato → aggiornato nello stesso update', async () => {
    currentRow = groupRow();
    fetchMock.setJsonResponse('/group/findGroupInfos/', groupInfo({ subject: 'Under 12 – Genitori 2026' }));
    await patch({ id: 'msg-1', status: 'pending' });
    expect(msgUpdates()).toHaveLength(1);
    expect(msgUpdates()[0].args[0].recipient_name).toBe('Under 12 – Genitori 2026');
  });

  test('ripresa senza scorciatoie: la memoria di un POST recente non evita il controllo', async () => {
    const route = await loadRoute();
    await post(postBody(), route);
    expect(lookupCalls()).toHaveLength(1);
    currentRow = groupRow();
    const res = await route.PATCH(await authedReq({ id: 'msg-1', status: 'pending' }));
    expect(res.status).toBe(200);
    expect(lookupCalls()).toHaveLength(2);
  });

  test('ripresa: non membro → 400 e riga ancora in pausa', async () => {
    currentRow = groupRow();
    fetchMock.setJsonResponse('/group/findGroupInfos/', { status: 404, response: { message: ['item-not-found'] } }, 404);
    const r = await patch({ id: 'msg-1', status: 'pending' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('recipient_not_group_member');
    expect(msgUpdates()).toHaveLength(0);
  });

  test('ripresa: Evolution non risponde → 503', async () => {
    currentRow = groupRow();
    fetchMock.setHandler('/group/findGroupInfos/', () => { const e: any = new Error('t'); e.name = 'TimeoutError'; throw e; });
    const r = await patch({ id: 'msg-1', status: 'pending' });
    expect(r.status).toBe(503);
    expect(msgUpdates()).toHaveLength(0);
  });

  test('ripresa: WhatsApp scollegato → 409; gettone esaurito → 429', async () => {
    currentRow = groupRow();
    instanceRow.connection_status = 'close';
    expect((await patch({ id: 'msg-1', status: 'pending' })).status).toBe(409);
    instanceRow.connection_status = 'open';
    tokenCount = 11;
    expect((await patch({ id: 'msg-1', status: 'pending' })).status).toBe(429);
    expect(lookupCalls()).toHaveLength(0);
    expect(msgUpdates()).toHaveLength(0);
  });

  test('ripresa con gruppi spenti → 403 senza chiamate a Evolution', async () => {
    delete process.env.GROUPS_ENABLED;
    currentRow = groupRow();
    const r = await patch({ id: 'msg-1', status: 'pending' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('groups_disabled');
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('pausa e cambio orario di una riga di gruppo pending: nessun controllo', async () => {
    currentRow = groupRow({ status: 'pending', error_message: null });
    expect((await patch({ id: 'msg-1', status: 'paused' })).status).toBe(200);
    expect((await patch({ id: 'msg-1', scheduled_at: new Date(Date.now() + 86_400_000).toISOString() })).status).toBe(200);
    expect(lookupCalls()).toHaveLength(0);
  });

  test('ripresa di una persona: nessuna fetch (regressione)', async () => {
    currentRow = groupRow({ recipient_number: PERSON, recipient_name: 'Marco', error_message: null });
    const r = await patch({ id: 'msg-1', status: 'pending' });
    expect(r.status).toBe(200);
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('retry di una riga di gruppo fallita: controllo live; non membro → 400 senza update', async () => {
    currentRow = groupRow({ status: 'failed', error_message: 'HTTP 500: boom' });
    fetchMock.setJsonResponse('/group/findGroupInfos/', { status: 404, response: { message: ['not-authorized'] } }, 404);
    const r = await patch({ id: 'msg-1', action: 'retry' });
    expect(r.status).toBe(400);
    expect(lookupCalls()).toHaveLength(1);
    expect(msgUpdates()).toHaveLength(0);
  });

  test('retry di una riga di gruppo fallita: ok → pending', async () => {
    currentRow = groupRow({ status: 'failed', error_message: 'HTTP 500: boom' });
    const r = await patch({ id: 'msg-1', action: 'retry' });
    expect(r.status).toBe(200);
    expect(lookupCalls()).toHaveLength(1);
    expect(msgUpdates()[0].args[0]).toMatchObject({ status: 'pending', retry_count: 0 });
  });

  test('retry con gruppi spenti → 403', async () => {
    delete process.env.GROUPS_ENABLED;
    currentRow = groupRow({ status: 'failed', error_message: 'HTTP 500: boom' });
    const r = await patch({ id: 'msg-1', action: 'retry' });
    expect(r.status).toBe(403);
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('retry di una persona: nessuna fetch (regressione)', async () => {
    currentRow = groupRow({ status: 'failed', error_message: 'HTTP 500: boom', recipient_number: PERSON });
    const r = await patch({ id: 'msg-1', action: 'retry' });
    expect(r.status).toBe(200);
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe('GET /api/messages — foto dalla rubrica', () => {
  test('il JID di un gruppo non finisce in .in("contact_number")', async () => {
    mockSupa.setHandler('scheduled_messages:select', (call: any) => {
      if (call.args[0] === '*') return { data: [{ id: 'a', recipient_number: GROUP }, { id: 'b', recipient_number: PERSON }], error: null };
      return { data: null, error: null, count: 2 } as any;
    });
    mockSupa.setResponse('whatsapp_contacts:select', []);
    const { GET } = await loadRoute();
    const res = await GET(await authedReq({}));
    expect(res.status).toBe(200);
    const q = mockSupa.calls.find((c) => c.table === 'whatsapp_contacts')!;
    expect(q.chain.find((m) => m.method === 'in')!.args).toEqual(['contact_number', [PERSON]]);
  });

  test('solo gruppi in coda → nessuna query a whatsapp_contacts', async () => {
    mockSupa.setHandler('scheduled_messages:select', (call: any) => {
      if (call.args[0] === '*') return { data: [{ id: 'a', recipient_number: GROUP }], error: null };
      return { data: null, error: null, count: 1 } as any;
    });
    const { GET } = await loadRoute();
    const res = await GET(await authedReq({}));
    const body = await res.json();
    expect(body.messages[0].photo_url).toBeNull();
    expect(mockSupa.calls.some((c) => c.table === 'whatsapp_contacts')).toBe(false);
  });
});
