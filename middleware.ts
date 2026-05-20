import { NextResponse, type NextRequest } from 'next/server';
import { verifyCookie, signCookie, shouldRefresh, AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE } from './app/lib/auth-cookie';

const PUBLIC_PATHS = [
  '/',
  '/connect',
  '/login',
  '/privacy',
  '/terms',
  '/monitoring',
];

const PUBLIC_PREFIXES = [
  '/api/auth',
  '/api/webhook',
  '/api/cron',
  '/api/health',
  '/api/admin',
  '/api/monitoring',
  '/api/debug-logs',
  '/api/payment/webhook',
  '/mockup',
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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$|.*\\.jpg$).*)',
  ],
};
