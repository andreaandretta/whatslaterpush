import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifyCookie } from '../../../lib/auth-cookie';
import { logAuditEvent, clientIpFromHeaders } from '../../../lib/audit';
import { forceDeleteInstance, instanceNameForPhone } from '../../../lib/evolution';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

type QueueChoice = 'pause' | 'cancel' | 'keep';

// Testo letto dalla dashboard (mapPendingReason: le frasi "In pausa: ..."
// vengono mostrate così come sono sotto la riga in pausa).
const LOGOUT_PAUSE_REASON = 'In pausa: ti eri disconnesso da WhatsLater. Riprendilo quando vuoi.';

async function applyQueueChoice(phone: string, queue: QueueChoice): Promise<number> {
  if (queue === 'keep') return 0;
  const update = queue === 'pause'
    ? { status: 'paused', error_message: LOGOUT_PAUSE_REASON }
    : { status: 'cancelled' };
  const statuses = queue === 'pause' ? ['pending'] : ['pending', 'paused'];
  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_messages')
    .update(update)
    .eq('instance_phone', phone)
    .in('status', statuses)
    .select('id');
  if (error) throw error;
  return data?.length || 0;
}


export async function POST(req: NextRequest) {
  // Best-effort attempt to attribute the logout to a user_phone. If the cookie
  // is already invalid/expired, we still clear it and continue — just log with
  // userPhone=null so we know an anonymous logout was hit.
  // Optional chaining: when invoked from a unit test using the standard
  // web Request object, req.cookies is undefined. Tolerate it — the cookie
  // is cleared either way by the response, and the audit row simply records
  // an anonymous logout.
  const raw = req.cookies?.get?.(AUTH_COOKIE_NAME)?.value;
  const payload = raw ? await verifyCookie(raw) : null;

  // "Disconnetti" must be a REAL disconnect, not just a session logout. When we
  // know whose session this is, tear down their WhatsApp connection too:
  //   1. flip user_instances.connection_status to 'close' — deterministic, and
  //      THIS is what unblocks the anti-hijack guard in /api/auth/init so the
  //      owner can re-pair their own number (the guard 409s a number that is
  //      still 'open' when the caller has no sw_session cookie — which is
  //      exactly the post-logout state).
  //   2. best-effort logout+delete the Evolution instance — actually unlinks the
  //      device. Without this the socket stays open, no CONNECTION_UPDATE close
  //      webhook fires, and connection_status would never leave 'open'.
  // Both are best-effort and must NEVER block the cookie from clearing, or a
  // user could get stuck unable to log out. Anonymous / invalid-cookie logouts
  // skip teardown (no phone to attribute) — this also keeps the anti-hijack
  // guard intact: you can only disconnect the number carried in YOUR cookie.
  // Cosa fare della coda (scelta nel dialogo della dashboard). Prima la coda
  // restava intatta: ai ricollegamenti settimane dopo partiva tutta insieme,
  // con promemoria di eventi già passati (7 set 2026). Default 'pause': una
  // chiamata senza scelta non deve lasciare niente che parta da solo.
  const body = await req.json().catch(() => null) as { queue?: unknown } | null;
  const queue: QueueChoice = body?.queue === 'cancel' || body?.queue === 'keep' ? body.queue : 'pause';
  let queueAffected = 0;

  if (payload?.phone) {
    // Prima della chiusura del collegamento: la scrittura è condizionata su
    // status='pending', quindi una riga già presa dal cron non viene toccata.
    try {
      queueAffected = await applyQueueChoice(payload.phone, queue);
    } catch { /* best-effort — cookie still clears below */ }
    try {
      await getSupabaseAdmin()
        .from('user_instances')
        .update({ connection_status: 'close' })
        .eq('phone_number', payload.phone);
    } catch { /* best-effort — cookie still clears below */ }
    try {
      await forceDeleteInstance(instanceNameForPhone(payload.phone));
    } catch { /* best-effort — cookie still clears below */ }
  }

  await logAuditEvent({
    userPhone: payload?.phone || null,
    eventType: 'auth_logout',
    payload: payload?.phone ? { queue, queue_affected: queueAffected } : {},
    ipAddress: clientIpFromHeaders(req.headers),
  });

  const res = NextResponse.json({ success: true });
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  // Force the browser to drop SW caches, IndexedDB, localStorage, HTTP cache,
  // and any leftover cookies so a shared device cannot serve the previous
  // user's cached API responses on the next login. "storage" also unregisters
  // the active service worker per the Clear-Site-Data spec, which neutralises
  // any older SW that still has /api/ runtime-cached.
  res.headers.set('Clear-Site-Data', '"cache", "cookies", "storage"');
  return res;
}
