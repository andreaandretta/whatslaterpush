/**
 * Gruppi WhatsApp come destinatario — lato server.
 *
 * Tutto ciò che parla con Evolution per i gruppi passa di qui, con `fetch`
 * diretto come il cron (lib/evolution/client.ts non si tocca). Tre regole:
 *  1. ogni lettura della lista costa a WhatsApp 1+2N richieste (foto e
 *     metadati di ogni gruppo): gettone su DB (1 ogni 30 min per utente,
 *     condiviso con /api/contacts), cache per lambda e segnale "lento";
 *  2. i partecipanti restano solo in memoria (massimo 30 min): servono a
 *     capire se l'utente è admin e a proporre contatti in /api/contacts. Mai
 *     restituiti al client, salvati o loggati;
 *  3. mai il JID in chiaro in log e chiavi: `privateRef` (HMAC col segreto
 *     dei cookie). Nel formato vecchio le cifre sono il telefono del creatore.
 */
import { createHmac } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeGroupJid, phoneDigitsFromJid, phoneJidFromContact } from './jid';
import { truncateAtGrapheme } from './text';
import { romeParts } from './anti-ban';
import type { PickerGroup } from './contacts-client-cache';

export type { PickerGroup };

// ── Interruttori (D13): spenti di default ──

export function groupsEnabled(): boolean {
  return process.env.GROUPS_ENABLED === 'true';
}

/** Acceso per questo utente: GROUPS_ENABLED e, se impostata, GROUPS_ONLY_FOR (cifre E.164 senza '+', separate da virgola). */
export function groupsEnabledFor(phone: string): boolean {
  if (!groupsEnabled()) return false;
  const only = (process.env.GROUPS_ONLY_FOR || '')
    .split(',')
    .map((s) => s.replace(/\D/g, ''))
    .filter(Boolean);
  if (only.length === 0) return true;
  return only.indexOf(String(phone || '').replace(/\D/g, '')) !== -1;
}

// ── Riferimenti privati (D16) ──

let warnedNoSecret = false;

/**
 * HMAC-SHA256 con chiave AUTH_COOKIE_SECRET, 16 hex. Uno SHA-256 senza sale
 * sull'insieme dei cellulari italiani sarebbe di fatto il numero. Segreto
 * assente → null (i chiamanti lasciano passare).
 */
export function privateRef(value: string): string | null {
  const secret = process.env.AUTH_COOKIE_SECRET;
  if (!secret) {
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn('GROUPS: AUTH_COOKIE_SECRET assente, riferimenti privati disattivati');
    }
    return null;
  }
  return createHmac('sha256', secret).update('wl-groups-v1:' + value).digest('hex').slice(0, 16);
}

/** Destinatario per i log: un gruppo diventa `group:<10 hex>`, una persona resta com'era. */
export function logRecipient(recipient: string): string {
  const jid = normalizeGroupJid(recipient);
  if (!jid) return recipient;
  return 'group:' + (privateRef(jid)?.slice(0, 10) ?? 'unset');
}

function userRef(phone: string): string {
  return privateRef(phone)?.slice(0, 10) ?? 'unset';
}

// ── Mappatura della risposta di Evolution ──

/**
 * D5: l'utente si cerca tra i partecipanti (anche LID + phoneNumber). `owner`
 * non si usa: è chi ha CREATO il gruppo, non chi oggi ne è admin.
 * Utente assente o partecipanti mancanti → 'unknown'.
 */
export function selfAdminStatus(g: any, ownerPhone: string): 'admin' | 'member' | 'unknown' {
  const me = String(ownerPhone || '').replace(/\D/g, '');
  const participants = Array.isArray(g?.participants) ? g.participants : [];
  if (!me || participants.length === 0) return 'unknown';
  for (let i = 0; i < participants.length; i++) {
    const p = participants[i];
    if (phoneDigitsFromJid(phoneJidFromContact(p)) !== me) continue;
    return p?.admin === 'admin' || p?.admin === 'superadmin' ? 'admin' : 'member';
  }
  return 'unknown';
}

