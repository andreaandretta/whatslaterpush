import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';
import { phoneDigitsFromJid, phoneJidFromContact, isLegacyLidRow } from '../../lib/jid';
import { evolutionClient } from '../../../lib/evolution/client';
import { getSupabaseAdmin } from '../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';


interface OutContact {
  number: string;
  name: string;
  pushName?: string;
  // Cached WhatsApp profile picture URL. Always a direct pps.whatsapp.net
  // link — the browser loads it without proxying through our server.
  // Absent (not empty string) when no photo is known.
  photoUrl?: string;
  // True when the row was inserted via manual entry in /api/messages
  // (ContactPicker "Nuovo contatto" path). Lets the picker include
  // numbers that the webhook has never confirmed via CONTACTS_UPSERT
  // (no push_name yet) without resorting to the fragile
  // `name.startsWith('+')` proxy. Omitted when false to keep the JSON
  // response lean.
  addedManually?: boolean;
}

// Baileys hardcodes "Você" (PT-BR for "You") as the sender pushName on
// outgoing/self messages when no proper profile name is available. Other
// localizations may leak through as well — never accept these as a contact's
// real name.
const SELF_PLACEHOLDERS = new Set([
  'Você', 'You', 'Tu', 'Tú', 'Sie', 'Ich', 'Me', 'Yo',
]);

// Picker visibility rule, applied uniformly to both cache-first and
// Evolution-fallback paths. Includes a contact when:
//   - its display name is not the synthetic `+<number>` placeholder
//     (real name from WhatsApp name/pushName/verifiedName), OR
//   - it was added manually via /api/messages POST (user typed the number
//     in ContactPicker "Nuovo contatto", so they expect it back in the
//     picker).
//
// Replaces the old `name.startsWith('+')` proxy which would silently
// exclude legitimate contacts whose name happens to start with "+" (e.g.
// someone saved as "+39 Anna" in an address book).
function isVisibleInPicker(c: OutContact): boolean {
  return c.name !== `+${c.number}` || c.addedManually === true;
}

// #3a: at/above this many SYNCED cached rows for the instance (the cache size,
// measured BEFORE the visibility/label filters) we trust the cache as the whole
// address book and skip Evolution entirely (fast, immune to reconnect flakiness).
// Below it the cache is treated as too thin to be complete, so we ALSO consult the
// live source and merge (seeding the cache in first, so it always survives — if
// Evolution fails we still serve the cache and the picker never empties).
//
// Tunable on purpose: our ICP-D audience (coaches/parishes/driving schools) skews
// SMALL, so many users sit at ~15-40 contacts and will land on the live+merge path
// (= one Evolution call per picker open). That's functionally correct thanks to the
// seed-merge but it's extra load/latency for them — watch the `UNDER_THRESHOLD` log
// below and lower this if too many users fall under it.
//   Backlog (better long-term, not now): (1) a `contacts_synced_at` flag set when a
//   bulk CONTACTS_SET arrives = a clean gate instead of this size heuristic; and/or
//   (2) serve the cache fast + refresh live in the BACKGROUND instead of blocking
//   the picker on the live call.
const CACHE_ONLY_MIN = 25;

// Budget del percorso live (cache sottile). Il client abortisce a 8 s e mostra
// "Sto sincronizzando…"; la lambda Vercel Hobby muore a ~10 s. Senza un tetto le tre
// chiamate Evolution non avevano NESSUN timeout e l'arricchimento nomi poteva
// aggiungere altri 10 s + 15 s: il picker non si apriva mai. Meglio una lista con
// qualche nome in meno ENTRO il budget che nessuna lista.
const LIVE_CALL_TIMEOUT_MS = 5000;  // findContacts / findChats / fetchAllGroups (in parallelo)
const LIVE_TOTAL_BUDGET_MS = 7000;  // oltre, whatsappNumbers e findMessages si saltano

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timeout after ' + ms + 'ms')), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

type CachedContactRow = { contact_number: string; name: string | null; push_name: string | null; profile_pic_url: string | null; added_manually: boolean | null; created_at?: string | null };

// Photo URL without the signed query string: the same person's picture has the
// same path under their LID row and under their phone row.
function photoKey(url: string | null | undefined): string | null {
  const u = (url || '').trim();
  return u ? u.split('?')[0] : null;
}

// A name made only of digits/punctuation (or no name at all).
function isDigitsOnlyName(name: string | null): boolean {
  return !name || /^[+\d\s().-]+$/.test(name);
}

