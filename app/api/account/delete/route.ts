import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { logAuditEvent, hashContactRefSync } from '../../../lib/audit';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';


async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

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

  const supabase = getSupabaseAdmin();

  // Resolve instance_name BEFORE deletion so rate_limit_state keys can be
  // built (the inst:<instance_name> rows are keyed by instance, not phone).
  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('phone_number', phone)
    .single();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const instanceName = (user as any).instance_name as string;

  // #29: purge the user's media from Storage FIRST. Uploads live under the
  // {phone}/ prefix (per the messages IDOR guard). Abort on ANY failure so we
  // never half-delete — a retry re-purges (idempotent) then runs the cascade.
  // (cap at 1000 files; >30d media is already removed by cleanup-media.)
  let removedMedia = 0;
  {
    const { data: files, error: listErr } = await supabase.storage
      .from('message-media')
      .list(phone, { limit: 1000 });
    if (listErr) {
      return NextResponse.json({ error: 'storage_purge_failed', stage: 'list', message: listErr.message }, { status: 500 });
    }
    const paths = (files || []).map((f: { name: string }) => phone + '/' + f.name);
    if (paths.length > 0) {
      const { error: rmErr } = await supabase.storage.from('message-media').remove(paths);
      if (rmErr) {
        return NextResponse.json({ error: 'storage_purge_failed', stage: 'remove', message: rmErr.message }, { status: 500 });
      }
      removedMedia = paths.length;
    }
  }

  // #58 + #30: atomic DB cascade (all-or-nothing) via the transactional RPC,
  // which also prunes the instance-keyed, IP-bearing audit_events.
  {
    const { error } = await supabase.rpc('delete_user_account', { p_phone: phone, p_instance_name: instanceName });
    if (error) {
      return NextResponse.json({ error: 'cascade_failed', message: error.message }, { status: 500 });
    }
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

  // Final audit event. userPhone:null + NO ipAddress — GDPR erasure keeps no
  // identifying PII; the one-way phone hash is enough to confirm the deletion.
  const phoneHash = hashContactRefSync(phone);
  await logAuditEvent({
    userPhone: null,
    eventType: 'account_deleted',
    payload: {
      phone_hash: phoneHash,
      removed_media: removedMedia,
      evolution_disconnected: evolutionDisconnected,
    },
  });

  const response = NextResponse.json({
    status: 'ok',
    phone_hash: phoneHash,
    removed_media: removedMedia,
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
