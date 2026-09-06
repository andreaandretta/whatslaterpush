/**
 * GET /api/calendar/callback — Google OAuth redirect target.
 *
 * Verifies the signed anti-CSRF state (HMAC + 10min TTL), takes the user
 * identity from the sw_session COOKIE (review LOW #2/#3: the phone never
 * travels in the state/URL, and the persisted identity always matches the
 * browser session — the middleware already requires the cookie here), then
 * exchanges the code, encrypts the refresh token and upserts
 * calendar_connections. Every failure path redirects to
 * /dashboard?calendar=error WITHOUT detail: this URL lands in browser
 * history/logs, so nothing sensitive may leak into it.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '../../../lib/calendar-oauth-state';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../../lib/auth-cookie';
import { exchangeAuthCode } from '../../../lib/google-calendar';
import { encryptToken } from '../../../lib/calendar-crypto';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';


function appOrigin(reqUrl: string): string | null {
  // Must match the origin used by /api/calendar/auth (redirect_uri parity).
  // Required in production (review LOW #4) — request-origin only in dev.
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, '');
  if (process.env.NODE_ENV !== 'production') return new URL(reqUrl).origin;
  return null;
}

export async function GET(req: NextRequest) {
  const origin = appOrigin(req.url);
  // Misconfigured prod (no NEXT_PUBLIC_APP_URL): the error redirect is the
  // only place the request origin is acceptable — no OAuth exchange happens.
  const errorRedirect = () =>
    NextResponse.redirect(`${origin || new URL(req.url).origin}/dashboard?calendar=error`, 302);

  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') return errorRedirect();
  if (!origin) return errorRedirect();

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state');
  if (!code || !rawState) return errorRedirect(); // user denied consent or Google error

  if (!(await verifyOAuthState(rawState))) return errorRedirect(); // tampered/expired state

  // Identity = session cookie, never the state/URL.
  const cookiePayload = await verifyCookie(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  const userPhone = cookiePayload?.phone;
  if (!userPhone) return errorRedirect();

  try {
    // exchangeAuthCode throws GoogleApiError when the 200 lacks refresh_token
    // (re-consent without offline grant) — that lands here → error redirect.
    const tokens = await exchangeAuthCode({
      code,
      redirectUri: `${origin}/api/calendar/callback`,
    });

    const supabase = getSupabaseAdmin();
    // Re-connect resets the error state and re-enables sync (the recovery path
    // for reauth_required); per-user settings (calendar_id, offset, template)
    // are NOT in the upsert so an existing row keeps them, a new row gets the
    // DDL defaults.
    const { error } = await supabase.from('calendar_connections').upsert(
      {
        user_phone: userPhone,
        google_refresh_token_enc: encryptToken(tokens.refresh_token),
        google_email: tokens.email ?? null,
        enabled: true,
        last_sync_error: null,
      },
      { onConflict: 'user_phone' }
    );
    if (error) throw new Error('calendar_connections upsert failed: ' + error.message);

    return NextResponse.redirect(`${origin}/dashboard?calendar=connected`, 302);
  } catch (err) {
    console.error(
      '[calendar/callback] connect failed:',
      err instanceof Error ? err.message : String(err)
    );
    return errorRedirect();
  }
}
