import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signCookie, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../../../lib/auth-cookie';
import { logAuditEvent, clientIpFromHeaders } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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
  const supabase = getSupabase();

  const { data: session, error } = await supabase
    .from('pending_auth_sessions')
    .select('id, phone, status, instance_name, expires_at, pairing_code, conn_state')
    .eq('id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error('[auth/check] DB error:', error.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if (!session) {
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