const NO_NAME = 'Gruppo senza nome';
const MAX_GROUPS = 500;
const IT_MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

function groupName(subject: unknown): string | null {
  if (typeof subject !== 'string' || !subject.trim()) return null;
  return truncateAtGrapheme(subject.trim(), 100);
}

function groupSize(g: any): number | null {
  if (typeof g?.size === 'number' && g.size > 0) return g.size;
  if (Array.isArray(g?.participants) && g.participants.length > 0) return g.participants.length;
  return null;
}

// Baileys dà `creation` in secondi; per sicurezza si accettano anche i millisecondi.
function creationLabel(creation: unknown): string | null {
  const n = typeof creation === 'string' ? Number(creation) : creation;
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  const p = romeParts(new Date(n < 1e12 ? n * 1000 : n));
  return 'creato a ' + IT_MONTHS[p.mo - 1] + ' ' + p.y;
}

/**
 * Lista per il picker. Scarta JID non validi e community madri; i gruppi
 * "solo amministratori" in cui l'utente non è (o non risulta) admin restano,
 * ma non scrivibili (D4). Con omonimi aggiunge un distintivo (D19). L'output
 * non contiene mai partecipanti, foto, owner, creation o linkedParent grezzi.
 */
export function mapGroupsForPicker(raw: unknown, ownerPhone: string): PickerGroup[] {
  if (!Array.isArray(raw)) return [];
  const communities: Record<string, string> = {};
  for (let i = 0; i < raw.length; i++) {
    const g = raw[i];
    const jid = normalizeGroupJid(g?.id);
    if (jid && g?.isCommunity === true) communities[jid] = groupName(g?.subject) || '';
  }

  const seen: Record<string, true> = {};
  const rows: Array<{ out: PickerGroup; g: any }> = [];
  for (let i = 0; i < raw.length; i++) {
    const g = raw[i];
    const jid = normalizeGroupJid(g?.id);
    if (!jid || g?.isCommunity === true || seen[jid]) continue;
    seen[jid] = true;
    const adminOnly = g?.announce === true || g?.isCommunityAnnounce === true;
    const canSend = !adminOnly || selfAdminStatus(g, ownerPhone) === 'admin';
    const out: PickerGroup = { jid, name: groupName(g?.subject) || NO_NAME, size: groupSize(g), can_send: canSend };
    if (!canSend) out.locked_reason = 'solo_admin';
    rows.push({ out, g });
  }

  // D19: stesso nome (senza badare a maiuscole) → community madre, altrimenti mese di creazione.
  const byName: Record<string, number> = {};
  rows.forEach((r) => {
    const k = r.out.name.toLocaleLowerCase('it');
    byName[k] = (byName[k] || 0) + 1;
  });
  rows.forEach((r) => {
    if (byName[r.out.name.toLocaleLowerCase('it')] < 2) return;
    const parent = normalizeGroupJid(r.g?.linkedParent);
    const hint = parent && communities[parent]
      ? 'nella community «' + communities[parent] + '»'
      : creationLabel(r.g?.creation);
    if (hint) r.out.hint = hint;
  });

  return rows
    .map((r) => r.out)
    .sort((a, b) => {
      if (a.can_send !== b.can_send) return a.can_send ? -1 : 1;
      return a.name.localeCompare(b.name, 'it', { sensitivity: 'base' });
    })
    .slice(0, MAX_GROUPS);
}

/** JID-telefono dei partecipanti di tutti i gruppi (come oggi in /api/contacts), senza doppioni. Solo per /api/contacts. */
export function participantJidsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const participants = Array.isArray(raw[i]?.participants) ? raw[i].participants : [];
    for (let j = 0; j < participants.length; j++) {
      const jid = phoneJidFromContact(participants[j]);
      if (!jid || seen[jid]) continue;
      seen[jid] = true;
      out.push(jid);
    }
  }
  return out;
}

// ── Controllo di un singolo gruppo (POST, ripresa, cron) ──

