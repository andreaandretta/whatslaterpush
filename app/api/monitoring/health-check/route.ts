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
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.MONITORING_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      const canAlert = await shouldAlert(check.name);
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
