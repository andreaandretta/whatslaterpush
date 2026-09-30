/**
 * app/lib/groups.ts — gruppi WhatsApp come destinatario, lato server.
 * Evolution e Supabase sono sempre mock: numeri e JID finti.
 */
import {
  groupsEnabled, groupsEnabledFor, privateRef, logRecipient, selfAdminStatus, mapGroupsForPicker,
  participantJidsOf, classifyGroupLookupFailure, lookupGroup, takeGroupsToken, isGroupsSlow, markGroupsSlow,
  rememberGroupCheck, recentGroupCheck, readGroups, __resetGroupsStateForTests,
} from '../app/lib/groups';
import { hashContactRefSync } from '../app/lib/audit';

const OWNER = '393331234567';
const OTHER = '393339876543';
const THIRD = '393330000001';
const G1 = '120363000000000001@g.us';
const G2 = '120363000000000002@g.us';
const G3 = '120363000000000003@g.us';
const COMMUNITY = '120363000000000099@g.us';
const LEGACY = '393330000002-1600000000@g.us';
const INSTANCE = 'SchedWhats-test';

const ENV_KEYS = ['GROUPS_ENABLED', 'GROUPS_ONLY_FOR', 'AUTH_COOKIE_SECRET', 'EVOLUTION_API_URL', 'EVOLUTION_API_KEY'];
const savedEnv: Record<string, string | undefined> = {};
const realFetch = global.fetch;

