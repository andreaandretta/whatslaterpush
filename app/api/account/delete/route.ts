import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { logAuditEvent, hashContactRefSync } from '../../../lib/audit';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';
import { forceDeleteInstance } from '../../../lib/evolution';
import { revokeGoogleGrant } from '../../../lib/google-revoke';

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

  // Google Calendar (fase 1b): delete_user_account NON tocca
  // calendar_connections, quindi refresh token cifrato, google_email e template
  // sopravvivevano, e un numero riciclato avrebbe ripreso a leggere il
  // calendario del vecchio proprietario. Finché la RPC non la include (serve
  // una migration e l'ok di Andrea) la riga si cancella da qui, PRIMA della
  // cascata: se fallisce ci si ferma come per lo storage (nessuna mezza
  // cancellazione, un retry riparte pulito). Prima si revoca il grant su
  // Google, best-effort: un grant già revocato o la rete giù non bloccano.
  let googleRevoked = false;
  {
    const { data: conn, error: selErr } = await supabase
      .from('calendar_connections')
      .select('id, google_refresh_token_enc')
      .eq('user_phone', phone)
      .maybeSingle();
    if (selErr) {
      return NextResponse.json({ error: 'calendar_purge_failed', stage: 'select', message: selErr.message }, { status: 500 });
    }
    if (conn) {
      googleRevoked = await revokeGoogleGrant((conn as any).google_refresh_token_enc);
      const { error: calErr } = await supabase
        .from('calendar_connections')
        .delete()
        .eq('user_phone', phone);
      if (calErr) {
        return NextResponse.json({ error: 'calendar_purge_failed', message: calErr.message }, { status: 500 });
      }
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

  // Teardown Evolution COMPLETO (fase 1b), lo stesso del logout: logout +
  // delete + verifica che l'istanza sia sparita. Prima c'era solo
  // /instance/logout: l'istanza e tutto ciò che Baileys aveva sincronizzato
  // (contatti, chat, storico al primo pairing) restavano sul nodo Hetzner —
  // solo delete li cancella. Non fatale (il DB è già pulito), ma l'esito
  // si riporta in evolution_disconnected invece di nasconderlo.
  let evolutionDisconnected = false;
  if (instanceName) {
    try {
      evolutionDisconnected = await forceDeleteInstance(instanceName);
    } catch {
      evolutionDisconnected = false;
    }
    if (!evolutionDisconnected) {
      console.error('[account/delete] Evolution teardown not verified for ' + hashContactRefSync(phone) + ' — instance may still hold synced data, operator cleanup needed');
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
      google_revoked: googleRevoked,
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
