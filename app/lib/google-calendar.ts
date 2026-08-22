/**
 * Google Calendar API client (read-only scope).
 *
 * Authorization-code flow; we persist ONLY the refresh token (encrypted via
 * calendar-crypto). Every sync run does refresh_token → access_token, then
 * lists upcoming events. Every fetch is bounded (AbortController 8s, repo
 * pattern) and cache:'no-store' — the Next Data Cache must never freeze a
 * token or an event listing (bug storico stress-index, Task 42).
 */
import type { CalendarEvent } from './calendar-sync';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const CALL_TIMEOUT_MS = 8000;
const MAX_EVENT_PAGES = 2; // 2 × 250 events is plenty for a 14-day window

export class GoogleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

function getOAuthCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET are required');
  }
  return { clientId, clientSecret };
}

async function googleFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function exchangeAuthCode(args: {
  code: string;
  redirectUri: string;
}): Promise<{ refresh_token: string; access_token: string; email?: string }> {
  const { clientId, clientSecret } = getOAuthCreds();
  const res = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: args.code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    throw new GoogleApiError(`Google token exchange failed (${res.status})`, res.status);
  }
  const data = await res.json();
  if (!data.refresh_token || !data.access_token) {
    // No refresh_token = Google re-used a prior grant; our auth URL must send
    // access_type=offline + prompt=consent so this should never happen.
    throw new GoogleApiError('Google token response missing refresh_token/access_token', res.status);
  }

  // Best-effort: grab the account email for display in the dashboard.
  let email: string | undefined;
  try {
    const ui = await googleFetch(USERINFO_URL, {
      headers: { authorization: `Bearer ${data.access_token}` },
    });
    if (ui.ok) {
      const info = await ui.json();
      if (typeof info?.email === 'string') email = info.email;
    }
  } catch {
    // best-effort only — a userinfo failure must not break the connect flow
  }

  return { refresh_token: data.refresh_token, access_token: data.access_token, email };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { clientId, clientSecret } = getOAuthCreds();
  const res = await googleFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!res.ok) {
    // 400/401 with invalid_grant = user revoked access → caller disables the
    // connection and records last_sync_error.
    throw new GoogleApiError(`Google token refresh failed (${res.status})`, res.status);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new GoogleApiError('Google refresh response missing access_token', res.status);
  }
  return data.access_token;
}

export async function listUpcomingEvents(args: {
  accessToken: string;
  calendarId: string;
  timeMin: string | Date;
  timeMax: string | Date;
}): Promise<CalendarEvent[]> {
  const toIso = (v: string | Date) => (v instanceof Date ? v.toISOString() : v);
  const events: CalendarEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_EVENT_PAGES; page++) {
    const params = new URLSearchParams({
      timeMin: toIso(args.timeMin),
      timeMax: toIso(args.timeMax),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const url = `${EVENTS_URL}/${encodeURIComponent(args.calendarId)}/events?${params.toString()}`;
    const res = await googleFetch(url, {
      headers: { authorization: `Bearer ${args.accessToken}` },
    });
    if (!res.ok) {
      throw new GoogleApiError(`Google events list failed (${res.status})`, res.status);
    }
    const data = await res.json();
    if (Array.isArray(data.items)) events.push(...data.items);

    pageToken = data.nextPageToken;
    if (!pageToken) break; // no more pages (beyond page 2 we stop anyway)
  }

  return events;
}
