import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';
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

type CachedContactRow = { contact_number: string; name: string | null; push_name: string | null; profile_pic_url: string | null; added_manually: boolean | null };

// whatsapp_contacts rows -> picker contacts (+ visibility filter). Shared by the
// fast cache-only path and the live+seed path so the cache behaves identically.
function cachedRowsToContacts(rows: CachedContactRow[], phone: string): OutContact[] {
  const out: OutContact[] = [];
  for (const row of rows) {
    const num = row.contact_number;
    if (!num || num === phone) continue;
    const name = (row.name && row.name.trim()) || null;
    const pushName = (row.push_name && row.push_name.trim()) || null;
    const entry: OutContact = { number: num, name: name || pushName || `+${num}` };
    if (pushName) entry.pushName = pushName;
    const photoUrl = (row.profile_pic_url && row.profile_pic_url.trim()) || null;
    if (photoUrl) entry.photoUrl = photoUrl;
    if (row.added_manually === true) entry.addedManually = true;
    out.push(entry);
  }
  return out.filter(isVisibleInPicker);
}

// ?label=<uuid> → intersect with that label's assignment list; no-op without ?label.
async function applyLabelFilter(supabase: any, phone: string, url: URL, out: OutContact[]): Promise<OutContact[]> {
  const labelId = url.searchParams.get('label');
  if (!labelId) return out;
  const { data: assignments } = await supabase
    .from('contact_label_assignments')
    .select('contact_number')
    .eq('user_phone', phone)
    .eq('label_id', labelId);
  const allowed = new Set((assignments || []).map((a: any) => a.contact_number));
  return out.filter(c => allowed.has(c.number));
}

// Recenti: up to 10 distinct most-recent recipients (excl. cancelled). first-wins =
// latest (query is ORDER BY created_at DESC). Enriches from `byNumber` so a recent
// that's also a known contact keeps its name/photo. Computed for BOTH paths.
async function computeRecents(supabase: any, phone: string, byNumber: Map<string, OutContact>): Promise<OutContact[]> {
  const { data: recentRows } = await supabase
    .from('scheduled_messages')
    .select('recipient_number, recipient_name')
    .eq('instance_phone', phone)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(50);
  const recents: OutContact[] = [];
  const seen = new Set<string>();
  for (const row of (recentRows || []) as Array<{ recipient_number: string; recipient_name: string | null }>) {
    const num = row.recipient_number;
    if (!num || num === phone) continue;
    if (seen.has(num)) continue;
    seen.add(num);
    recents.push(byNumber.get(num) ?? { number: num, name: (row.recipient_name && row.recipient_name.trim()) || `+${num}` });
    if (recents.length >= 10) break;
  }
  return recents;
}

