/**
 * GET /api/cron/calendar-sync — scan connected Google calendars (~15min) and
 * reconcile upcoming events (now → +14d) into scheduled_messages reminders.
 *
 * All the pure decisioning lives in app/lib/calendar-sync.ts
 * (diffEventsToActions); this route owns I/O only: token refresh, event
 * listing, applying insert/update/cancel actions, per-connection bookkeeping.
 * One broken connection must never block the others (per-connection
 * try/catch), and a revoked Google grant (invalid_grant → 400/401) disables
 * the connection with last_sync_error='reauth_required' WITHOUT deleting it —
 * the user's settings survive until they reconnect.
 *
 * Trigger: pg_cron (added by the operator, NOT in vercel.json — same posture
 * as send-messages Task 43).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { decryptToken } from '../../../lib/calendar-crypto';
import { GoogleApiError, refreshAccessToken, listUpcomingEvents } from '../../../lib/google-calendar';
import {
  diffEventsToActions,
  MAX_INSERTS_PER_SYNC,
  type ExistingReminderRow,
} from '../../../lib/calendar-sync';
import { stampHeartbeat } from '../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const SYNC_WINDOW_DAYS = 14;
const MAX_CONNECTIONS_PER_RUN = 20;
// Bounded read of the connection's reminder rows (posture #48 — no unbounded
// selects): 14-day window × 100-insert cap keeps real usage far below this.
const MAX_EXISTING_ROWS = 1000;
const TOUCHABLE_STATUSES = ['pending', 'paused'];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY required');
  return createClient(url, key);
}

interface CalendarConnectionRow {
  id: string;
  user_phone: string;
  google_refresh_token_enc: string;
  calendar_id: string;
  reminder_offset_minutes: number;
  message_template: string | null;
}

interface ConnectionSummary {
  connection_id: string;
  status: 'ok' | 'reauth_required' | 'error';
  events?: number;
  inserted?: number;
  updated?: number;
  cancelled?: number;
  skipped_conflicts?: number;
  cap_hit?: boolean;
  error?: string;
}

async function syncConnection(
  supabase: SupabaseClient,
  conn: CalendarConnectionRow,
  now: Date
): Promise<ConnectionSummary> {
  const refreshToken = decryptToken(conn.google_refresh_token_enc);

  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(refreshToken);
  } catch (err) {
    if (err instanceof GoogleApiError && (err.status === 400 || err.status === 401)) {
      // invalid_grant: the user revoked our access on the Google side.
      // Disable + flag for re-auth; NEVER delete (settings survive reconnect).
      await supabase
        .from('calendar_connections')
        .update({ enabled: false, last_sync_error: 'reauth_required' })
        .eq('id', conn.id);
      return { connection_id: conn.id, status: 'reauth_required' };
    }
    throw err;
  }

  const events = await listUpcomingEvents({
    accessToken,
    calendarId: conn.calendar_id || 'primary',
    timeMin: now,
    timeMax: new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000),
  });

  // scheduled_messages rows need user_instance_id (+retry defaults) exactly
  // like the dashboard POST creates them — enrich from user_instances.
  const { data: user, error: userErr } = await supabase
    .from('user_instances')
    .select('id')
    .eq('phone_number', conn.user_phone)
    .maybeSingle();
  if (userErr) throw new Error('user_instances lookup failed: ' + userErr.message);
  if (!user) throw new Error('user_instance_not_found');

  const { data: existingRows, error: rowsErr } = await supabase
    .from('scheduled_messages')
    .select('id, status, scheduled_at, parsed_message, calendar_event_key')
    .like('calendar_event_key', `${conn.id}:%`)
    .limit(MAX_EXISTING_ROWS);
  if (rowsErr) throw new Error('existing reminder rows load failed: ' + rowsErr.message);

  const actions = diffEventsToActions({
    events,
    existingRows: (existingRows || []) as ExistingReminderRow[],
    connection: conn,
    now,
  });
  if (actions.capHit) {
    console.warn(
      `[calendar-sync] insert cap hit for connection ${conn.id} (>${MAX_INSERTS_PER_SYNC} new events truncated; remainder next run)`
    );
  }

  // Inserts one-by-one: the unique index on calendar_event_key can 23505 when
  // a concurrent run won the race — benign per-row skip, never a batch abort.
  let inserted = 0;
  let skippedConflicts = 0;
  for (const row of actions.inserts) {
    const { error } = await supabase.from('scheduled_messages').insert({
      ...row,
      user_instance_id: user.id,
      retry_count: 0,
      max_retries: 3,
    });
    if (!error) {
      inserted++;
    } else if (error.code === '23505') {
      skippedConflicts++;
    } else {
      throw new Error('calendar-sync insert failed: ' + error.message);
    }
  }

  let updated = 0;
  for (const u of actions.updates) {
    // Re-guard status at write time: the send cron may have claimed the row
    // (pending → processing/sent) since our read — those must stay untouched.
    const { error } = await supabase
      .from('scheduled_messages')
      .update({ scheduled_at: u.scheduled_at, parsed_message: u.parsed_message, caption: u.caption })
      .eq('id', u.id)
      .in('status', TOUCHABLE_STATUSES);
    if (error) throw new Error('calendar-sync update failed: ' + error.message);
    updated++;
  }

  let cancelled = 0;
  if (actions.cancels.length > 0) {
    const { error } = await supabase
      .from('scheduled_messages')
      .update({ status: 'cancelled', error_message: 'calendar_event_removed' })
      .in('id', actions.cancels)
      .eq('status', 'pending'); // same write-time re-guard
    if (error) throw new Error('calendar-sync cancel failed: ' + error.message);
    cancelled = actions.cancels.length;
  }

  await supabase
    .from('calendar_connections')
    .update({ last_synced_at: now.toISOString(), last_sync_error: null })
    .eq('id', conn.id);

  return {
    connection_id: conn.id,
    status: 'ok',
    events: events.length,
    inserted,
    updated,
    cancelled,
    skipped_conflicts: skippedConflicts,
    cap_hit: actions.capHit,
  };
}

export async function GET(req: NextRequest) {
  // Accept CRON_SECRET via `Authorization: Bearer` header (what Vercel Cron
  // sends) OR the legacy ?secret= query — matching send-messages (#4).
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? new URL(req.url).searchParams.get('secret');
  if (!provided || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.CALENDAR_SYNC_ENABLED !== 'true') {
    // Opt-in feature off → no work, no heartbeat (monitoring must not expect
    // beats from a disabled feature).
    return NextResponse.json({ enabled: false });
  }

  void stampHeartbeat('calendar-sync'); // Task 56 (#6)

  const supabase = getSupabase();
  const now = new Date();

  const { data: connections, error: connErr } = await supabase
    .from('calendar_connections')
    .select('*')
    .eq('enabled', true)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(MAX_CONNECTIONS_PER_RUN);
  if (connErr) return NextResponse.json({ error: connErr.message }, { status: 500 });

  const results: ConnectionSummary[] = [];
  for (const conn of (connections || []) as CalendarConnectionRow[]) {
    try {
      results.push(await syncConnection(supabase, conn, now));
    } catch (err) {
      // One broken connection must never block the rest of the batch.
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      console.error(`[calendar-sync] connection ${conn.id} failed:`, message);
      // Stamp last_synced_at even on failure so a permanently-broken
      // connection rotates to the back of the oldest-first queue instead of
      // starving the other 19 slots every run.
      await supabase
        .from('calendar_connections')
        .update({ last_synced_at: now.toISOString(), last_sync_error: message })
        .eq('id', conn.id);
      results.push({ connection_id: conn.id, status: 'error', error: message });
    }
  }

  return NextResponse.json({ enabled: true, connections: results.length, results });
}
