import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '../../../lib/audit';
import { stampHeartbeat } from '../../../lib/heartbeat';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';

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
  skipped_in_use: number;
}

// H8: partition candidate terminal rows into removable vs in-use. A media_url
// still referenced by a LIVE row (in `inUse`) must NOT be removed — recurring
// chains share one file across occurrences, so deleting a >30d 'sent' copy would
// break the live future occurrence. Duplicate media_urls collapse to one path.
export function partitionRemovableMedia(
  candidates: Array<{ id: string; media_url: string }>,
  inUse: Set<string>,
): { removablePaths: string[]; removableIds: string[]; skipped: number } {
  const removable = candidates.filter((c) => c.media_url && !inUse.has(c.media_url));
  return {
    removablePaths: Array.from(new Set(removable.map((c) => c.media_url))),
    removableIds: removable.map((c) => c.id),
    skipped: candidates.length - removable.length,
  };
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
    return { status: 'noop', candidates: 0, removed_storage: 0, nullified_rows: 0, skipped_in_use: 0 };
  }

  const allPaths = rows.map(r => r.media_url).filter(Boolean);

  // H8: exclude media still referenced by a LIVE (non-terminal) row. Recurring
  // chains reuse one media_url across occurrences, so a >30d 'sent' copy can share
  // its storage file with a future pending occurrence — removing it would break
  // the live chain (createSignedUrl -> 'Failed to sign media URL' forever).
  const { data: inUseRows, error: inUseErr } = await supabase.rpc('recurring_media_in_use', { p_paths: allPaths });
  if (inUseErr) throw new Error('cleanup-media in-use check failed: ' + inUseErr.message);
  const inUse = new Set<string>(((inUseRows || []) as Array<{ media_url: string }>).map((r) => r.media_url));

  const { removablePaths, removableIds, skipped } = partitionRemovableMedia(rows, inUse);

  if (removablePaths.length === 0) {
    // Whole batch still referenced by live rows (e.g. active recurring media) —
    // nothing to free this run; they'll be cleaned once their chains end.
    return { status: 'ok', candidates: rows.length, removed_storage: 0, nullified_rows: 0, skipped_in_use: skipped };
  }

  // Storage remove first: if Storage fails we abort and retry next week.
  // The DB still references the (now possibly-deleted) path until cleared,
  // which is safe — send-messages only signs URLs at send time and these rows
  // are already in terminal state (sent/cancelled/failed).
  const { error: storageErr } = await supabase.storage.from(BUCKET).remove(removablePaths);
  if (storageErr) throw new Error('cleanup-media storage remove failed: ' + storageErr.message);

  const { error: updErr } = await supabase
    .from('scheduled_messages')
    .update({
      media_url: null,
      media_type: null,
      media_filename: null,
      media_caption: null,
    })
    .in('id', removableIds);
  if (updErr) throw new Error('cleanup-media update failed: ' + updErr.message);

  await logAuditEvent({
    eventType: 'media_cleanup',
    payload: { removed_count: removableIds.length, skipped_in_use: skipped, batch_size: BATCH_SIZE },
  });

  return {
    status: 'ok',
    candidates: rows.length,
    removed_storage: removablePaths.length,
    nullified_rows: removableIds.length,
    skipped_in_use: skipped,
  };
}

export async function GET(req: NextRequest) {
  // Accept CRON_SECRET via `Authorization: Bearer` header (what Vercel Cron
  // sends) OR the legacy ?secret= query — matching send-messages. Reading only
  // the query 401'd every scheduled Vercel Cron run (#4).
  const provided = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? new URL(req.url).searchParams.get('secret');
  if (!provided || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  void stampHeartbeat('cleanup-media'); // Task 56 (#6)

  try {
    const result = await runMediaCleanup();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'cleanup failed' }, { status: 500 });
  }
}
