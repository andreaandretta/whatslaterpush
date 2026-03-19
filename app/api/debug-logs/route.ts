import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

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

// DELETE to clear logs
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== 'sk_cron_schedwhats_2024_secure') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await supabase.from('webhook_logs').delete().neq('id', 0);
  return NextResponse.json({ ok: true, cleared: true });
}
