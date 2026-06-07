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

// Admin paths gated by ADMIN_PHONES allowlist (cookie auth). Anything under
// /admin* or /api/admin/* listed here must be reached by a paired user whose
// phone is in ADMIN_PHONES. Other /api/admin/* paths (contacts-stats,
// backfill-photos) keep their legacy MONITORING_SECRET / CRON_SECRET guards
// at the handler level — those are called from cron-job.org and curl, not the
// browser, so they're not part of the cookie-protected surface.
const ADMIN_API_COOKIE_PATHS = [
  '/api/admin/data',
  '/api/admin/droplet',
  '/api/admin/sla',
  '/api/admin/chat',
  '/api/admin/tower',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGE_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function isAdminPage(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isAdminCookieApi(pathname: string): boolean {
  return ADMIN_API_COOKIE_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

function parseAdminPhones(): string[] {
  const raw = process.env.ADMIN_PHONES;
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Authenticated users must never land back on the connect/login pages (e.g.
  // after hitting the browser Back button from the dashboard). While the
  // sw_session cookie is valid we bounce them to /dashboard; the cookie is only
  // cleared by logout ("Disconnetti"), so /connect reappears only after that.
  if (pathname === '/' || pathname === '/connect' || pathname === '/login') {
    const authed = await verifyCookie(request.cookies.get(AUTH_COOKIE_NAME)?.value);
    if (authed) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Admin gate: enforce ADMIN_PHONES allowlist on /admin* pages and the 4
  // cookie-protected admin APIs. Fail-closed if ADMIN_PHONES env var is unset.
  // Pages: 404 rewrite (information hiding from non-admin users / attackers).
  // APIs: 403 JSON (clear signal to the operator if their config breaks).
  const adminPage = isAdminPage(pathname);
  const adminApi = isAdminCookieApi(pathname);
  if (adminPage || adminApi) {
    const allowlist = parseAdminPhones();
    const payload = await verifyCookie(request.cookies.get(AUTH_COOKIE_NAME)?.value);
    const authorized = allowlist.length > 0 && payload != null && allowlist.includes(payload.phone);
    if (!authorized) {
      // TEMP DIAGNOSTIC — remove after debugging /admin gate. No PII (counts/booleans/length only).
      console.log(`[admin-gate] deny path=${pathname} allowlistCount=${allowlist.length} hasCookie=${payload != null} phoneLen=${payload?.phone?.length ?? 0} match=${payload != null && allowlist.includes(payload.phone)}`);
      if (adminPage) {
        // Bare 404 — information hiding from non-admin users and attackers.
        // No app/not-found.tsx exists, so the browser renders its default
        // error UI. Good enough; the goal is "looks like /admin doesn't
        // exist", not a pretty page.
        return new NextResponse(null, { status: 404 });
      }
      // adminApi: 403 (operator-friendly signal) or 401 if no cookie at all.
      if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // authorized: fall through to cookie refresh below
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
