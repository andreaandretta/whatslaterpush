import { NextResponse, type NextRequest } from 'next/server';
import { verifyCookie, signCookie, shouldRefresh, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from './app/lib/auth-cookie';

const PUBLIC_PATHS = [
  '/',
  '/connect',
  '/login',
  '/privacy',
  '/terms',
  '/monitoring',
  // PWA artifacts. The matcher below already excludes them so they never
  // hit this function in practice, but listing them here is a safety net
  // — if the matcher regex is ever loosened by accident, the manifest
  // and SW still pass through. Their absence breaks install + offline.
  '/manifest.json',
  '/sw.js',
  '/offline',
];

const PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/webhook',
  '/api/cron',
  '/api/health',
  '/api/admin',
  '/api/ops',
  '/api/monitoring',
  '/api/debug-logs',
  '/api/payment/webhook',
];

const PROTECTED_PAGE_PATHS = ['/dashboard', '/admin'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Authenticated users must never land back on the connect/login pages (e.g.
  // after hitting the browser Back button from the dashboard). While the
  // sw_session cookie is valid we bounce them to /dashboard; the cookie is only
  // cleared by logout ("Disconnetti"), so /connect reappears only after that.
  if (pathname === '/connect' || pathname === '/login') {
    const authed = await verifyCookie(request.cookies.get(AUTH_COOKIE_NAME)?.value);
    if (authed) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const cookieRaw = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(cookieRaw);

  if (!payload) {
    if (isProtectedPage(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (shouldRefresh(payload)) {
    const newCookie = await signCookie({ phone: payload.phone, instanceName: payload.instanceName });
    const res = NextResponse.next();
    res.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: newCookie,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE,
    });
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // PWA-generated assets (manifest.json, sw.js + sourcemap, workbox-*,
  // swe-worker-*, fallback-*) are excluded so they're served as plain
  // static files. Without this exclusion the middleware 401s the
  // manifest fetch and Chrome/Safari drop the install affordance.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest\\.json|sw\\.js|workbox-|swe-worker-|fallback-|.*\\.png$|.*\\.svg$|.*\\.jpg$).*)',
  ],
};
