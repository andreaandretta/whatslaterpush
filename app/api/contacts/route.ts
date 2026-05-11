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
  const [contactsRes, chatsRes] = await Promise.allSettled([
    evolutionClient.findContacts(user.instance_name),
    evolutionClient.findChats(user.instance_name),
  ]);
  if (contactsRes.status === 'fulfilled') rawFromContacts = contactsRes.value || [];
  else console.log('CONTACTS-DEBUG findContacts_error=' + (contactsRes.reason?.message || 'unknown'));
  if (chatsRes.status === 'fulfilled') rawFromChats = chatsRes.value || [];
  else console.log('CONTACTS-DEBUG findChats_error=' + (chatsRes.reason?.message || 'unknown'));

  if (contactsRes.status === 'rejected' && chatsRes.status === 'rejected') {
    const msg = (contactsRes.reason?.message || chatsRes.reason?.message || '') as string;
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return NextResponse.json({ error: 'evolution_timeout' }, { status: 504 });
    }
    return NextResponse.json({ error: 'evolution_unavailable' }, { status: 502 });
  }

  console.log('CONTACTS-DEBUG findContacts_count=' + rawFromContacts.length
    + ' findChats_count=' + rawFromChats.length + ' phone=' + phone);

  // Use chats as primary source (richer for Baileys-synced instances). If
  // empty, fall back to findContacts so we don't break instances where chats
  // is empty but contacts is populated.
  const rawContacts: any[] = rawFromChats.length > 0 ? rawFromChats : rawFromContacts;

  const dropped = { noJid: 0, groups: 0, broadcasts: 0, invalidPhone: 0, self: 0 };
  const phoneLengthHist: Record<string, number> = {};
  const out: OutContact[] = [];

  for (const c of rawContacts || []) {
    const jid: string = c?.remoteJid || '';
    if (!jid) { dropped.noJid++; continue; }
    if (jid.includes('@g.us')) { dropped.groups++; continue; }
    if (jid.includes('@broadcast')) { dropped.broadcasts++; continue; }

    const numericPart = jid.split('@')[0];
    const cleanLen = numericPart.replace(/\D/g, '').length;
    phoneLengthHist[String(cleanLen)] = (phoneLengthHist[String(cleanLen)] || 0) + 1;

    const normalized = validatePhone(numericPart);
    if (!normalized) { dropped.invalidPhone++; continue; }
    if (normalized === phone) { dropped.self++; continue; }

    const displayName = (c.name && c.name.trim()) || (c.pushName && c.pushName.trim()) || `+${normalized}`;
    const entry: OutContact = { number: normalized, name: displayName };
    if (c.pushName) entry.pushName = c.pushName;
    out.push(entry);
  }

  console.log('CONTACTS-DEBUG dropped=' + JSON.stringify(dropped) + ' out_count=' + out.length);
  console.log('CONTACTS-DEBUG phone_length_hist=' + JSON.stringify(phoneLengthHist));

  out.sort((a, b) => a.name.localeCompare(b.name, 'it'));

  return NextResponse.json({ contacts: out });
}
