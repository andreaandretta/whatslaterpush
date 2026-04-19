import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { signCookie, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }
  const supabase = getSupabase();

  const { data: session, error } = await supabase
    .from('pending_auth_sessions')
    .select('id, phone, status, instance_name, expires_at')
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
    return NextResponse.json({ authenticated: false });
  }

  const cookieValue = signCookie({
    phone: session.phone,
    instanceName: session.instance_name || `SchedWhats-${session.phone}`,
  });

  await supabase.from('pending_auth_sessions').delete().eq('id', sessionId);

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
