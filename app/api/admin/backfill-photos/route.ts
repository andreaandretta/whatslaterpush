import { NextRequest, NextResponse } from 'next/server';
import { evolutionClient } from '../../../../lib/evolution/client';
import { validatePhone } from '../../../lib/phone';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Admin operation that (re)fills whatsapp_contacts.profile_pic_url using bulk
// findChats/findContacts (one call per endpoint per user). Deliberately avoids
// /chat/fetchProfile (per-contact) because that's what saturated Evolution in
// v1 and forced photos off.
//
// Modes:
//   default          → fill only rows where profile_pic_url IS NULL.
//   ?mode=refresh    → ALSO overwrite stale (expired) non-null pps.whatsapp.net
//                      URLs. After a re-pair every cached URL 403s; the old
//                      NULL-only behaviour skipped those non-null rows entirely
//                      (they were the ones that broke). Refresh fixes them.
//   ?phone=<e164>    → restrict to a single user (run the operator first, then
//                      sweep the fleet). Combine with mode=refresh.
//
// Safety: we only ever WRITE a non-null URL that DIFFERS from the stored one
// (so we never blank a value and never write a no-op — a re-pair changes the
// URL token, so stale != fresh). findChats/findContacts return data only when
// Evolution persists contacts (DATABASE_SAVE_DATA_CONTACTS/CHATS=true, Fase 1).
//
// Auth: CRON_SECRET (same pattern as /api/admin/contacts-stats), via either
// `?secret=…` or `Authorization: Bearer …`.
//
// Throughput: users processed serially with a 200ms breather between them, so
// a 1000-user fleet runs ~3 minutes and never has more than one Evolution
// call in flight at a time.


// Mirror the jid→number normalisation used in /api/contacts/route.ts so
// we don't drift on edge cases (device suffix, groups, broadcasts).
function jidToNumber(jid: any): string | null {
  if (typeof jid !== 'string' || !jid) return null;
  if (jid.includes('@g.us') || jid.includes('@broadcast')) return null;
  const numericPart = (jid.split('@')[0] || '').split(':')[0];
  return validatePhone(numericPart) || null;
}