beforeAll(() => { for (const k of ENV_KEYS) savedEnv[k] = process.env[k]; });
beforeEach(() => {
  __resetGroupsStateForTests();
  process.env.AUTH_COOKIE_SECRET = 'test-secret-'.padEnd(64, 'x');
  process.env.EVOLUTION_API_URL = 'http://evo.test';
  process.env.EVOLUTION_API_KEY = 'test-key';
  delete process.env.GROUPS_ENABLED;
  delete process.env.GROUPS_ONLY_FOR;
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  global.fetch = realFetch;
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const person = (digits: string, admin: string | null = null) => ({ id: digits + '@s.whatsapp.net', admin });

function jsonRes(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function textRes(text: string, status: number) {
  return { ok: false, status, json: async () => { throw new Error('not json'); }, text: async () => text };
}
function timeoutError() {
  return Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
}

// Supabase finto: rate_limit_record restituisce `count`; rate_limit_state.minute_reset
// = `slowUntil` per grp:slow:, `busyUntil` per grp:busy:. `del` registra le delete.
function makeDb(opts: { count?: number | ((args: any) => number); slowUntil?: number | null; busyUntil?: number | null; rpcError?: boolean } = {}) {
  const rpc = jest.fn(async (_fn: string, args: any) => {
    if (opts.rpcError) return { data: null, error: { message: 'boom' } };
    const c = typeof opts.count === 'function' ? opts.count(args) : (opts.count ?? 1);
    return { data: { minute_count: c }, error: null };
  });
  const eq = jest.fn((_col: string, key: string) => ({
    maybeSingle: async () => {
      const until = String(key).startsWith('grp:busy:') ? opts.busyUntil : opts.slowUntil;
      return { data: until == null ? null : { minute_reset: until }, error: null };
    },
  }));
  const select = jest.fn(() => ({ eq }));
  const del = jest.fn(async (_col: string, _key: string) => ({ error: null }));
  const from = jest.fn(() => ({ select, delete: () => ({ eq: del }) }));
  return { rpc, from, eq, del } as any;
}

const RAW = [
  { id: G1, subject: 'Under 12 – Genitori', size: 19, announce: false, owner: OWNER + '@s.whatsapp.net', pictureUrl: 'https://pps.example/p.jpg',
    participants: [person(OWNER), person(OTHER, 'admin'), { id: '12345678901234@lid', phoneNumber: THIRD + '@s.whatsapp.net', admin: null }] },
  { id: COMMUNITY, subject: 'Polisportiva', isCommunity: true, participants: [person(OWNER, 'superadmin')] },
  { id: '12345@g.us', subject: 'Malformato', participants: [] },
  { id: 'status@broadcast', subject: 'Broadcast' },
];

describe('interruttori', () => {
  test('spento senza GROUPS_ENABLED, acceso con "true"', () => {
    expect(groupsEnabled()).toBe(false);
    expect(groupsEnabledFor(OWNER)).toBe(false);
    process.env.GROUPS_ENABLED = '1';
    expect(groupsEnabledFor(OWNER)).toBe(false);
    process.env.GROUPS_ENABLED = 'true';
    expect(groupsEnabled()).toBe(true);
    expect(groupsEnabledFor(OWNER)).toBe(true);
  });

  test('GROUPS_ONLY_FOR filtra i numeri', () => {
    process.env.GROUPS_ENABLED = 'true';
    process.env.GROUPS_ONLY_FOR = ` ${OTHER}, +${THIRD} `;
    expect(groupsEnabledFor(OWNER)).toBe(false);
    expect(groupsEnabledFor(OTHER)).toBe(true);
    expect(groupsEnabledFor(THIRD)).toBe(true);
    process.env.GROUPS_ONLY_FOR = '';
    expect(groupsEnabledFor(OWNER)).toBe(true);
  });
});

describe('privateRef / logRecipient', () => {
  test('stabile, 16 hex, diverso da hashContactRefSync', () => {
    const a = privateRef(OWNER);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(privateRef(OWNER)).toBe(a);
    expect(privateRef(OTHER)).not.toBe(a);
    expect(hashContactRefSync(OWNER)).not.toContain(a!);
    expect('h:' + a!.slice(0, 8)).not.toBe(hashContactRefSync(OWNER));
  });

  test('null senza segreto, con un solo avviso e senza valori', () => {
    delete process.env.AUTH_COOKIE_SECRET;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(privateRef(OWNER)).toBeNull();
    expect(privateRef(OTHER)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(OWNER);
  });

  test('un gruppo nei log è group:<10 hex>, una persona resta com\'era', () => {
    expect(logRecipient(G1)).toMatch(/^group:[0-9a-f]{10}$/);
    expect(logRecipient(G1.toUpperCase())).toBe(logRecipient(G1));
    expect(logRecipient(LEGACY)).not.toContain('393330000002');
    expect(logRecipient(OWNER)).toBe(OWNER);
    delete process.env.AUTH_COOKIE_SECRET;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(logRecipient(G1)).toBe('group:unset');
  });
});

describe('selfAdminStatus', () => {
  test('admin, superadmin, member', () => {
    expect(selfAdminStatus({ participants: [person(OWNER, 'admin')] }, OWNER)).toBe('admin');
    expect(selfAdminStatus({ participants: [person(OWNER, 'superadmin')] }, OWNER)).toBe('admin');
    expect(selfAdminStatus({ participants: [person(OWNER)] }, OWNER)).toBe('member');
  });

  test('utente assente con owner uguale al suo numero → unknown (owner non conta)', () => {
    expect(selfAdminStatus({ owner: OWNER + '@s.whatsapp.net', participants: [person(OTHER, 'admin')] }, OWNER)).toBe('unknown');
  });

  test('partecipante LID con phoneNumber riconosciuto come l\'utente', () => {
    const g = { participants: [{ id: '12345678901234@lid', phoneNumber: OWNER + '@s.whatsapp.net', admin: 'admin' }] };
    expect(selfAdminStatus(g, OWNER)).toBe('admin');
  });

  test('LID senza phoneNumber o partecipanti mancanti → unknown', () => {
    expect(selfAdminStatus({ participants: [{ id: '12345678901234@lid', admin: 'admin' }] }, OWNER)).toBe('unknown');
    expect(selfAdminStatus({}, OWNER)).toBe('unknown');
    expect(selfAdminStatus(null, OWNER)).toBe('unknown');
  });
});

describe('mapGroupsForPicker', () => {
  test('scarta community madri e id non validi', () => {
    const out = mapGroupsForPicker(RAW, OWNER);
    expect(out.map((g) => g.jid)).toEqual([G1]);
    expect(mapGroupsForPicker(null, OWNER)).toEqual([]);
    expect(mapGroupsForPicker({ id: G1 }, OWNER)).toEqual([]);
  });

  test('JID normalizzato e senza doppioni', () => {
    const out = mapGroupsForPicker([{ id: ' ' + G1.toUpperCase(), subject: 'A' }, { id: G1, subject: 'A bis' }], OWNER);
    expect(out).toHaveLength(1);
    expect(out[0].jid).toBe(G1);
  });

  test('solo amministratori: admin → scrivibile; membro o unknown → bloccato', () => {
    const out = mapGroupsForPicker([
      { id: G1, subject: 'Admin', announce: true, participants: [person(OWNER, 'admin')] },
      { id: G2, subject: 'Membro', announce: true, participants: [person(OWNER)] },
      { id: G3, subject: 'Sconosciuto', isCommunityAnnounce: true, owner: OWNER + '@s.whatsapp.net', participants: [person(OTHER, 'superadmin')] },
    ], OWNER);
    const by = (name: string) => out.find((g) => g.name === name)!;
    expect(by('Admin').can_send).toBe(true);
    expect(by('Admin').locked_reason).toBeUndefined();
    expect(by('Membro')).toMatchObject({ can_send: false, locked_reason: 'solo_admin' });
    expect(by('Sconosciuto')).toMatchObject({ can_send: false, locked_reason: 'solo_admin' });
  });

  test('gruppo normale: scrivibile anche senza partecipanti', () => {
    expect(mapGroupsForPicker([{ id: G1, subject: 'Aperto' }], OWNER)[0].can_send).toBe(true);
  });

  test('ripiego del nome e taglio a 100 senza spezzare emoji', () => {
    const long = '⚽'.repeat(80); // 80 unità UTF-16, ma con spazi e altro supera 100
    const out = mapGroupsForPicker([
      { id: G1, subject: '   ' },
      { id: G2 },
      { id: G3, subject: '  ' + long + ' ' + '👨‍👩‍👧‍👦'.repeat(5) + '  ' },
    ], OWNER);
    expect(out.filter((g) => g.name === 'Gruppo senza nome')).toHaveLength(2);
    const cut = out.find((g) => g.jid === G3)!.name;
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.startsWith(long)).toBe(true);
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
  });

  test('size: g.size > 0, altrimenti partecipanti, altrimenti null', () => {
    const out = mapGroupsForPicker([
      { id: G1, subject: 'A', size: 19, participants: [person(OWNER)] },
      { id: G2, subject: 'B', size: 0, participants: [person(OWNER), person(OTHER)] },
      { id: G3, subject: 'C' },
    ], OWNER);
    const size = (jid: string) => out.find((g) => g.jid === jid)!.size;
    expect(size(G1)).toBe(19);
    expect(size(G2)).toBe(2);
    expect(size(G3)).toBeNull();
  });

  test('ordine: prima gli scrivibili, poi per nome (italiano, senza maiuscole)', () => {
    const out = mapGroupsForPicker([
      { id: G1, subject: 'Zeta' },
      { id: G2, subject: 'Beta', announce: true, participants: [person(OWNER)] },
      { id: G3, subject: 'alfa' },
    ], OWNER);
    expect(out.map((g) => g.name)).toEqual(['alfa', 'Zeta', 'Beta']);
  });

  test('tetto di 500', () => {
    const raw = Array.from({ length: 600 }, (_, i) => ({ id: '120363' + String(i).padStart(12, '0') + '@g.us', subject: 'G' + i }));
    expect(mapGroupsForPicker(raw, OWNER)).toHaveLength(500);
  });

  test('omonimi: hint con la community se c\'è linkedParent, altrimenti "creato a …"', () => {
    const sept2024 = Date.UTC(2024, 8, 15, 12) / 1000;
    const out = mapGroupsForPicker([
      { id: COMMUNITY, subject: 'Polisportiva', isCommunity: true },
      { id: G1, subject: 'Genitori', linkedParent: COMMUNITY, creation: sept2024 },
      { id: G2, subject: 'genitori', creation: sept2024 },
      { id: G3, subject: 'Under 12', creation: sept2024 },
    ], OWNER);
    const by = (jid: string) => out.find((g) => g.jid === jid)!;
    expect(by(G1).hint).toBe('nella community «Polisportiva»');
    expect(by(G2).hint).toBe('creato a set 2024');
    expect(by(G3).hint).toBeFalsy();
  });

  test('omonimi senza community né creation → nessun hint', () => {
    const out = mapGroupsForPicker([{ id: G1, subject: 'Genitori' }, { id: G2, subject: 'Genitori' }], OWNER);
    expect(out.every((g) => !g.hint)).toBe(true);
  });

  test('nel JSON in uscita mai partecipanti, foto, owner, creation, linkedParent', () => {
    const json = JSON.stringify(mapGroupsForPicker([
      ...RAW,
      { id: G2, subject: 'Genitori', linkedParent: COMMUNITY, creation: 1700000000, participants: [person(OTHER)] },
      { id: G3, subject: 'Genitori', creation: 1700000000 },
    ], OWNER));
    for (const bad of ['participants', 'pictureUrl', 'pps.example', 'owner', 'creation', 'linkedParent', 'admin', OWNER, OTHER, THIRD, '@lid', '@s.whatsapp.net']) {
      expect(json).not.toContain(bad);
    }
  });
});

describe('participantJidsOf', () => {
  test('solo JID-telefono, anche dai LID con phoneNumber, senza doppioni', () => {
    const out = participantJidsOf([
      ...RAW,
      { id: G2, participants: [person(OTHER), { id: '98765432109876@lid' }, { id: G3 }] },
    ]);
    expect(out.sort()).toEqual([OWNER, OTHER, THIRD].map((d) => d + '@s.whatsapp.net').sort());
    expect(participantJidsOf(undefined)).toEqual([]);
  });
});

describe('classifyGroupLookupFailure', () => {
  test.each([
    [400, '{"response":{"message":["rate-overlimit"]}}', 'unavailable'],
    [404, 'Timed Out', 'unavailable'],
    [404, 'Connection Closed', 'unavailable'],
    [404, '{"response":{"message":["Error fetching group","Error: forbidden"]}}', 'not_member'],
    [404, 'item-not-found', 'not_member'],
    [404, 'not-authorized', 'not_member'],
    [403, 'forbidden', 'unavailable'],
    [404, 'qualcosa di nuovo', 'unavailable'],
    [500, 'Internal Server Error', 'unavailable'],
    [null, '', 'unavailable'],
  ])('%p %p → %p', (status, body, expected) => {
    expect(classifyGroupLookupFailure(status as number | null, body as string)).toBe(expected);
  });
});

describe('lookupGroup', () => {
  test('ok: URL con JID codificato, dati dal server', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes({ id: G1, subject: ' Under 12 ', size: 19, announce: true, participants: [person(OWNER, 'admin')] }));
    global.fetch = f as any;
    const r = await lookupGroup(INSTANCE, G1, OWNER, 5000);
    expect(r).toEqual({ kind: 'ok', name: 'Under 12', size: 19, adminOnly: true, community: false, self: 'admin' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://evo.test/group/findGroupInfos/' + INSTANCE + '?groupJid=120363000000000001%40g.us');
    expect(init.headers).toEqual({ apikey: 'test-key' });
    expect(init.signal).toBeDefined();
  });

  test('community e membro semplice', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes({ id: G1, isCommunity: true, participants: [person(OWNER)] })) as any;
    expect(await lookupGroup(INSTANCE, G1, OWNER, 5000)).toMatchObject({ kind: 'ok', community: true, self: 'member', name: null, size: 1 });
  });

  test('404 + forbidden → not_member', async () => {
    global.fetch = jest.fn().mockResolvedValue(textRes('{"status":404,"response":{"message":["Error: forbidden"]}}', 404)) as any;
    expect(await lookupGroup(INSTANCE, G1, OWNER, 5000)).toEqual({ kind: 'not_member' });
  });

  // Il motivo serve al cron: "overlimit" (e, nella rampa, ogni mancata risposta) rimanda l'invio.
  test.each([
    ['500', () => Promise.resolve(textRes('Internal Server Error', 500)), 'other'],
    ['404 rate-overlimit', () => Promise.resolve(textRes('{"status":404,"response":{"message":["Error fetching group","Error: rate-overlimit"]}}', 404)), 'overlimit'],
    ['400 "Timed Out" di Baileys', () => Promise.resolve(textRes('{"status":400,"response":{"message":["Error: Timed Out"]}}', 400)), 'timeout'],
    ['timeout nostro', () => Promise.reject(timeoutError()), 'timeout'],
    ['rete', () => Promise.reject(new TypeError('fetch failed')), 'other'],
    ['corpo non JSON', () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); }, text: async () => '' }), 'other'],
    ['id di un altro gruppo', () => Promise.resolve(jsonRes({ id: G2, subject: 'Altro' })), 'other'],
    ['corpo vuoto', () => Promise.resolve(jsonRes(null)), 'other'],
  ])('%s → unavailable col motivo', async (_label, impl, reason) => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn().mockImplementation(impl) as any;
    expect(await lookupGroup(INSTANCE, G1, OWNER, 5000)).toEqual({ kind: 'unavailable', reason });
  });

  test('senza configurazione Evolution o con un JID non di gruppo → unavailable senza fetch', async () => {
    const f = jest.fn();
    global.fetch = f as any;
    expect(await lookupGroup(INSTANCE, OWNER + '@s.whatsapp.net', OWNER, 5000)).toEqual({ kind: 'unavailable', reason: 'other' });
    delete process.env.EVOLUTION_API_URL;
    expect(await lookupGroup(INSTANCE, G1, OWNER, 5000)).toEqual({ kind: 'unavailable', reason: 'other' });
    expect(f).not.toHaveBeenCalled();
  });

  test('i log non contengono mai il JID né il corpo', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue(textRes('segreto ' + G1 + ' ' + OWNER, 404)) as any;
    await lookupGroup(INSTANCE, LEGACY, OWNER, 5000);
    const all = [...warn.mock.calls, ...log.mock.calls].map((c) => c.join(' ')).join('\n');
    expect(all).not.toMatch(/@g\.us|segreto|393330000002|393331234567/);
    expect(all).toMatch(/group:[0-9a-f]{10}/);
  });
});

