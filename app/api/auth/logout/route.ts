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
  // Solo i 'pending', anche per 'cancel' (review fase 1b): il dialogo conta
  // solo quelli ("Hai N messaggi in coda"). I 'paused' sono pause volute
  // (stagione ferma, destinatari sospesi) e restano in pausa.
  const { data, error } = await getSupabaseAdmin()
    .from('scheduled_messages')
    .update(update)
    .eq('instance_phone', phone)
    .in('status', ['pending'])
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

  // Due azioni distinte (fase 1b), scelte nel dialogo della dashboard:
  //
  // scope='device' — "Esci da questo dispositivo": SOLO il cookie. Nessun
  //   unlink, nessun cambio di stato, coda intatta: i promemoria continuano a
  //   partire. È l'uscita normale da un PC condiviso; prima esisteva solo lo
  //   scollegamento, e chi "usciva" a fine giornata fermava tutti i promemoria.
  //
  // altrimenti — "Scollega WhatsApp" (anche un client vecchio senza scope):
  //   1. applica la scelta sulla coda (sotto);
  //   2. connection_status → 'close' (deterministico: il cron smette subito di
  //      provare, il banner lo dice);
  //   3. best-effort logout+delete dell'istanza Evolution: scollega davvero il
  //      dispositivo. Senza, il socket resta aperto e nessun webhook 'close'
  //      arriverebbe mai.
  // NB: il guard anti-hijack di /api/auth/init dal 18 ago guarda paired_at,
  // che il logout non tocca: dopo un logout (qualunque dei due) rientrare da
  // un browser senza cookie resta un 409 → supporto, finché non c'è l'OTP.
  // Tutto best-effort: il cookie si cancella SEMPRE. Logout anonimo / cookie
  // non valido → nessun teardown: si scollega solo il numero del PROPRIO cookie.
  // Cosa fare della coda: prima restava intatta e al ricollegamento settimane
  // dopo partiva tutta insieme (7 set 2026). Default 'pause': una chiamata
  // senza scelta non deve lasciare niente che parta da solo.
  const body = await req.json().catch(() => null) as { queue?: unknown; scope?: unknown } | null;
  const deviceOnly = body?.scope === 'device';
  const queue: QueueChoice = body?.queue === 'cancel' || body?.queue === 'keep' ? body.queue : 'pause';
  let queueAffected = 0;

  if (payload?.phone && !deviceOnly) {
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
    payload: !payload?.phone ? {} : deviceOnly ? { scope: 'device' } : { queue, queue_affected: queueAffected },
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
