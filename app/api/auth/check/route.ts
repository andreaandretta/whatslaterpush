import { NextRequest, NextResponse } from 'next/server';
import { signCookie, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../../../lib/auth-cookie';
import { logAuditEvent, clientIpFromHeaders } from '../../../lib/audit';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';
import { PENDING_SESSION_GRACE_MS, AUTHENTICATED_SESSION_GRACE_MS } from '../../../lib/auth-session-grace';

export const dynamic = 'force-dynamic';


// Polled by /connect every ~2.5s during the pairing window. Receives the
// sessionId in the JSON body (not the URL) so it never lands in Vercel access
// logs or Sentry URL breadcrumbs — Codex pre-launch audit finding #9.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : null;
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();

  // Niente filtro expires_at nella query (fase 1b): nascondeva anche le righe
  // GIÀ autenticate. Chi inseriva il codice sul telefono e tornava nel browser
  // dopo i 10 minuti di TTL riceveva 410 invece del cookie; al nuovo tentativo
  // paired_at era timbrato → 409, bloccato fuori con recupero solo operatore.
  // Grazie oltre expires_at (app/lib/auth-session-grace.ts): una sessione in
  // attesa resta interrogabile quanto il webhook può ancora autenticarla; una
  // autenticata resta ritirabile più a lungo (monouso: si cancella al ritiro).
  const { data: session, error } = await supabase
    .from('pending_auth_sessions')
    .select('id, phone, status, instance_name, expires_at, pairing_code, conn_state')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    console.error('[auth/check] DB error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  const expiresMs = session ? new Date(session.expires_at).getTime() : NaN;
  const expired = !session || !Number.isFinite(expiresMs) || (
    session.status === 'authenticated'
      ? expiresMs + AUTHENTICATED_SESSION_GRACE_MS <= Date.now()
      : expiresMs + PENDING_SESSION_GRACE_MS <= Date.now()
  );
  if (expired) {
    return NextResponse.json({ error: 'Session not found or expired' }, { status: 410 });
  }
  if (session.status !== 'authenticated') {
    // pairingCode = codice CORRENTE (il webhook lo aggiorna a ogni rotazione
    // di Evolution): la pagina lo mostra al posto di quello iniziale ormai
    // morto. connState alimenta il feedback "collegamento in corso".
    return NextResponse.json({
      authenticated: false,
      pairingCode: session.pairing_code || null,
      connState: session.conn_state || null,
    });
  }

  const cookieValue = await signCookie({
    phone: session.phone,
    instanceName: session.instance_name || `SchedWhats-${session.phone}`,
  });

  await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);

  await logAuditEvent({
    userPhone: session.phone,
    eventType: 'auth_login',
    payload: {
      user_agent: (req.headers.get('user-agent') || '').substring(0, 200),
    },
    ipAddress: clientIpFromHeaders(req.headers),
  });

  const res = NextResponse.json({ authenticated: true, redirect: '/dashboard' });
  res.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  });
  return res;
}
