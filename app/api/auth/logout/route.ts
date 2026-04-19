import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest) {
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
