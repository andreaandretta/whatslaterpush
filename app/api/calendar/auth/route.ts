/**
 * GET /api/calendar/auth — kick off the Google Calendar connect flow.
 *
 * Redirects the authed user to Google's consent screen (read-only calendar
 * scope). access_type=offline + prompt=consent are REQUIRED: without them
 * Google re-uses a prior grant and omits the refresh_token, which is the only
 * credential we persist (encrypted). The signed `state` ties the callback to
 * this session (see calendar-oauth-state.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { signOAuthState } from '../../../lib/calendar-oauth-state';

export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

function appOrigin(reqUrl: string): string | null {
  // NEXT_PUBLIC_APP_URL is REQUIRED in production (review LOW #4: the request
  // Host is client-influenceable and must not drive OAuth redirect targets).
  // The request-origin fallback survives only for local dev.
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return new URL(reqUrl).origin;
  return null;
}

export async function GET(req: NextRequest) {
  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') {
    return NextResponse.json({ error: 'calendar_sync_disabled' }, { status: 404 });
  }

  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  if (!payload?.phone) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const origin = appOrigin(req.url);
  if (!clientId || !origin) {
    // Flag on but creds/origin missing = misconfigured deploy. Fail loud.
    return NextResponse.json({ error: 'calendar_sync_misconfigured' }, { status: 500 });
  }

  const state = await signOAuthState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/calendar/callback`,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`, 302);
}
