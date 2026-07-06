import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { fetchDropletMetrics, fetchDropletHistory24h, hostMetricsPushMode } from '../../../../lib/droplet';

export const dynamic = 'force-dynamic';
// Le GET REST di supabase-js (via lib/droplet push mode) NON vanno mai nella
// Next Data Cache: metriche fresche ogni 60s (stesso fix di stress-index).
export const fetchCache = 'force-no-store';

// GET /api/ops/droplet/metrics
// DigitalOcean droplet metrics (RAM/CPU/disk %, uptime) + 24h RAM history,
// reusing lib/droplet. Auth: ?secret=<OPS_SECRET|CRON_SECRET>.
// Requires DO_API_TOKEN + DO_DROPLET_ID in env (memory/disk also need the
// DigitalOcean monitoring agent installed on the droplet).
export async function GET(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const metrics = await fetchDropletMetrics();
  if (!metrics) {
    const pushMode = hostMetricsPushMode();
    return NextResponse.json(
      {
        ok: false,
        error: pushMode
          ? 'host metrics unavailable (push feed assente o stantio >5min — cron sul server fermo?)'
          : 'DO metrics unavailable (check DO_API_TOKEN / DO_DROPLET_ID / do-agent on droplet)',
      },
      { status: 502 },
    );
  }

  const ram_history_24h = await fetchDropletHistory24h();
  return NextResponse.json({
    ok: true,
    ...metrics,
    ram_history_24h,
    fetched_at: new Date().toISOString(),
  });
}
