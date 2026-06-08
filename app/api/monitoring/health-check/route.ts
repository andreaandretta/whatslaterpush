import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAllChecks, shouldAlert, sendAlert, sendAlertWithChannel, sendRecovery } from '../../../lib/monitoring';

export const dynamic = 'force-dynamic';

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

    // Alert logic
    if (check.status !== 'ok') {
      // Passing the current status enables escalation pass-through:
      // warning->critical within the 1h dedup window is no longer silenced
      // (Codex review F1c — see shouldAlert comment in monitoring.ts).
      const canAlert = await shouldAlert(check.name, check.status);
      if (canAlert) {
        // Progressive channel escalation for RAM alerts
        if (check.name === 'droplet_ram') {
          const ramMatch = check.message.match(/(\d+)%/);
          const ramPct = ramMatch ? parseInt(ramMatch[1]) : 0;
          if (ramPct >= 80) {
            await sendAlertWithChannel(check, ['whatsapp', 'email']);
          } else if (ramPct >= 70) {
            await sendAlertWithChannel(check, ['whatsapp']);
          } else {
            await sendAlertWithChannel(check, ['db']);
          }
        } else if (check.name === 'pairing_blackout') {
          // Q2 + Codex F4a escalation policy: critical pages the operator on
          // WhatsApp + email; warning stays silent in DB (false-positive
          // protection for low-traffic onboarding windows).
          if (check.status === 'critical') {
            await sendAlertWithChannel(check, ['whatsapp', 'email']);
          } else {
            await sendAlertWithChannel(check, ['db']);
          }
        } else {
          await sendAlert(check);
        }
      }
    } else if (previousStatus && previousStatus !== 'ok') {
      await sendRecovery(check);
    }
  }

  const hasIssues = results.some(r => r.status !== 'ok');
  return NextResponse.json(
    { status: hasIssues ? 'issues_detected' : 'all_ok', checks: results },
    { status: 200 }
  );
}
