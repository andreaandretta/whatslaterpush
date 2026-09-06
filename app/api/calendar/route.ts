/**
 * /api/calendar — connection status + settings for the authed user.
 *
 * GET    → connection state (flag off → {enabled:false}, the dashboard hides
 *          the whole section on it).
 * PATCH  → update reminder_offset_minutes / message_template / enabled.
 * DELETE → disconnect: cancel the still-pending auto-scheduled reminders,
 *          then drop the connection row (token included).
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';

const MIN_OFFSET_MINUTES = 5;
const MAX_OFFSET_MINUTES = 2880; // 48h
const MAX_TEMPLATE_CHARS = 3500;


async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

function flagOff(): boolean {
  return process.env.CALENDAR_SYNC_ENABLED !== 'true';
}

export async function GET(req: NextRequest) {
  if (flagOff()) return NextResponse.json({ enabled: false });

  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data: conn, error } = await supabase
    .from('calendar_connections')
    .select('id, google_email, calendar_id, reminder_offset_minutes, message_template, enabled, last_synced_at, last_sync_error')
    .eq('user_phone', phone)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!conn) {
    return NextResponse.json({
      enabled: true,
      connected: false,
      email: null,
      calendar_id: null,
      reminder_offset_minutes: null,
      message_template: null,
      sync_enabled: null,
      last_synced_at: null,
      last_sync_error: null,
    });
  }

  return NextResponse.json({
    enabled: true,
    connected: true,
    email: conn.google_email ?? null,
    calendar_id: conn.calendar_id,
    reminder_offset_minutes: conn.reminder_offset_minutes,
    message_template: conn.message_template ?? null,
    sync_enabled: conn.enabled,
    last_synced_at: conn.last_synced_at ?? null,
    last_sync_error: conn.last_sync_error ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  if (flagOff()) return NextResponse.json({ error: 'calendar_sync_disabled' }, { status: 404 });

  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};

  if ('reminder_offset_minutes' in body) {
    const v = body.reminder_offset_minutes;
    if (
      typeof v !== 'number' || !Number.isInteger(v) ||
      v < MIN_OFFSET_MINUTES || v > MAX_OFFSET_MINUTES
    ) {
      return NextResponse.json(
        { error: 'invalid_reminder_offset_minutes', min: MIN_OFFSET_MINUTES, max: MAX_OFFSET_MINUTES },
        { status: 400 }
      );
    }
    patch.reminder_offset_minutes = v;
  }

  if ('message_template' in body) {
    const v = body.message_template;
    if (v !== null && (typeof v !== 'string' || v.length > MAX_TEMPLATE_CHARS)) {
      return NextResponse.json(
        { error: 'invalid_message_template', max_chars: MAX_TEMPLATE_CHARS },
        { status: 400 }
      );
    }
    // Blank string = "use the default" → store null (the renderer falls back).
    patch.message_template = typeof v === 'string' && v.trim() ? v : null;
  }

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'invalid_enabled' }, { status: 400 });
    }
    patch.enabled = body.enabled;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'no_valid_fields' }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: conn, error: selErr } = await supabase
    .from('calendar_connections')
    .select('id')
    .eq('user_phone', phone)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!conn) return NextResponse.json({ error: 'not_connected' }, { status: 404 });

  const { error: updErr } = await supabase
    .from('calendar_connections')
    .update(patch)
    .eq('user_phone', phone);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: Object.keys(patch) });
}

export async function DELETE(req: NextRequest) {
  if (flagOff()) return NextResponse.json({ error: 'calendar_sync_disabled' }, { status: 404 });

  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabaseAdmin();
  const { data: conn, error: selErr } = await supabase
    .from('calendar_connections')
    .select('id')
    .eq('user_phone', phone)
    .maybeSingle();
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
  if (!conn) return NextResponse.json({ error: 'not_connected' }, { status: 404 });

  // Cancel BEFORE deleting the connection: if the cancel fails we bail with
  // 500 and the row survives for a retry — deleting first would orphan
  // still-pending auto-reminders that keep sending after "disconnect".
  const { error: cancelErr } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled', error_message: 'calendar_disconnected' })
    .eq('instance_phone', phone)
    .eq('status', 'pending')
    .like('calendar_event_key', `${conn.id}:%`);
  if (cancelErr) return NextResponse.json({ error: cancelErr.message }, { status: 500 });

  const { error: delErr } = await supabase
    .from('calendar_connections')
    .delete()
    .eq('user_phone', phone);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