describe('gettoni', () => {
  test('list: 1 ogni 30 min; chiave privata, mai il numero', async () => {
    const db = makeDb({ count: 1 });
    expect(await takeGroupsToken(db, 'list', OWNER)).toBe(true);
    const args = db.rpc.mock.calls[0][1];
    expect(db.rpc.mock.calls[0][0]).toBe('rate_limit_record');
    expect(args.p_key).toBe('grp:list:' + privateRef(OWNER));
    expect(args.p_key).not.toContain(OWNER);
    expect(args.p_minute_reset - args.p_now).toBe(30 * 60_000);
    expect(await takeGroupsToken(makeDb({ count: 2 }), 'list', OWNER)).toBe(false);
  });

  test('check: 10 ogni 10 min', async () => {
    const db = makeDb({ count: 10 });
    expect(await takeGroupsToken(db, 'check', OWNER)).toBe(true);
    expect(db.rpc.mock.calls[0][1].p_key).toBe('grp:check:' + privateRef(OWNER));
    expect(db.rpc.mock.calls[0][1].p_minute_reset - db.rpc.mock.calls[0][1].p_now).toBe(10 * 60_000);
    expect(await takeGroupsToken(makeDb({ count: 11 }), 'check', OWNER)).toBe(false);
  });

  test('RPC in errore o segreto assente → si lascia passare', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await takeGroupsToken(makeDb({ rpcError: true }), 'list', OWNER)).toBe(true);
    const throwing = { rpc: jest.fn(() => { throw new Error('down'); }) } as any;
    expect(await takeGroupsToken(throwing, 'list', OWNER)).toBe(true);
    delete process.env.AUTH_COOKIE_SECRET;
    const db = makeDb({ count: 99 });
    expect(await takeGroupsToken(db, 'list', OWNER)).toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('lento: mark scrive una finestra di 6 h su grp:slow:, is la legge', async () => {
    const db = makeDb();
    await markGroupsSlow(db, OWNER);
    const args = db.rpc.mock.calls[0][1];
    expect(args.p_key).toBe('grp:slow:' + privateRef(OWNER));
    expect(args.p_minute_reset - args.p_now).toBe(6 * 3_600_000);

    expect(await isGroupsSlow(makeDb({ slowUntil: Date.now() + 60_000 }), OWNER)).toBe(true);
    expect(await isGroupsSlow(makeDb({ slowUntil: Date.now() - 1 }), OWNER)).toBe(false);
    const dbNone = makeDb({ slowUntil: null });
    expect(await isGroupsSlow(dbNone, OWNER)).toBe(false);
    expect(dbNone.eq).toHaveBeenCalledWith('key', 'grp:slow:' + privateRef(OWNER));
    // Errore → "non lento".
    const broken = { from: () => { throw new Error('down'); } } as any;
    expect(await isGroupsSlow(broken, OWNER)).toBe(false);
  });

  test('lento anche con una lettura "in corso" da più di 30 s e mai chiusa (lambda congelata)', async () => {
    const started = (msAgo: number) => Date.now() - msAgo + 6 * 3_600_000; // minute_reset = inizio + 6 h
    expect(await isGroupsSlow(makeDb({ busyUntil: started(60_000) }), OWNER)).toBe(true);
    // Appena partita (anche in un'altra lambda): non è ancora "lento".
    expect(await isGroupsSlow(makeDb({ busyUntil: started(10_000) }), OWNER)).toBe(false);
    // Finestra di 6 h passata.
    expect(await isGroupsSlow(makeDb({ busyUntil: Date.now() - 1 }), OWNER)).toBe(false);
    const db = makeDb();
    await isGroupsSlow(db, OWNER);
    expect(db.eq).toHaveBeenCalledWith('key', 'grp:busy:' + privateRef(OWNER));
  });
});

