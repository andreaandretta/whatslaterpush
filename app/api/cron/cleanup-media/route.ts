import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

const BUCKET = 'message-media';
const RETENTION_DAYS = 30;
// Vercel Hobby cap is 10s; 100 rows per run keeps the Storage round-trip and
// the IN-list UPDATE well under budget. Cron runs weekly so backlog drains
// even if a Sunday is skipped.
const BATCH_SIZE = 100;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface CleanupResult {
  status: 'ok' | 'noop';
  candidates: number;
  removed_storage: number;
  nullified_rows: number;
}

export async function runMediaCleanup(): Promise<CleanupResult> {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: candidates, error: selErr } = await supabase
    .from('scheduled_messages')
    .select('id, media_url')
    .in('status', ['sent', 'cancelled', 'failed'])
    .not('media_url', 'is', null)
    .lt('created_at', cutoff)
    .limit(BATCH_SIZE);

  if (selErr) throw new Error('cleanup-media select failed: ' + selErr.message);
  const rows = (candidates || []) as Array<{ id: string; media_url: string }>;

  if (rows.length === 0) {
    return { status: 'noop', candidates: 0, removed_storage: 0, nullified_rows: 0 };
  }

  const paths = rows.map(r => r.media_url).filter(Boolean);
  const ids = rows.map(r => r.id);

  // Storage remove first: if Storage fails we abort and retry next week.
  // The DB still references the (now possibly-deleted) path until cleared,
  // which is safe — send-messages only signs URLs at send time and these rows
  // are already in terminal state (sent/cancelled/failed).
  const { error: storageErr } = await supabase.storage.from(BUCKET).remove(paths);
  if (storageErr) throw new Error('cleanup-media storage remove failed: ' + storageErr.message);

  const { error: updErr } = await supabase
    .from('scheduled_messages')
    .update({
      media_url: null,
      media_type: null,
      media_filename: null,
      media_caption: null,
    })
    .in('id', ids);
  if (updErr) throw new Error('cleanup-media update failed: ' + updErr.message);

  await logAuditEvent({
    eventType: 'media_cleanup',
    payload: { removed_count: rows.length, batch_size: BATCH_SIZE },
  });

  return {
    status: 'ok',
    candidates: rows.length,
    removed_storage: paths.length,
    nullified_rows: ids.length,
  };
}

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runMediaCleanup();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'cleanup failed' }, { status: 500 });
  }
}
