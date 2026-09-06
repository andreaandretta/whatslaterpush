import { NextRequest, NextResponse } from 'next/server';
import { logAuditEvent } from '../../../lib/audit';
import { stampHeartbeat } from '../../../lib/heartbeat';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

const RETENTION_DAYS = 30;


export interface WebhookLogsCleanupResult {
  status: 'ok' | 'noop';
  removed_count: number;
}

export async function runWebhookLogsCleanup(): Promise<WebhookLogsCleanupResult> {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // PostgREST .delete({ count: 'exact' }) returns the number of rows actually
  // deleted, which we surface in both the response and the audit event so
  // operators can spot retention regressions in the daily report.
  const { count, error } = await (supabase
    .from('webhook_logs')
    .delete({ count: 'exact' }) as any)
    .lt('ts', cutoff);

  if (error) throw new Error('cleanup-webhook-logs delete failed: ' + error.message);

  const removed = count || 0;
  console.log('CRON: Pruned ' + removed + ' webhook_logs older than ' + RETENTION_DAYS + ' days');

  // Fix #3: prune the webhook dedup ledger too. Evolution retries arrive within
  // seconds/minutes, so a 7-day window is far more than enough to dedup them.
  try {
    const dedupCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: dedupRemoved } = await (supabase
      .from('processed_webhook_events')
      .delete({ count: 'exact' }) as any)
      .lt('ts', dedupCutoff);
    if (dedupRemoved) console.log('CRON: Pruned ' + dedupRemoved + ' processed_webhook_events older than 7 days');
  } catch (e: any) {
    console.error('CRON: processed_webhook_events prune failed:', e?.message || e);
  }

  if (removed === 0) {
    return { status: 'noop', removed_count: 0 };
  }

  await logAuditEvent({
    eventType: 'webhook_logs_prune',
    payload: { removed_count: removed, retention_days: RETENTION_DAYS },
  });

  return { status: 'ok', removed_count: removed };
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

  void stampHeartbeat('cleanup-webhook-logs'); // Task 56 (#6)

  try {
    const result = await runWebhookLogsCleanup();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'cleanup failed' }, { status: 500 });
  }
}