/** Testi da tarare con la verifica V2 (§7): finché non combaciano, un non membro riceve "riprova" (503) invece del 400. */
export function classifyGroupLookupFailure(status: number | null, body: string): 'not_member' | 'unavailable' {
  const b = String(body || '');
  if (/overlimit|timed out|timeout|connection closed|not connected|econn/i.test(b)) return 'unavailable';
  if (status === 404 && /forbidden|not-authorized|item-not-found|not a participant/i.test(b)) return 'not_member';
  return 'unavailable';
}

// Perché il controllo non ha risposto: il cron tratta a parte "rate-overlimit"
// (WhatsApp chiede di rallentare) e, nella rampa, qualunque mancata risposta.
export type GroupLookupUnavailableReason = 'overlimit' | 'timeout' | 'other';

export type GroupLookup =
  | { kind: 'ok'; name: string | null; size: number | null; adminOnly: boolean; community: boolean; self: 'admin' | 'member' | 'unknown' }
  | { kind: 'not_member' }
  | { kind: 'unavailable'; reason: GroupLookupUnavailableReason };

/**
 * GET /group/findGroupInfos: 2 richieste a WhatsApp (metadati + foto). Abort,
 * errore di rete o risposta incomprensibile → 'unavailable', col motivo. Non
 * logga mai il corpo: solo lo status e il riferimento privato del gruppo.
 */
export async function lookupGroup(instance: string, jid: string, ownerPhone: string, timeoutMs: number): Promise<GroupLookup> {
  const base = process.env.EVOLUTION_API_URL;
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!base || !apikey) return { kind: 'unavailable', reason: 'other' };
  const target = normalizeGroupJid(jid);
  if (!target) return { kind: 'unavailable', reason: 'other' };
  try {
    const res = await fetch(
      base + '/group/findGroupInfos/' + encodeURIComponent(instance) + '?groupJid=' + encodeURIComponent(target),
      { headers: { apikey }, signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 2000);
      const kind = classifyGroupLookupFailure(res.status, body);
      console.warn('GROUPS:LOOKUP status=' + res.status + ' result=' + kind + ' to=' + logRecipient(target));
      if (kind === 'not_member') return { kind };
      return { kind, reason: /overlimit/i.test(body) ? 'overlimit' : /timed out|timeout/i.test(body) ? 'timeout' : 'other' };
    }
    const g: any = await res.json();
    if (!g || typeof g !== 'object' || normalizeGroupJid(g.id) !== target) {
      console.warn('GROUPS:LOOKUP unexpected body to=' + logRecipient(target));
      return { kind: 'unavailable', reason: 'other' };
    }
    return {
      kind: 'ok',
      name: groupName(g.subject),
      size: groupSize(g),
      adminOnly: g.announce === true || g.isCommunityAnnounce === true,
      community: g.isCommunity === true,
      self: selfAdminStatus(g, ownerPhone),
    };
  } catch (err) {
    const name = (err as any)?.name || 'Error';
    console.warn('GROUPS:LOOKUP failed name=' + name + ' to=' + logRecipient(target));
    return { kind: 'unavailable', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'other' };
  }
}

// ── Gettoni e segnale "lento" su rate_limit_state (D6, D7) ──

const TOKENS = {
  list: { windowMs: 30 * 60_000, max: 1 },
  check: { windowMs: 10 * 60_000, max: 10 },
} as const;
const SLOW_WINDOW_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000; // daily_reset neutro: daily_count qui non si legge
// Una lettura "in corso" da più di così (timeout della lista + margine) non è finita bene.
const BUSY_GRACE_MS = 30_000;

/** Stesso schema di auth/init: RPC atomica, limite applicato sul conteggio. RPC in errore o segreto assente → si lascia passare. */
export async function takeGroupsToken(supabase: SupabaseClient, kind: 'list' | 'check', phone: string): Promise<boolean> {
  const ref = privateRef(phone);
  if (!ref) return true;
  const { windowMs, max } = TOKENS[kind];
  try {
    const now = Date.now();
    const res = await supabase.rpc('rate_limit_record', {
      p_key: 'grp:' + kind + ':' + ref, p_now: now, p_minute_reset: now + windowMs, p_daily_reset: now + DAY_MS,
    });
    if (!res || res.error) {
      console.warn('GROUPS: token RPC error (fail-open) kind=' + kind);
      return true;
    }
    const count = (res.data as { minute_count?: number } | null)?.minute_count ?? 0;
    return count <= max;
  } catch {
    return true;
  }
}

