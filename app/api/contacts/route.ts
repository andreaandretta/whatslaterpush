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

  for (const c of rawContacts || []) {
    const normalized = jidToNumber(c?.remoteJid || '');
    if (!normalized) continue;
    if (byNumber.has(normalized)) continue;

    const displayName = (c.name && c.name.trim()) || (c.pushName && c.pushName.trim()) || `+${normalized}`;
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

  const out: OutContact[] = Array.from(byNumber.values());
  out.sort((a, b) => a.name.localeCompare(b.name, 'it'));

  return NextResponse.json({ contacts: out });
}
