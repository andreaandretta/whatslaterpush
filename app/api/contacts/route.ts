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

  let rawContacts: any[];
  try {
    rawContacts = await evolutionClient.findContacts(user.instance_name);
  } catch (e: any) {
    const msg = e?.message || '';
    if (msg.includes('timeout') || msg.includes('aborted')) {
      return NextResponse.json({ error: 'evolution_timeout' }, { status: 504 });
    }
    return NextResponse.json({ error: 'evolution_unavailable' }, { status: 502 });
  }

  console.log('CONTACTS-DEBUG raw_count=' + (rawContacts?.length ?? 0) + ' phone=' + phone);

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
