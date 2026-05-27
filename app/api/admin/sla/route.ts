import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function parseSince(raw: string | null): { ms: number; label: string } {
  if (raw === '7d') return { ms: 7 * 86400_000, label: '7d' };
  if (raw === '30d') return { ms: 30 * 86400_000, label: '30d' };
  return { ms: 86400_000, label: '24h' };
}

interface SentEvent {
  created_at: string;
  payload: { drift_ms?: number };
}

// Bucket boundaries (ms):
//   on_time   < 60_000  (1 min)
//   late      60_000..600_000  (1-10 min)
//   very_late >= 600_000  (>= 10 min)
const ON_TIME_MAX_MS = 60_000;
const LATE_MAX_MS = 600_000;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('secret');
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if ((queryToken || headerToken) !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const since = parseSince(url.searchParams.get('since'));
  const sinceIso = new Date(Date.now() - since.ms).toISOString();
  const supabase = getSupabase();

  // Pull message_sent events with drift_ms in window.
  const { data: sentEvents, error: sentErr } = await supabase
    .from('audit_events')
    .select('created_at, payload')
    .eq('event_type', 'message_sent')
    .gte('created_at', sinceIso);
  if (sentErr) return NextResponse.json({ error: sentErr.message }, { status: 500 });

  const { count: failedCount, error: failErr } = await supabase
    .from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'message_failed')
    .gte('created_at', sinceIso);
  if (failErr) return NextResponse.json({ error: failErr.message }, { status: 500 });

  // Delivery + read rates from scheduled_messages.
  const { count: sentTotal } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', sinceIso);

  const { count: deliveredCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', sinceIso)
    .not('delivered_at', 'is', null);

  const { count: readCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('sent_at', sinceIso)
    .not('read_at', 'is', null);

  const events = (sentEvents || []) as SentEvent[];
  const totalSent = events.length;

  // Aggregate buckets on the sent events.
  let onTime = 0, late = 0, veryLate = 0, driftSum = 0, driftN = 0;
  for (const e of events) {
    const d = typeof e.payload?.drift_ms === 'number' ? e.payload.drift_ms : null;
    if (d === null) continue;
    driftSum += Math.max(0, d);
    driftN++;
    if (d < ON_TIME_MAX_MS) onTime++;
    else if (d < LATE_MAX_MS) late++;
    else veryLate++;
  }

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
  const avgDriftMs = driftN === 0 ? 0 : Math.round(driftSum / driftN);

  // Daily breakdown — last 7 days regardless of since (more useful in UI).
  const dayMap = new Map<string, { sent: number; on_time: number; late: number; very_late: number }>();
  const breakdownSinceIso = new Date(Date.now() - 7 * 86400_000).toISOString();
  const recentEvents = events.filter(e => e.created_at >= breakdownSinceIso);
  for (const e of recentEvents) {
    const day = e.created_at.substring(0, 10);
    const bucket = dayMap.get(day) || { sent: 0, on_time: 0, late: 0, very_late: 0 };
    bucket.sent++;
    const d = typeof e.payload?.drift_ms === 'number' ? e.payload.drift_ms : null;
    if (d !== null) {
      if (d < ON_TIME_MAX_MS) bucket.on_time++;
      else if (d < LATE_MAX_MS) bucket.late++;
      else bucket.very_late++;
    }
    dayMap.set(day, bucket);
  }
  const daily = Array.from(dayMap.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, b]) => ({ day, ...b }));

  return NextResponse.json({
    since: since.label,
    totals: {
      sent: totalSent,
      failed: failedCount || 0,
      on_time_pct: pct(onTime, totalSent),
      late_pct: pct(late, totalSent),
      very_late_pct: pct(veryLate, totalSent),
      failure_rate_pct: pct(failedCount || 0, totalSent + (failedCount || 0)),
      avg_drift_ms: avgDriftMs,
      delivery_rate_pct: pct(deliveredCount || 0, sentTotal || 0),
      read_rate_pct: pct(readCount || 0, deliveredCount || 0),
    },
    counts: {
      on_time: onTime,
      late,
      very_late: veryLate,
      sent_total: sentTotal || 0,
      delivered: deliveredCount || 0,
      read: readCount || 0,
    },
    daily,
  });
}