async function readResetOf(supabase: SupabaseClient, key: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('rate_limit_state')
      .select('minute_reset')
      .eq('key', key)
      .maybeSingle();
    if (error || !data) return null;
    const n = Number((data as { minute_reset?: unknown }).minute_reset);
    return isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * "Lento" = segnato dopo una lista scaduta, oppure una lettura avviata da
 * /api/contacts più di 30 s fa e mai chiusa (vedi markGroupsBusy).
 */
export async function isGroupsSlow(supabase: SupabaseClient, phone: string): Promise<boolean> {
  const ref = privateRef(phone);
  if (!ref) return false;
  const now = Date.now();
  const [slowUntil, busyUntil] = await Promise.all([
    readResetOf(supabase, 'grp:slow:' + ref),
    readResetOf(supabase, 'grp:busy:' + ref),
  ]);
  if (slowUntil !== null && slowUntil > now) return true;
  return busyUntil !== null && busyUntil > now && busyUntil - SLOW_WINDOW_MS < now - BUSY_GRACE_MS;
}

/** La lista è scaduta a 25 s: per 6 h niente letture live (il nostro abort non ferma il lavoro di Evolution). */
export async function markGroupsSlow(supabase: SupabaseClient, phone: string): Promise<void> {
  const ref = privateRef(phone);
  if (!ref) return;
  try {
    const now = Date.now();
    const res = await supabase.rpc('rate_limit_record', {
      p_key: 'grp:slow:' + ref, p_now: now, p_minute_reset: now + SLOW_WINDOW_MS, p_daily_reset: now + DAY_MS,
    });
    if (res?.error) console.warn('GROUPS: slow mark RPC error');
  } catch {
    /* best-effort */
  }
}

/**
 * Lettura avviata da /api/contacts, che risponde dopo 5 s: la lambda può essere
 * congelata prima che la fetch finisca, e allora "lento" non si scriverebbe
 * mai. Si scrive prima "in corso" (6 h) e lo si toglie quando la fetch finisce
 * senza scadere: se resta, la lettura non è finita bene e l'utente è "lento".
 */
async function markGroupsBusy(supabase: SupabaseClient, phone: string): Promise<void> {
  const ref = privateRef(phone);
  if (!ref) return;
  try {
    const now = Date.now();
    const res = await supabase.rpc('rate_limit_record', {
      p_key: 'grp:busy:' + ref, p_now: now, p_minute_reset: now + SLOW_WINDOW_MS, p_daily_reset: now + DAY_MS,
    });
    if (res?.error) console.warn('GROUPS: busy mark RPC error');
  } catch {
    /* best-effort */
  }
}

async function clearGroupsBusy(supabase: SupabaseClient, phone: string): Promise<void> {
  const ref = privateRef(phone);
  if (!ref) return;
  try {
    const res = await supabase.from('rate_limit_state').delete().eq('key', 'grp:busy:' + ref);
    if (res?.error) console.warn('GROUPS: busy clear error');
  } catch {
    /* best-effort */
  }
}

// ── Verdetti positivi recenti (D7a): 20 date di fila nello stesso gruppo senza 20 controlli ──

const CHECK_TTL_MS = 10 * 60_000;
const recentChecks = new Map<string, { name: string | null; size: number | null; at: number }>();

function checkKey(phone: string, jid: string): string {
  return phone + '|' + (normalizeGroupJid(jid) || jid);
}

export function rememberGroupCheck(phone: string, jid: string, v: { name: string | null; size: number | null }): void {
  const now = Date.now();
  if (recentChecks.size > 1000) {
    recentChecks.forEach((e, k) => { if (now - e.at > CHECK_TTL_MS) recentChecks.delete(k); });
  }
  recentChecks.set(checkKey(phone, jid), { name: v.name, size: v.size, at: now });
}

export function recentGroupCheck(phone: string, jid: string): { name: string | null; size: number | null } | null {
  const key = checkKey(phone, jid);
  const e = recentChecks.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CHECK_TTL_MS) {
    recentChecks.delete(key);
    return null;
  }
  return { name: e.name, size: e.size };
}