// No real name: empty, or the contact's own number written out ("+39 340 …").
// A digits-only name that is NOT the number (e.g. "118") was chosen on purpose.
function isNoRealName(name: string | null, num: string): boolean {
  if (!name) return true;
  if (!isDigitsOnlyName(name)) return false;
  const d = name.replace(/\D/g, '');
  return d.length >= 6 && (num.endsWith(d) || d.endsWith(num.slice(-9)));
}

// Numbers of the LID rows (see isLegacyLidRow): hidden from picker and recents.
function legacyLidNumbers(rows: CachedContactRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) if (isLegacyLidRow(row)) out.add(row.contact_number);
  return out;
}

// whatsapp_contacts rows -> picker contacts (+ visibility filter). Shared by the
// fast cache-only path and the live+seed path so the cache behaves identically.
function cachedRowsToContacts(rows: CachedContactRow[], phone: string): OutContact[] {
  // LID rows (14-15 digits, not typed by the user, stored before the webhook
  // learned to skip them) are Linked IDs, not numbers: sending to them fails
  // with "Numero non su WhatsApp". They never reach the picker. Their display
  // name is carried over to the phone row with the SAME photo when that phone
  // row has no real name (only when exactly one phone row matches: no guess).
  const lidNameByPhoto = new Map<string, string>();
  const phoneRowsByPhoto = new Map<string, number>();
  for (const row of rows) {
    const key = photoKey(row.profile_pic_url);
    if (!key) continue;
    if (isLegacyLidRow(row)) {
      const label = (row.name && row.name.trim()) || (row.push_name && row.push_name.trim()) || '';
      if (label && !isDigitsOnlyName(label)) lidNameByPhoto.set(key, label);
    } else {
      phoneRowsByPhoto.set(key, (phoneRowsByPhoto.get(key) || 0) + 1);
    }
  }

  const out: OutContact[] = [];
  for (const row of rows) {
    const num = row.contact_number;
    if (!num || num === phone) continue;
    if (isLegacyLidRow(row)) continue;
    let name = (row.name && row.name.trim()) || null;
    const pushName = (row.push_name && row.push_name.trim()) || null;
    const key = photoKey(row.profile_pic_url);
    if (key && lidNameByPhoto.has(key) && phoneRowsByPhoto.get(key) === 1 && isNoRealName(name, num) && isDigitsOnlyName(pushName)) {
      name = lidNameByPhoto.get(key)!;
    } else if (name && row.added_manually !== true && isNoRealName(name, num) && pushName && !isDigitsOnlyName(pushName)) {
      name = null; // the synced name is just the number: show the WhatsApp name
    }
    const entry: OutContact = { number: num, name: name || pushName || `+${num}` };
    if (pushName) entry.pushName = pushName;
    const photoUrl = (row.profile_pic_url && row.profile_pic_url.trim()) || null;
    if (photoUrl) entry.photoUrl = photoUrl;
    if (row.added_manually === true) entry.addedManually = true;
    out.push(entry);
  }
  return out.filter(isVisibleInPicker);
}

// Tetto PostgREST: una select senza .range() torna al massimo ~1000 righe (default
// "Max rows" di Supabase) e SENZA errore — la rubrica veniva troncata in silenzio
// (plan.md Task 48). Si legge a pagine ordinate per contact_number: l'indice unico
// (user_phone, contact_number) rende l'ordinamento gratuito e le pagine stabili.
const CONTACTS_PAGE = 1000;
const CONTACTS_MAX_PAGES = 10; // 10.000 righe; oltre ci si ferma e si logga

