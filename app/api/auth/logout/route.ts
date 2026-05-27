import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifyCookie } from '../../../lib/auth-cookie';
import { logAuditEvent, clientIpFromHeaders } from '../../../lib/audit';

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
  return res;
}