// ── Lettura della lista (D6, D18) ──

export type GroupsRead = {
  groups: PickerGroup[];
  participantJids: string[];
  source: 'live' | 'cache' | 'stale' | 'none';
  fetchedAt: string | null;
  throttled?: boolean;
  slow?: boolean;
  error?: 'timeout' | 'unavailable';
};

const FRESH_MS = 30 * 60_000;
const STALE_MS = 24 * 3_600_000;
const LIST_TIMEOUT_MS = 25_000;
const CONTACTS_WAIT_MS = 5_000;

type CacheEntry = { groups: PickerGroup[]; participantJids: string[]; fetchedAt: number };
type Attempt =
  | { kind: 'live'; entry: CacheEntry }
  | { kind: 'slow' }
  | { kind: 'throttled' }
  | { kind: 'error'; error: 'timeout' | 'unavailable' };

// Per lambda, chiave il telefono. La vera protezione è il gettone su DB.
const groupsCache = new Map<string, CacheEntry>();
// Un tentativo alla volta per telefono: la voce si toglie quando finisce la
// fetch verso Evolution, non quando un chiamante smette di aspettare.
// `slowMarked`: "lento" si scrive una volta sola per tentativo.
type Live = { attempt: Promise<Attempt>; slowMarked: boolean };
const inflight = new Map<string, Live>();

// Oltre 30 min i partecipanti si buttano (restano solo i gruppi), oltre 24 h tutta la voce.
function sweepGroupsCache(now: number): void {
  groupsCache.forEach((e, k) => {
    const age = now - e.fetchedAt;
    if (age > STALE_MS) groupsCache.delete(k);
    else if (age > FRESH_MS && e.participantJids.length > 0) e.participantJids = [];
  });
}

