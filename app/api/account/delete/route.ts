import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { logAuditEvent, hashContactRefSync, clientIpFromHeaders } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

// User-scoped tables whose ownership column is a phone string. Iterated in
// the order below; ordering inside the list is not load-bearing (no FKs
// across these) but audit_events MUST be pruned after this loop and
// user_instances MUST be deleted last (see the explicit calls below).
const USER_SCOPED_DELETES: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'scheduled_messages', column: 'instance_phone' },
  { table: 'whatsapp_contacts', column: 'user_phone' },
  { table: 'user_templates', column: 'user_phone' },
  { table: 'contact_label_assignments', column: 'user_phone' },
  { table: 'contact_labels', column: 'user_phone' },
  { table: 'pending_contacts', column: 'owner_phone' },
  { table: 'pending_auth_sessions', column: 'phone' },
];

export async function POST(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { confirmation } = body || {};
  if (typeof confirmation !== 'string' || confirmation !== phone) {
    return NextResponse.json({
      error: 'confirmation_mismatch',
      message: 'Per cancellare l\'account devi inviare il tuo numero di telefono in body.confirmation.',
    }, { status: 400 });
  }

  const supabase = getSupabase();

  // Resolve instance_name BEFORE deletion so rate_limit_state keys can be
  // built (the inst:<instance_name> rows are keyed by instance, not phone).
  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('phone_number', phone)
    .single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const instanceName = (user as any).instance_name as string;
  const userKey = 'user:' + phone;
  const instKey = 'inst:' + instanceName;
  const deletedTables: string[] = [];

  for (const { table, column } of USER_SCOPED_DELETES) {
    const { error } = await supabase.from(table).delete().eq(column, phone);
    if (error) {
      return NextResponse.json({
        error: 'cascade_failed',
        table,
        message: error.message,
      }, { status: 500 });
    }
    deletedTables.push(table);
  }

  {
    const { error } = await supabase.from('rate_limit_state').delete().in('key', [userKey, instKey]);
    if (error) {
      return NextResponse.json({ error: 'cascade_failed', table: 'rate_limit_state', message: error.message }, { status: 500 });
    }
    deletedTables.push('rate_limit_state');
  }

  // audit_events prune BEFORE the final 'account_deleted' event, otherwise
  // that event would also get wiped and we'd lose forensic trail.
  {
    const { error } = await supabase.from('audit_events').delete().eq('user_phone', phone);
    if (error) {
      return NextResponse.json({ error: 'cascade_failed', table: 'audit_events', message: error.message }, { status: 500 });
    }
    deletedTables.push('audit_events');
  }

  // user_instances LAST — keeps the auth gate evaluable for a manual retry
  // if any earlier delete failed and short-circuited above.
  {
    const { error } = await supabase.from('user_instances').delete().eq('phone_number', phone);
    if (error) {
      return NextResponse.json({ error: 'cascade_failed', table: 'user_instances', message: error.message }, { status: 500 });
    }
    deletedTables.push('user_instances');
  }

  // Best-effort Evolution instance logout. Failure is non-fatal — the DB
  // side is already wiped; if Evolution can't be reached, the Baileys
  // session just stays alive on the droplet until manual cleanup.
  let evolutionDisconnected = false;
  if (process.env.EVOLUTION_API_URL && process.env.EVOLUTION_API_KEY && instanceName) {
    try {
      const res = await fetch(
        process.env.EVOLUTION_API_URL + '/instance/logout/' + instanceName,
        { method: 'DELETE', headers: { apikey: process.env.EVOLUTION_API_KEY } },
      );
      evolutionDisconnected = res.ok;
    } catch {
      evolutionDisconnected = false;
    }
  }

  // Final audit event. userPhone:null because the row no longer exists; the
  // one-way hash lets us correlate forensically without storing PII.
  const phoneHash = hashContactRefSync(phone);
  await logAuditEvent({
    userPhone: null,
    eventType: 'account_deleted',
    payload: {
      phone_hash: phoneHash,
      deleted_tables: deletedTables,
      evolution_disconnected: evolutionDisconnected,
    },
    ipAddress: clientIpFromHeaders(req.headers),
  });

  const response = NextResponse.json({
    status: 'ok',
    phone_hash: phoneHash,
    deleted_tables: deletedTables,
    evolution_disconnected: evolutionDisconnected,
  });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