function extractJid(c: any): string | null {
  if (typeof c?.remoteJid === 'string' && c.remoteJid.includes('@')) return c.remoteJid;
  if (typeof c?.id === 'string' && c.id.includes('@')) return c.id;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

interface BackfillFailure {
  user_phone: string;
  reason: string;
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('secret');
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = queryToken || headerToken;
  if (provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ?mode=refresh (or ?refresh=true) → also overwrite stale non-null URLs.
  // ?phone=<e164> → restrict to one user.
  const refresh = url.searchParams.get('mode') === 'refresh'
    || url.searchParams.get('refresh') === 'true';
  const onlyPhone = url.searchParams.get('phone');

  const supabase = getSupabaseAdmin();

  let usersQuery = supabase
    .from('user_instances')
    .select('phone_number, instance_name');
  if (onlyPhone) usersQuery = usersQuery.eq('phone_number', onlyPhone);
  const { data: users, error: usersErr } = await usersQuery;

  if (usersErr) {
    return NextResponse.json({ error: usersErr.message }, { status: 500 });
  }

  const userList = (users || []) as Array<{ phone_number: string; instance_name: string }>;

  let usersProcessed = 0;
  let usersSkipped = 0;
  let totalMissing = 0;
  let totalFound = 0;
  let totalPersisted = 0;
  const failures: BackfillFailure[] = [];

  for (const u of userList) {
    if (!u.phone_number || !u.instance_name) {
      usersSkipped++;
      continue;
    }

    // Default: only rows still missing a photo. Refresh mode: ALL rows, so we
    // can overwrite stale (expired) non-null URLs left behind by a re-pair.
    // If the user has no candidate rows, skip without spending an Evolution call.
    let rowsQuery = supabase
      .from('whatsapp_contacts')
      .select('contact_number, profile_pic_url')
      .eq('user_phone', u.phone_number);
    if (!refresh) rowsQuery = rowsQuery.is('profile_pic_url', null);
    const { data: candidates } = await rowsQuery;

    // contact_number -> currently-stored URL (null in default mode). We persist
    // only when Evolution returns a non-null URL that DIFFERS from this value.
    const existingByNum = new Map<string, string | null>();
    for (const r of (candidates || []) as Array<{ contact_number: string; profile_pic_url: string | null }>) {
      if (r.contact_number) existingByNum.set(r.contact_number, r.profile_pic_url);
    }

    if (existingByNum.size === 0) {
      usersSkipped++;
      continue;
    }

    totalMissing += existingByNum.size;

    // Bulk pull from Evolution. findChats is preferred (richer for
    // Baileys-synced instances); findContacts is a fallback source when
    // findChats has nothing for a given JID.
    const [chatsRes, contactsRes] = await Promise.allSettled([
      evolutionClient.findChats(u.instance_name),
      evolutionClient.findContacts(u.instance_name),
    ]);

    if (chatsRes.status === 'rejected' && contactsRes.status === 'rejected') {
      const reason = (chatsRes.reason?.message || contactsRes.reason?.message || 'unknown') as string;
      failures.push({ user_phone: u.phone_number, reason });
      await sleep(200);
      continue;
    }

    const fromChats = chatsRes.status === 'fulfilled' ? (chatsRes.value || []) : [];
    const fromContacts = contactsRes.status === 'fulfilled' ? (contactsRes.value || []) : [];

    // Merge into one number→URL map, with findChats winning when both have
    // a non-empty URL.
    const urlByNumber = new Map<string, string>();
    const collect = (rows: any[]) => {
      for (const c of rows) {
        const jid = extractJid(c);
        const num = jidToNumber(jid);
        if (!num) continue;
        const url = (typeof c.profilePicUrl === 'string' && c.profilePicUrl.trim()) ? c.profilePicUrl.trim() : null;
        if (!url) continue;
        if (!urlByNumber.has(num)) urlByNumber.set(num, url);
      }
    };
    collect(fromChats);
    collect(fromContacts);

    // Persist a fresh URL only when Evolution has a non-null value that DIFFERS
    // from what we already store: never blanks an existing URL, never writes a
    // no-op. In refresh mode this is what replaces stale (expired) URLs; in
    // default mode existingUrl is null, so any found URL is written (= old
    // fill-NULL behaviour, unchanged).
    const rows: Array<Record<string, any>> = [];
    for (const [num, existingUrl] of existingByNum) {
      const photoUrl = urlByNumber.get(num);
      if (!photoUrl) continue;
      if (photoUrl === existingUrl) continue;
      rows.push({
        user_phone: u.phone_number,
        contact_number: num,
        name: null,
        push_name: null,
        profile_pic_url: photoUrl,
        source: 'MANUAL',
      });
    }

    totalFound += rows.length;

    if (rows.length === 0) {
      usersProcessed++;
      await sleep(200);
      continue;
    }

    const { data: persisted, error: rpcErr } = await supabase
      .rpc('upsert_whatsapp_contacts', { p_rows: rows });

    if (rpcErr) {
      failures.push({ user_phone: u.phone_number, reason: rpcErr.message });
      await sleep(200);
      continue;
    }

    totalPersisted += typeof persisted === 'number' ? persisted : rows.length;
    usersProcessed++;
    await sleep(200);
  }

  return NextResponse.json({
    ok: true,
    mode: refresh ? 'refresh' : 'fill-null',
    scope: onlyPhone || 'all',
    users_total: userList.length,
    users_processed: usersProcessed,
    users_skipped: usersSkipped,
    total_contacts_considered: totalMissing,
    total_photos_found: totalFound,
    total_photos_persisted: totalPersisted,
    failures,
  });
}
