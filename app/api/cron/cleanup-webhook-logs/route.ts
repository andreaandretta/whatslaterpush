import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { logAuditEvent } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

const RETENTION_DAYS = 30;

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface WebhookLogsCleanupResult {
  status: 'ok' | 'noop';
  removed_count: number;
}

export async function runWebhookLogsCleanup(): Promise<WebhookLogsCleanupResult> {
  const supabase = getSupabase();
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
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runWebhookLogsCleanup();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'cleanup failed' }, { status: 500 });
  }
}