// Una pagina che fallisce NON è "fine rubrica": si ritenta una volta; se fallisce
// ancora la lettura è PARZIALE (header X-Contacts-Partial: il client la mostra ma
// non la mette in cache). Prima un errore transitorio troncava la lista in silenzio.
// Il flag viaggia nel valore di ritorno, MAI in una variabile di modulo: la stessa
// istanza serverless può servire più richieste insieme.
async function fetchAllCachedRows(supabase: any, phone: string): Promise<{ rows: CachedContactRow[]; partial: boolean }> {
  let partial = false;
  const query = (i: number) => supabase
    .from('whatsapp_contacts')
    .select('contact_number, name, push_name, profile_pic_url, added_manually, created_at')
    .eq('user_phone', phone)
    .order('contact_number', { ascending: true })
    .range(i * CONTACTS_PAGE, (i + 1) * CONTACTS_PAGE - 1);
  const page = async (i: number): Promise<{ rows: CachedContactRow[]; failed: boolean }> => {
    let r: any = await query(i);
    if (r?.error) r = await query(i); // un solo retry
    if (r?.error) {
      console.error('CONTACTS:GET page ' + i + ' failed:', r.error?.message || r.error);
      return { rows: [], failed: true };
    }
    return { rows: (r?.data || []) as CachedContactRow[], failed: false };
  };

  // Caso normale (rubrica < 1000): UNA sola richiesta, come prima.
  const first = await page(0);
  if (first.failed) return { rows: [], partial: true };
  if (first.rows.length < CONTACTS_PAGE) return { rows: first.rows, partial: false };

  // Prima pagina piena → le successive a ondate di 3 in parallelo. La Map toglie i
  // doppioni se una riga scivola tra due pagine per un upsert concorrente del webhook.
  const byNumber = new Map<string, CachedContactRow>();
  first.rows.forEach((r) => byNumber.set(r.contact_number, r));
  let next = 1;
  let exhausted = false;
  while (!exhausted && next < CONTACTS_MAX_PAGES) {
    const wave = [next, next + 1, next + 2].filter((i) => i < CONTACTS_MAX_PAGES);
    const results = await Promise.all(wave.map((i) => page(i)));
    results.forEach((res) => {
      if (res.failed) { partial = true; return; } // non è la fine: si prosegue
      res.rows.forEach((row) => byNumber.set(row.contact_number, row));
      if (res.rows.length < CONTACTS_PAGE) exhausted = true;
    });
    next += wave.length;
  }
  if (!exhausted) console.warn('CONTACTS:GET page cap hit rows=' + byNumber.size + ' max_pages=' + CONTACTS_MAX_PAGES);
  return { rows: Array.from(byNumber.values()), partial };
}

// ?label=<uuid> → numeri assegnati a quell'etichetta; null = nessun filtro.
// Solo la QUERY: così parte in parallelo con le altre. Il filtro vero è applyLabel().
async function fetchLabelAllowed(supabase: any, phone: string, labelId: string | null): Promise<Set<string> | null> {
  if (!labelId) return null;
  const { data: assignments } = await supabase
    .from('contact_label_assignments')
    .select('contact_number')
    .eq('user_phone', phone)
    .eq('label_id', labelId);
  return new Set<string>((assignments || []).map((a: any) => a.contact_number));
}

function applyLabel(out: OutContact[], allowed: Set<string> | null): OutContact[] {
  return allowed ? out.filter((c) => allowed.has(c.number)) : out;
}

type RecentRow = { recipient_number: string; recipient_name: string | null };

// Recenti, parte QUERY (parallelizzabile): ultimi 50 invii non cancellati, DESC.
async function fetchRecentRows(supabase: any, phone: string): Promise<RecentRow[]> {
  const { data: recentRows } = await supabase
    .from('scheduled_messages')
    .select('recipient_number, recipient_name')
    .eq('instance_phone', phone)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(50);
  return (recentRows || []) as RecentRow[];
}

// Recenti, parte PURA: up to 10 distinct most-recent recipients. first-wins = latest
// (rows are ORDER BY created_at DESC). Enriches from `byNumber` so a recent that's
// also a known contact keeps its name/photo. Computed for BOTH paths.
function buildRecents(recentRows: RecentRow[], phone: string, byNumber: Map<string, OutContact>, lidNumbers: Set<string>): OutContact[] {
  const recents: OutContact[] = [];
  const seen = new Set<string>();
  for (const row of recentRows) {
    const num = row.recipient_number;
    if (!num || num === phone) continue;
    if (seen.has(num)) continue;
    seen.add(num);
    // A LID recipient (a message that failed with "Numero non su WhatsApp") must
    // not come back as a "recent" contact: picking it would fail again.
    if (lidNumbers.has(num)) continue;
    recents.push(byNumber.get(num) ?? { number: num, name: (row.recipient_name && row.recipient_name.trim()) || `+${num}` });
    if (recents.length >= 10) break;
  }
  return recents;
}

// Risposta JSON + header di misura. Server-Timing si legge in DevTools → Network →
// Timing, oppure da JS con performance.getEntriesByType('resource')[i].serverTiming.
function respond(body: { contacts: OutContact[]; recents: OutContact[] }, source: string, t0: number, dbMs: number, evoMs: number, partial = false) {
  const total = performance.now() - t0;
  const timing = [`db;dur=${dbMs.toFixed(1)}`];
  if (evoMs > 0) timing.push(`evo;dur=${evoMs.toFixed(1)}`);
  timing.push(`total;dur=${total.toFixed(1)}`);
  return NextResponse.json(body, {
    headers: {
      'Server-Timing': timing.join(', '),
      'X-Contacts-Source': source,
      'X-Contacts-Count': String(body.contacts.length),
      ...(partial ? { 'X-Contacts-Partial': '1' } : {}),
    },
  });
}

