import { getSupabaseAdmin } from '../../lib/supabase-admin';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  const limit = parseInt(searchParams.get('limit') || '30');
  const { data, error } = await supabase
    .from('webhook_logs')
    .select('*')
    .order('ts', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Format for readability
  const formatted = (data || []).map(row => ({
    time: new Date(row.ts).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    tag: row.tag,
    data: (() => { try { return JSON.parse(row.data); } catch { return row.data; } })()
  }));

  return NextResponse.json(formatted);
}

// DELETE to clear logs. Auth via DEBUG_LOGS_SECRET env var only — the previous
// hardcoded fallback (DEPRECATED_DEBUG_TOKEN) was removed after the grace
// period set in commit d36b635 (audit-2026-05-25 issue #1).
export async function DELETE(req: NextRequest) {
  const provided = new URL(req.url).searchParams.get('secret');
  const envSecret = process.env.DEBUG_LOGS_SECRET || '';
  if (envSecret.length === 0 || provided !== envSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  await supabase.from('webhook_logs').delete().neq('id', 0);
  return NextResponse.json({ ok: true, cleared: true });
}
