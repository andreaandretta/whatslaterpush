import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';
import { evolutionClient } from '../../../lib/evolution/client';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

interface OutContact {
  number: string;
  name: string;
  pushName?: string;
}

// Baileys hardcodes "Você" (PT-BR for "You") as the sender pushName on
// outgoing/self messages when no proper profile name is available. Other
// localizations may leak through as well — never accept these as a contact's
// real name.
const SELF_PLACEHOLDERS = new Set([
  'Você', 'You', 'Tu', 'Tú', 'Sie', 'Ich', 'Me', 'Yo',
]);

export async function GET(req: NextRequest) {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const phone = payload.phone;
  const supabase = getSupabase();

  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('phone_number', phone)
    .single();

  if (!user?.instance_name) return NextResponse.json({ error: 'User not found' }, { status: 404 });

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
    const msg = (contactsRes.reason?.message || chatsRes.reason?.message || '') as string;
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return NextResponse.json({ error: 'evolution_timeout' }, { status: 504 });
    }
    return NextResponse.json({ error: 'evolution_unavailable' }, { status: 502 });
  }

  // Prefer findChats (richer for Baileys-synced instances), fall back to
  // findContacts when chats is empty.
  const rawContacts: any[] = rawFromChats.length > 0 ? rawFromChats : rawFromContacts;
  const byNumber = new Map<string, OutContact>();

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

  const out: OutContact[] = Array.from(byNumber.values());
  out.sort((a, b) => a.name.localeCompare(b.name, 'it'));

  return NextResponse.json({ contacts: out });
}
