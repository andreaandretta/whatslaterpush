import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const queryToken = url.searchParams.get('secret');
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = queryToken || headerToken;
  if (provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .select('source, name, push_name');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data || []) as Array<{ source: string; name: string | null; push_name: string | null }>;
  const source_breakdown: Record<string, number> = {};
  let withName = 0;
  let withOnlyPushName = 0;
  let anonymous = 0;
  for (const r of rows) {
    source_breakdown[r.source] = (source_breakdown[r.source] || 0) + 1;
    const hasName = !!(r.name && r.name.trim());
    const hasPush = !!(r.push_name && r.push_name.trim());
    if (hasName) withName++;
    else if (hasPush) withOnlyPushName++;
    else anonymous++;
  }

  return NextResponse.json({
    total_in_cache: rows.length,
    total_with_name: withName,
    total_with_only_pushname: withOnlyPushName,
    anonymous,
    source_breakdown,
  });
}
