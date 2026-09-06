import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifyCookie } from '../../../lib/auth-cookie';
import { logAuditEvent, clientIpFromHeaders } from '../../../lib/audit';
import { forceDeleteInstance, instanceNameForPhone } from '../../../lib/evolution';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';


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
  if (payload?.phone) {
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
    payload: {},
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