export async function GET(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const phone = payload.phone;
  const supabase = getSupabaseAdmin();

  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('phone_number', phone)
    .single();

  if (!user?.instance_name) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // ── Cache-first: read from whatsapp_contacts populated by webhook ──
  // The webhook persists CONTACTS_SET / CONTACTS_UPSERT / CONTACTS_UPDATE /
  // MESSAGING_HISTORY_SET into this table via upsert_whatsapp_contacts RPC.
  // On cache-hit we skip the entire Evolution pipeline (findContacts +
  // findChats + fetchAllGroups + whatsappNumbers + findMessages) — saves
  // 5-15s and avoids Evolution timeouts.
  const { data: cached } = await supabase
    .from('whatsapp_contacts')
    .select('contact_number, name, push_name, profile_pic_url, added_manually')
    .eq('user_phone', phone);
  const cachedContacts = cachedRowsToContacts((cached || []) as CachedContactRow[], phone);
  // Sync-completeness signal = the TOTAL synced rows for this instance, BEFORE the
  // visibility AND label filters. We gate cache-only on THIS (the instance's cache
  // size), not on what the user is currently viewing — so a fully-synced user who
  // filters by a small label (e.g. 5 contacts) still takes the fast cache path
  // instead of a useless live Evolution call.
  const syncedCount = cached?.length || 0;

  // Fast cache-only path: a substantial synced cache is trusted as the full address
  // book, so we skip the entire Evolution pipeline (saves 5-15s, immune to reconnect
  // flakiness). #3a: gated on the instance's synced-row count >= CACHE_ONLY_MIN — no
  // longer a bare ">0", which let a 1-row cache shadow the real address book forever.
  if (syncedCount >= CACHE_ONLY_MIN) {
    const out = [...await applyLabelFilter(supabase, phone, new URL(req.url), cachedContacts)]
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const recents = await computeRecents(supabase, phone, new Map(out.map((c) => [c.number, c])));
    console.log('CONTACTS:GET source=cache-only count=' + out.length + ' recents=' + recents.length + ' raw=' + (cached?.length || 0));
    return NextResponse.json({ contacts: out, recents });
  }

  // Thin/empty cache (< CACHE_ONLY_MIN) → consult the live Evolution source AND seed
  // it with the cache. Seeding first means the cache wins for what it has and ALWAYS
  // survives — if Evolution fails we still serve the cache (picker never empties).
  // The UNDER_THRESHOLD log is the signal for tuning CACHE_ONLY_MIN with real data.
  console.log('CONTACTS:GET source=live+seed UNDER_THRESHOLD cache=' + cachedContacts.length + ' min=' + CACHE_ONLY_MIN);

  const byNumber = new Map<string, OutContact>();
  for (const c of cachedContacts) byNumber.set(c.number, c);

  let rawFromContacts: any[] = [];
  let rawFromChats: any[] = [];
  let rawGroups: any[] = [];
  const [contactsRes, chatsRes, groupsRes] = await Promise.allSettled([
    evolutionClient.findContacts(user.instance_name),
    evolutionClient.findChats(user.instance_name),
    evolutionClient.fetchAllGroups(user.instance_name, true),
  ]);
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
    const out = [...await applyLabelFilter(supabase, phone, new URL(req.url), Array.from(byNumber.values()).filter(isVisibleInPicker))]
      .sort((a, b) => a.name.localeCompare(b.name, 'it'));
    const recents = await computeRecents(supabase, phone, byNumber);
    return NextResponse.json({ contacts: out, recents });
  }

  // Prefer findChats (richer for Baileys-synced instances), fall back to
  // findContacts when chats is empty. byNumber is already seeded with the cache
  // above; the discovery loops below skip numbers it already has (cache wins).
  const rawContacts: any[] = rawFromChats.length > 0 ? rawFromChats : rawFromContacts;

  // JIDs can include a device suffix like `393401234567:5@s.whatsapp.net` — we
  // must strip the `:N` before normalising, otherwise the digits get folded
  // into the phone number.
  const jidToNumber = (jid: string): string | null => {
    if (!jid || jid.includes('@g.us') || jid.includes('@broadcast')) return null;
    const numericPart = (jid.split('@')[0] || '').split(':')[0];
    const normalized = validatePhone(numericPart);
    if (!normalized || normalized === phone) return null;
    return normalized;
  };

  // Evolution v2 sometimes leaves `remoteJid` null on Baileys-synced rows and
  // puts the JID in `.id` instead — but `.id` may also be a Prisma UUID, so we
  // only accept strings that actually look like a JID.
  const extractJid = (c: any): string | null => {
    if (typeof c?.remoteJid === 'string' && c.remoteJid.includes('@')) return c.remoteJid;
    if (typeof c?.id === 'string' && c.id.includes('@')) return c.id;
    if (typeof c?.key?.remoteJid === 'string' && c.key.remoteJid.includes('@')) return c.key.remoteJid;
    return null;
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

  if (unnamed.length > 0) {
    const BATCH_SIZE = 100;
    const batches: string[][] = [];
    for (let i = 0; i < unnamed.length; i += BATCH_SIZE) {
      batches.push(unnamed.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.allSettled(
      batches.map((b) => evolutionClient.whatsappNumbers(user.instance_name, b))
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
    const msgRes: any = await evolutionClient.findMessages(user.instance_name, 2000);
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
  const out = await applyLabelFilter(supabase, phone, new URL(req.url), merged);
  // Recents computed here too (was hardcoded []): a thin-cache user can still have
  // send history, and #3a serves this live+seed path for them.
  const recents = await computeRecents(supabase, phone, byNumber);
  return NextResponse.json({ contacts: out, recents });
}
