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

// Deprecated token kept ONLY for grace-period back-compat. Any script still
// using it gets a WARN log so we can spot orphans before removing it on
// 2026-06-03 (7 days from 2026-05-27). Audit 2026-05-25 flagged this as a
// committed shared secret — see vault/audit-2026-05-25.md issue #1.
const DEPRECATED_DEBUG_TOKEN = 'sk_cron_schedwhats_2024_secure';

// DELETE to clear logs
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret');
  const envSecret = process.env.DEBUG_LOGS_SECRET || '';
  const matchesEnv = envSecret.length > 0 && provided === envSecret;
  const matchesDeprecated = provided === DEPRECATED_DEBUG_TOKEN;

  if (!matchesEnv && !matchesDeprecated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (matchesDeprecated && !matchesEnv) {
    console.warn('DEBUG_LOGS: DEPRECATED hardcoded token used — migrate caller to DEBUG_LOGS_SECRET env var. Hardcoded token removed 2026-06-03.');
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await supabase.from('webhook_logs').delete().neq('id', 0);
  return NextResponse.json({ ok: true, cleared: true });
}