export async function GET(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const t0 = performance.now();
  const phone = payload.phone;
  const supabase = getSupabaseAdmin();
  const reqUrl = new URL(req.url);
  const labelId = reqUrl.searchParams.get('label');
  // ?prefetch=1 = riscaldamento a pagina ferma dal dashboard: MAI Evolution, solo cache
  // (un utente con cache sottile non deve far partire la pipeline live a ogni visita).
  const prefetchOnly = reqUrl.searchParams.get('prefetch') === '1';

  // ── Cache-first: read from whatsapp_contacts populated by webhook ──
  // The webhook persists CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE /
  // MESSAGING_HISTORY_SET into this table via upsert_whatsapp_contacts RPC.
  // On cache-hit we skip the entire Evolution pipeline (findContacts +
  // findChats + fetchAllGroups + whatsappNumbers + findMessages) — saves
  // 5-15s and avoids Evolution timeouts.
  //
  // Le 4 letture sono indipendenti → partono INSIEME (prima erano 3-4 round-trip
  // in fila verso Supabase: utente → rubrica → etichetta → recenti).
  const [userRes, cachedRead, allowed, recentRows] = await Promise.all([
    supabase.from('user_instances').select('instance_name').eq('phone_number', phone).single(),
    fetchAllCachedRows(supabase, phone),
    fetchLabelAllowed(supabase, phone, labelId),
    fetchRecentRows(supabase, phone),
  ]);
  const dbMs = performance.now() - t0;
  const cached = cachedRead.rows;
  const cachedPartial = cachedRead.partial;
  const user = (userRes as any)?.data;

  if (!user?.instance_name) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const cachedContacts = cachedRowsToContacts(cached, phone);
  const lidNumbers = legacyLidNumbers(cached);
  // Sync-completeness signal = the TOTAL synced rows for this instance, BEFORE the
  // visibility AND label filters. We gate cache-only on THIS (the instance's cache
  // size), not on what the user is currently viewing — so a fully-synced user who
  // filters by a small label (e.g. 5 contacts) still takes the fast cache path
  // instead of a useless live Evolution call.
  const syncedCount = cached.length;

  // Fast cache-only path: a substantial synced cache is trusted as the full address
  // book, so we skip the entire Evolution pipeline (saves 5-15s, immune to reconnect
  // flakiness). #3a: gated on the instance's synced-row count >= CACHE_ONLY_MIN — no
  // longer a bare ">0", which let a 1-row cache shadow the real address book forever.
  if (syncedCount >= CACHE_ONLY_MIN || prefetchOnly) {
    const out = [...applyLabel(cachedContacts, allowed)]
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    // Arricchimento dai contatti NON filtrati: un recente fuori dall'etichetta attiva
    // tiene comunque nome e foto.
    const recents = buildRecents(recentRows, phone, new Map(cachedContacts.map((c) => [c.number, c])), lidNumbers);
    console.log('CONTACTS:GET source=cache-only count=' + out.length + ' recents=' + recents.length + ' raw=' + syncedCount + ' db_ms=' + Math.round(dbMs));
    return respond({ contacts: out, recents }, syncedCount >= CACHE_ONLY_MIN ? 'cache-only' : 'cache-only-prefetch', t0, dbMs, 0, cachedPartial);
  }

  // Thin/empty cache (< CACHE_ONLY_MIN) → consult the live Evolution source AND seed
  // it with the cache. Seeding first means the cache wins for what it has and ALWAYS
  // survives — if Evolution fails we still serve the cache (picker never empties).
  // The UNDER_THRESHOLD log is the signal for tuning CACHE_ONLY_MIN with real data.
  console.log('CONTACTS:GET source=live+seed UNDER_THRESHOLD cache=' + cachedContacts.length + ' min=' + CACHE_ONLY_MIN);

  const byNumber = new Map<string, OutContact>();
  for (const c of cachedContacts) byNumber.set(c.number, c);

  const tEvo = performance.now();
  let rawFromContacts: any[] = [];
  let rawFromChats: any[] = [];
  let rawGroups: any[] = [];
  const [contactsRes, chatsRes, groupsRes] = await Promise.allSettled([
    withTimeout(evolutionClient.findContacts(user.instance_name), LIVE_CALL_TIMEOUT_MS, 'findContacts'),
    withTimeout(evolutionClient.findChats(user.instance_name), LIVE_CALL_TIMEOUT_MS, 'findChats'),
    withTimeout(evolutionClient.fetchAllGroups(user.instance_name, true), LIVE_CALL_TIMEOUT_MS, 'fetchAllGroups'),
  ]);
  // Millisecondi rimasti prima di LIVE_TOTAL_BUDGET_MS (misurati dall'inizio della GET).
  const remainingMs = () => LIVE_TOTAL_BUDGET_MS - (performance.now() - t0);
  if (contactsRes.status === 'fulfilled') rawFromContacts = contactsRes.value || [];
  if (chatsRes.status === 'fulfilled') rawFromChats = chatsRes.value || [];
  if (groupsRes.status === 'fulfilled') rawGroups = groupsRes.value || [];

  if (contactsRes.status === 'rejected' && chatsRes.status === 'rejected') {
    // Evolution is down. If we have ANY seeded cache, serve it — the picker must
    // never empty (#3a). Only when there's nothing cached do we surface the error,
    // and the client shows a "syncing…/retry" state for that case (#3b).
    if (byNumber.size === 0) {
      const msg = (contactsRes.reason?.message || chatsRes.reason?.message || '') as string;
      if (msg.includes('timeout') || msg.includes('aborted')) {
        return NextResponse.json({ error: 'evolution_timeout' }, { status: 504 });
      }
      return NextResponse.json({ error: 'evolution_unavailable' }, { status: 502 });
    }
    console.log('CONTACTS:GET evolution down — serving seeded cache only count=' + byNumber.size);
    const out = [...applyLabel(Array.from(byNumber.values()).filter(isVisibleInPicker), allowed)]
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const recents = buildRecents(recentRows, phone, byNumber, lidNumbers);
    return respond({ contacts: out, recents }, 'seed-only-evolution-down', t0, dbMs, performance.now() - tEvo, cachedPartial);
  }

  // Prefer findChats (richer for Baileys-synced instances), fall back to
  // findContacts when chats is empty. byNumber is already seeded with the cache
  // above; the discovery loops below skip numbers it already has (cache wins).
  const rawContacts: any[] = rawFromChats.length > 0 ? rawFromChats : rawFromContacts;

  // JIDs can include a device suffix like `393401234567:5@s.whatsapp.net` — we
  // must strip the `:N` before normalising, otherwise the digits get folded
  // into the phone number.
  const jidToNumber = (jid: string): string | null => {
    // Only phone JIDs: a LID (`@lid`) is not a number (app/lib/jid.ts).
    const numericPart = phoneDigitsFromJid(jid);
    if (!numericPart) return null;
    const normalized = validatePhone(numericPart);
    if (!normalized || normalized === phone) return null;
    return normalized;
  };

  // Evolution v2 sometimes leaves `remoteJid` null on Baileys-synced rows and
  // puts the JID in `.id` instead — but `.id` may also be a Prisma UUID, so we
  // only accept strings that actually look like a JID.
  const extractJid = (c: any): string | null => {
    return phoneJidFromContact(c);
  };

  for (const c of rawContacts || []) {
    const jid = extractJid(c);
    if (!jid) continue;
    const normalized = jidToNumber(jid);
    if (!normalized) continue;
    if (byNumber.has(normalized)) continue;

    // Baileys cannot read the user's address book, so `pushName` (the name the
    // contact set on their own device) is the only reliable source. `name` and
    // `verifiedName` are usually null outside business accounts.
    const displayName =
      (c.pushName && c.pushName.trim()) ||
      (c.name && c.name.trim()) ||
      (c.verifiedName && c.verifiedName.trim()) ||
      `+${normalized}`;
    const entry: OutContact = { number: normalized, name: displayName };
    if (c.pushName) entry.pushName = c.pushName;
    const photoUrl =
      (typeof c.profilePicUrl === 'string' && c.profilePicUrl.trim()) ? c.profilePicUrl.trim() : null;
    if (photoUrl) entry.photoUrl = photoUrl;
    byNumber.set(normalized, entry);
  }

  // Supplement with group participants — Baileys' Contact table only sees
  // people who have messaged the user directly, so anyone the user shares a
  // group with but has never DM'd would otherwise be missing.
  for (const g of rawGroups || []) {
    const participants = Array.isArray(g?.participants) ? g.participants : [];
    for (const p of participants) {
      const normalized = jidToNumber(p?.id || '');
      if (!normalized) continue;
      if (byNumber.has(normalized)) continue;
      byNumber.set(normalized, { number: normalized, name: `+${normalized}` });
    }
  }

  // Enrich the group-only contacts (those whose display name is still the
  // "+number" fallback) with the pushName/name that WhatsApp has cached for
  // them. Doing it one-by-one via /chat/fetchProfile would be hundreds of
  // calls; /chat/whatsappNumbers accepts a batch and returns name fields
  // when the server has them.
  const unnamed: string[] = [];
  for (const [num, entry] of byNumber) {
    if (entry.name === `+${num}`) unnamed.push(num);
  }

  if (unnamed.length > 0 && remainingMs() > 1500) {
    const BATCH_SIZE = 100;
    const batches: string[][] = [];
    for (let i = 0; i < unnamed.length; i += BATCH_SIZE) {
      batches.push(unnamed.slice(i, i + BATCH_SIZE));
    }

    const enrichBudget = remainingMs() - 500;
    const results = await Promise.allSettled(
      batches.map((b) => withTimeout(evolutionClient.whatsappNumbers(user.instance_name, b), enrichBudget, 'whatsappNumbers'))
    );

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value || []) {
        const jidPart = (item.jid || '').split('@')[0].split(':')[0];
        const numericPart = jidPart || (item.number || '').replace(/\D/g, '');
        const normalized = validatePhone(numericPart);
        if (!normalized) continue;
        const entry = byNumber.get(normalized);
        if (!entry) continue;
        const name = (item.name && item.name.trim())
          || (item.pushName && item.pushName.trim())
          || (item.verifiedName && item.verifiedName.trim());
        if (!name) continue;
        entry.name = name;
        if (item.pushName) entry.pushName = item.pushName;
      }
    }
  }

  // Backfill names from recent messages — every Message row carries pushName
  // from the WhatsApp envelope, even when Chat.pushName is null. One bulk
  // call covers every contact the user has actually chatted with.
  try {
    if (remainingMs() <= 1500) throw new Error('live budget exhausted — name backfill skipped');
    const msgRes: any = await withTimeout(evolutionClient.findMessages(user.instance_name, 2000), remainingMs() - 500, 'findMessages');
    const messages: any[] =
      msgRes?.messages?.records ||
      msgRes?.records ||
      (Array.isArray(msgRes) ? msgRes : []);
    const nameByPhone = new Map<string, string>();
    for (const m of messages) {
      // Outgoing messages carry the SENDER's pushName (= the user, often
      // "Você" from Baileys' hardcoded fallback) but their remoteJid is the
      // RECIPIENT — mapping the two would name contacts after ourselves.
      if (m?.key?.fromMe === true) continue;
      const pushName = typeof m?.pushName === 'string' ? m.pushName.trim() : '';
      if (!pushName) continue;
      if (SELF_PLACEHOLDERS.has(pushName)) continue;

      // Group messages: pushName belongs to `key.participant`, not to the
      // group's remoteJid. This lets us name people we only share a group
      // with, without any extra API call.
      const participantJid = m?.key?.participant;
      if (participantJid) {
        const pNorm = jidToNumber(participantJid);
        if (pNorm && !nameByPhone.has(pNorm)) nameByPhone.set(pNorm, pushName);
        continue;
      }

      const jid = m?.key?.remoteJid;
      if (!jid) continue;
      const normalized = jidToNumber(jid);
      if (!normalized) continue;
      if (!nameByPhone.has(normalized)) nameByPhone.set(normalized, pushName);
    }
    for (const [num, entry] of byNumber) {
      if (entry.name === `+${num}`) {
        const fromMessages = nameByPhone.get(num);
        if (fromMessages) {
          entry.name = fromMessages;
          entry.pushName = fromMessages;
        }
      }
    }
  } catch (err: any) {
    console.error('NAME_BACKFILL_FAILED', err?.message || err);
  }

  const merged: OutContact[] = Array.from(byNumber.values()).filter(isVisibleInPicker);
  merged.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const out = applyLabel(merged, allowed);
  // Recents computed here too (was hardcoded []): a thin-cache user can still have
  // send history, and #3a serves this live+seed path for them.
  const recents = buildRecents(recentRows, phone, byNumber, lidNumbers);
  return respond({ contacts: out, recents }, 'live+seed', t0, dbMs, performance.now() - tEvo, cachedPartial);
}