describe('verdetti recenti', () => {
  test('recentGroupCheck scade dopo 10 min', () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z') });
    rememberGroupCheck(OWNER, G1, { name: 'Under 12', size: 19 });
    expect(recentGroupCheck(OWNER, G1)).toEqual({ name: 'Under 12', size: 19 });
    expect(recentGroupCheck(OWNER, ' ' + G1.toUpperCase())).toEqual({ name: 'Under 12', size: 19 });
    expect(recentGroupCheck(OTHER, G1)).toBeNull();
    expect(recentGroupCheck(OWNER, G2)).toBeNull();
    jest.setSystemTime(new Date('2026-10-01T10:09:59Z'));
    expect(recentGroupCheck(OWNER, G1)).not.toBeNull();
    jest.setSystemTime(new Date('2026-10-01T10:10:01Z'));
    expect(recentGroupCheck(OWNER, G1)).toBeNull();
  });
});

describe('readGroups', () => {
  const LIST_URL = 'http://evo.test/group/fetchAllGroups/' + INSTANCE + '?getParticipants=true';
  let logs: string[];
  beforeEach(() => {
    logs = [];
    jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { logs.push(a.join(' ')); });
    jest.spyOn(console, 'warn').mockImplementation((...a: any[]) => { logs.push(a.join(' ')); });
  });

  test('live: una sola fetchAllGroups?getParticipants=true, lista mappata e JID-telefono', async () => {
    const f = jest.fn().mockResolvedValue(jsonRes(RAW));
    global.fetch = f as any;
    const db = makeDb();
    const r = await readGroups(OWNER, INSTANCE, db, { caller: 'groups' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][0]).toBe(LIST_URL);
    expect(r.source).toBe('live');
    expect(r.groups.map((g) => g.jid)).toEqual([G1]);
    expect(r.participantJids.every((j) => j.endsWith('@s.whatsapp.net'))).toBe(true);
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(db.rpc.mock.calls.map((c: any[]) => c[1].p_key)).toEqual(['grp:list:' + privateRef(OWNER)]);
  });

  test('seconda chiamata entro 30 min → cache, senza fetch né gettone', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    const db = makeDb();
    await readGroups(OWNER, INSTANCE, db, { caller: 'groups' });
    const r = await readGroups(OWNER, INSTANCE, db, { caller: 'contacts' });
    expect(r.source).toBe('cache');
    expect(r.groups).toHaveLength(1);
    expect(r.participantJids.length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  test('refresh con cache fresca: fetch live e gettone consumato; gettone negato → throttled con la cache', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    await readGroups(OWNER, INSTANCE, makeDb({ count: 1 }), { caller: 'groups' });
    const ok = makeDb({ count: 1 });
    const r1 = await readGroups(OWNER, INSTANCE, ok, { caller: 'groups', refresh: true });
    expect(r1.source).toBe('live');
    expect(ok.rpc).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const denied = makeDb({ count: 2 });
    const r2 = await readGroups(OWNER, INSTANCE, denied, { caller: 'groups', refresh: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(r2.throttled).toBe(true);
    expect(r2.source).toBe('cache');
    expect(r2.groups).toHaveLength(1);
  });

  test('gettone negato senza cache → throttled e nessun gruppo', async () => {
    const f = jest.fn();
    global.fetch = f as any;
    const r = await readGroups(OWNER, INSTANCE, makeDb({ count: 2 }), { caller: 'groups' });
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ source: 'none', throttled: true, groups: [], fetchedAt: null });
  });

  test('due chiamate concorrenti → una sola fetch e un solo gettone', async () => {
    let release: (v: any) => void = () => {};
    const f = jest.fn(() => new Promise((res) => { release = res; }));
    global.fetch = f as any;
    const db = makeDb({ count: (args) => (args.p_key.startsWith('grp:list:') ? db.rpc.mock.calls.length : 1) });
    const a = readGroups(OWNER, INSTANCE, db, { caller: 'groups' });
    const b = readGroups(OWNER, INSTANCE, db, { caller: 'groups' });
    await new Promise((r) => setImmediate(r));
    release(jsonRes(RAW));
    const [ra, rb] = await Promise.all([a, b]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(ra.source).toBe('live');
    expect(rb.source).toBe('live');
    expect(rb.groups).toEqual(ra.groups);
  });

  test('Evolution in errore con cache → stale, error unavailable', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    global.fetch = jest.fn().mockResolvedValueOnce(jsonRes(RAW)).mockResolvedValueOnce(textRes('boom', 500)) as any;
    await readGroups(OWNER, INSTANCE, makeDb(), { caller: 'groups' });
    jest.setSystemTime(new Date('2026-10-01T10:31:00Z'));
    const r = await readGroups(OWNER, INSTANCE, makeDb(), { caller: 'groups' });
    expect(r).toMatchObject({ source: 'stale', error: 'unavailable' });
    expect(r.groups).toHaveLength(1);
  });

  test('Evolution in errore senza cache → none, error unavailable', async () => {
    global.fetch = jest.fn().mockResolvedValue(textRes('boom', 500)) as any;
    const r = await readGroups(OWNER, INSTANCE, makeDb(), { caller: 'groups' });
    expect(r).toMatchObject({ source: 'none', error: 'unavailable', groups: [] });
  });

  test('timeout (caller groups) → error timeout e "lento" segnato su grp:slow:', async () => {
    global.fetch = jest.fn().mockRejectedValue(timeoutError()) as any;
    const db = makeDb();
    const r = await readGroups(OWNER, INSTANCE, db, { caller: 'groups' });
    expect(r).toMatchObject({ source: 'none', error: 'timeout' });
    const keys = db.rpc.mock.calls.map((c: any[]) => c[1].p_key);
    expect(keys).toEqual(['grp:list:' + privateRef(OWNER), 'grp:slow:' + privateRef(OWNER)]);
  });

  test('"lento" attivo → nessuna fetch, nessun gettone, slow:true', async () => {
    const f = jest.fn();
    global.fetch = f as any;
    const db = makeDb({ slowUntil: Date.now() + 3_600_000 });
    const r = await readGroups(OWNER, INSTANCE, db, { caller: 'groups' });
    expect(f).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ slow: true, source: 'none', groups: [] });
  });

  test('caller contacts: aspetta al massimo 5 s, non segna "lento"; la fetch resta in volo fino alla fine', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    let release: (v: any) => void = () => {};
    const f = jest.fn(() => new Promise((res) => { release = res; }));
    global.fetch = f as any;
    const db = makeDb();
    const first = readGroups(OWNER, INSTANCE, db, { caller: 'contacts' });
    await jest.advanceTimersByTimeAsync(5_000);
    const r1 = await first;
    expect(r1).toMatchObject({ source: 'none', error: 'timeout' });
    // Gettone e "in corso"; nessun "lento" per la sola attesa di 5 s.
    expect(db.rpc.mock.calls.map((c: any[]) => c[1].p_key)).toEqual(['grp:list:' + privateRef(OWNER), 'grp:busy:' + privateRef(OWNER)]);

    // Un secondo chiamante si aggancia alla stessa fetch: nessuna nuova richiesta.
    const second = readGroups(OWNER, INSTANCE, db, { caller: 'contacts' });
    await jest.advanceTimersByTimeAsync(10);
    release(jsonRes(RAW));
    const r2 = await second;
    expect(f).toHaveBeenCalledTimes(1);
    expect(r2.source).toBe('live');
    expect(db.rpc).toHaveBeenCalledTimes(2);
    // Lista arrivata: "in corso" tolto.
    expect(db.del).toHaveBeenCalledWith('key', 'grp:busy:' + privateRef(OWNER));
  });

  test('caller contacts: la fetch scade a 25 s dopo che il contacts ha smesso di aspettare → "lento" su grp:slow:', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    // Come fetch con AbortSignal.timeout(25 s): rifiuta con TimeoutError.
    const f = jest.fn(() => new Promise((_res, rej) => { setTimeout(() => rej(timeoutError()), 25_000); }));
    global.fetch = f as any;
    const db = makeDb();
    const first = readGroups(OWNER, INSTANCE, db, { caller: 'contacts' });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(await first).toMatchObject({ source: 'none', error: 'timeout' });
    const keys = () => db.rpc.mock.calls.map((c: any[]) => c[1].p_key);
    expect(keys().some((k: string) => k.startsWith('grp:slow:'))).toBe(false);

    await jest.advanceTimersByTimeAsync(21_000);
    expect(keys()).toEqual(['grp:list:' + privateRef(OWNER), 'grp:busy:' + privateRef(OWNER), 'grp:slow:' + privateRef(OWNER)]);
    expect(db.rpc.mock.calls[2][1].p_minute_reset - db.rpc.mock.calls[2][1].p_now).toBe(6 * 3_600_000);
    expect(f).toHaveBeenCalledTimes(1);
  });

  test('lettura avviata da /api/contacts mai chiusa (lambda congelata) → alla successiva slow, senza fetch né gettone', async () => {
    const f = jest.fn();
    global.fetch = f as any;
    const db = makeDb({ busyUntil: Date.now() - 45 * 60_000 + 6 * 3_600_000 });
    const r = await readGroups(OWNER, INSTANCE, db, { caller: 'contacts' });
    expect(r).toMatchObject({ slow: true, source: 'none' });
    expect(f).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  test('caller groups: nessun "in corso" (la risposta arriva dopo la fetch)', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    const db = makeDb();
    await readGroups(OWNER, INSTANCE, db, { caller: 'groups', refresh: true });
    expect(db.rpc.mock.calls.map((c: any[]) => c[1].p_key)).toEqual(['grp:list:' + privateRef(OWNER)]);
    expect(db.del).not.toHaveBeenCalled();
  });

  test('i partecipanti restano al massimo 30 min, la lista fino a 24 h', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00Z'), doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    global.fetch = jest.fn().mockResolvedValueOnce(jsonRes(RAW)).mockRejectedValue(new TypeError('fetch failed')) as any;
    await readGroups(OWNER, INSTANCE, makeDb(), { caller: 'groups' });
    jest.setSystemTime(new Date('2026-10-01T10:31:00Z'));
    const stale = await readGroups(OWNER, INSTANCE, makeDb({ count: 2 }), { caller: 'contacts' });
    expect(stale).toMatchObject({ source: 'stale', throttled: true });
    expect(stale.groups).toHaveLength(1);
    expect(stale.participantJids).toEqual([]);
    jest.setSystemTime(new Date('2026-10-02T10:01:00Z'));
    const gone = await readGroups(OWNER, INSTANCE, makeDb({ count: 2 }), { caller: 'contacts' });
    expect(gone).toMatchObject({ source: 'none', groups: [], throttled: true });
  });

  test('i log non contengono JID di gruppo né numeri', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonRes(RAW)) as any;
    await readGroups(OWNER, INSTANCE, makeDb(), { caller: 'groups' });
    global.fetch = jest.fn().mockRejectedValue(timeoutError()) as any;
    await readGroups(OTHER, INSTANCE, makeDb(), { caller: 'groups' });
    const all = logs.join('\n');
    expect(all).toMatch(/GROUPS source=live n=1 ms=\d+ caller=groups u=[0-9a-f]{10}/);
    expect(all).not.toMatch(/@g\.us|@s\.whatsapp\.net|393331234567|393339876543/);
  });
});
