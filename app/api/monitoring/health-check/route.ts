import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAllChecks, shouldAlert, shouldRecover, sendRecovery, logResolution, dispatchAlert, classifyTransition } from '../../../lib/monitoring';

export const dynamic = 'force-dynamic';
// 11 check in serie, alcuni con probe Evolution O(N istanze): il default Hobby
// ~10s uccideva il runner prima del dispatch degli alert proprio durante un
// outage. 60s dà margine (Task 17). fetchCache no-store (Task 42): la GET del
// previousStatus è deterministica e la Data Cache la congelerebbe.
export const maxDuration = 60;
export const fetchCache = 'force-no-store';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  // Auth: Vercel cron injects `Authorization: Bearer ${CRON_SECRET}` on its
  // scheduled GETs (this is the canonical path going forward). The legacy
  // `?secret=$MONITORING_SECRET` query param is still accepted for backwards
  // compat with the Cowork control tower & manual ops calls, but emits a
  // deprecation warning — query secrets leak into CDN / access logs.
  const queryParamSecret = new URL(req.url).searchParams.get('secret');
  const authHeader = req.headers.get('authorization') || '';
  const monitoringSecret = process.env.MONITORING_SECRET;
  const cronSecret = process.env.CRON_SECRET;

  const okHeader = !!cronSecret && authHeader === `Bearer ${cronSecret}`;
  const okQuery = !!monitoringSecret && queryParamSecret === monitoringSecret;

  if (!okHeader && !okQuery) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (okQuery && !okHeader) {
    console.warn('[health-check] DEPRECATION: query-param secret used. Migrate callers to `Authorization: Bearer $CRON_SECRET` — query secrets leak into access logs.');
  }

  const supabase = getSupabase();
  const results = await runAllChecks();

  // Pre-launch silence lever: when MONITORING_ALERTS_ENABLED=false the checks
  // still run and record to monitoring_checks (the dashboard stays live), but no
  // WhatsApp/email is ever dispatched. Defaults to enabled.
  const alertsEnabled = process.env.MONITORING_ALERTS_ENABLED !== 'false';

  for (const check of results) {
    // Read previous status BEFORE upserting
    const { data: prev } = await supabase
      .from('monitoring_checks')
      .select('status')
      .eq('check_name', check.name)
      .limit(1);

    const previousStatus = prev?.[0]?.status || null;

    // Upsert current result
    await supabase.from('monitoring_checks').upsert(
      {
        check_name: check.name,
        status: check.status,
        message: check.message,
        checked_at: check.checked_at,
      },
      { onConflict: 'check_name' }
    );

    if (!alertsEnabled) continue;

    // Classify the transition (onset / escalation / reminder / recovery / none)
    // to decide WHAT to send. Repeat-spam is gated by shouldAlert: it fires once
    // on onset/escalation, then at most once per reminder window while active.
    const transition = classifyTransition(previousStatus, check.status);

    if (check.status !== 'ok') {
      const canAlert = await shouldAlert(check.name, check.status);
      if (canAlert) {
        await dispatchAlert(check, transition === 'reminder');
      }
    } else if (transition === 'recovery' && await shouldRecover(check.name)) {
      // shouldRecover dedups concurrent runs + later ticks (only one resolution
      // per incident). Announce "Risolto" only for incidents that actually paged
      // (criticals); warning→ok still records a silent 'ok' so the dedup treats a
      // later recurrence as a fresh onset rather than a suppressed duplicate.
      if (previousStatus === 'critical') {
        await sendRecovery(check);
      } else {
        await logResolution(check);
      }
    }
  }

  const hasIssues = results.some(r => r.status !== 'ok');
  return NextResponse.json(
    { status: hasIssues ? 'issues_detected' : 'all_ok', checks: results },
    { status: 200 }
  );
}