async function fetchGroupsLive(phone: string, instance: string): Promise<Attempt> {
  const base = process.env.EVOLUTION_API_URL;
  const apikey = process.env.EVOLUTION_API_KEY;
  if (!base || !apikey) return { kind: 'error', error: 'unavailable' };
  try {
    const res = await fetch(base + '/group/fetchAllGroups/' + encodeURIComponent(instance) + '?getParticipants=true', {
      headers: { apikey },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('GROUPS: fetchAllGroups status=' + res.status + ' u=' + userRef(phone));
      return { kind: 'error', error: 'unavailable' };
    }
    const raw = await res.json();
    if (!Array.isArray(raw)) return { kind: 'error', error: 'unavailable' };
    const entry: CacheEntry = { groups: mapGroupsForPicker(raw, phone), participantJids: participantJidsOf(raw), fetchedAt: Date.now() };
    groupsCache.set(phone, entry);
    return { kind: 'live', entry };
  } catch (err) {
    const name = (err as any)?.name;
    return { kind: 'error', error: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unavailable' };
  }
}

async function markSlowOnce(live: Live, supabase: SupabaseClient, phone: string): Promise<void> {
  if (live.slowMarked) return;
  live.slowMarked = true;
  await markGroupsSlow(supabase, phone);
}

// `guard`: chi avvia smette di aspettare prima che la fetch finisca (/api/contacts, 5 s).
function attemptLive(phone: string, instance: string, supabase: SupabaseClient, guard: boolean): Live {
  const running = inflight.get(phone);
  if (running) return running;
  const live = { slowMarked: false } as Live;
  live.attempt = (async (): Promise<Attempt> => {
    if (await isGroupsSlow(supabase, phone)) return { kind: 'slow' };
    if (!(await takeGroupsToken(supabase, 'list', phone))) return { kind: 'throttled' };
    if (guard) await markGroupsBusy(supabase, phone);
    const r = await fetchGroupsLive(phone, instance);
    // D6: è la fetch da 25 s a essere scaduta, chiunque l'abbia avviata. Anche
    // quando l'ha avviata /api/contacts, che dopo 5 s ha smesso di aspettare.
    if (r.kind === 'error' && r.error === 'timeout') await markSlowOnce(live, supabase, phone);
    else if (guard) await clearGroupsBusy(supabase, phone);
    return r;
  })().finally(() => {
    if (inflight.get(phone) === live) inflight.delete(phone);
  });
  inflight.set(phone, live);
  return live;
}

const TIMED_OUT = Symbol('timed_out');

function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

function fromCache(cached: CacheEntry | null, extra: Partial<GroupsRead>, forceStale = false): GroupsRead {
  const now = Date.now();
  if (cached && now - cached.fetchedAt <= STALE_MS) {
    const fresh = now - cached.fetchedAt <= FRESH_MS;
    return {
      groups: cached.groups,
      participantJids: fresh ? cached.participantJids : [],
      source: fresh && !forceStale ? 'cache' : 'stale',
      fetchedAt: new Date(cached.fetchedAt).toISOString(),
      ...extra,
    };
  }
  return { groups: [], participantJids: [], source: 'none', fetchedAt: null, ...extra };
}

/**
 * Ordine: cache fresca (salvo refresh) → tentativo in volo → "lento" →
 * gettone → live. `caller:'contacts'` aspetta al massimo 5 s e per la sua
 * attesa non segna "lento"; `caller:'groups'` aspetta fino a 25 s e, se scade,
 * lo segna. In più "lento" lo segna sempre la fetch che scade a 25 s e, per le
 * letture avviate da /api/contacts, il segno "in corso" mai tolto.
 * `refresh` salta solo la cache fresca, non il gettone né "lento".
 */
export async function readGroups(
  phone: string,
  instance: string,
  supabase: SupabaseClient,
  opts: { caller: 'groups' | 'contacts'; refresh?: boolean },
): Promise<GroupsRead> {
  const t0 = Date.now();
  const r = await readGroupsInner(phone, instance, supabase, opts);
  console.log(
    'GROUPS source=' + r.source + ' n=' + r.groups.length + ' ms=' + (Date.now() - t0) + ' caller=' + opts.caller +
    (r.error ? ' error=' + r.error : '') + (r.throttled ? ' throttled' : '') + (r.slow ? ' slow' : '') +
    ' u=' + userRef(phone),
  );
  return r;
}

async function readGroupsInner(
  phone: string,
  instance: string,
  supabase: SupabaseClient,
  opts: { caller: 'groups' | 'contacts'; refresh?: boolean },
): Promise<GroupsRead> {
  sweepGroupsCache(Date.now());
  const cached = groupsCache.get(phone) || null;
  if (cached && !opts.refresh && Date.now() - cached.fetchedAt <= FRESH_MS) return fromCache(cached, {});

  const live = attemptLive(phone, instance, supabase, opts.caller === 'contacts');
  const res = await within(live.attempt, opts.caller === 'groups' ? LIST_TIMEOUT_MS : CONTACTS_WAIT_MS);
  let error: 'timeout' | 'unavailable' = 'timeout';
  if (res !== TIMED_OUT) {
    switch (res.kind) {
      case 'live':
        return { groups: res.entry.groups, participantJids: res.entry.participantJids, source: 'live', fetchedAt: new Date(res.entry.fetchedAt).toISOString() };
      case 'slow':
        return fromCache(cached, { slow: true });
      case 'throttled':
        return fromCache(cached, { throttled: true });
      case 'error':
        error = res.error;
    }
  }
  if (error === 'timeout' && opts.caller === 'groups') await markSlowOnce(live, supabase, phone);
  return fromCache(cached, { error }, true);
}

/** Solo per i test: azzera cache, tentativi in volo e verdetti recenti. */
export function __resetGroupsStateForTests(): void {
  groupsCache.clear();
  inflight.clear();
  recentChecks.clear();
  warnedNoSecret = false;
}
