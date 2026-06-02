import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { fetchDropletMetrics, fetchDropletHistory24h } from '../../../../lib/droplet';

export const dynamic = 'force-dynamic';

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
    return NextResponse.json(
      { ok: false, error: 'DO metrics unavailable (check DO_API_TOKEN / DO_DROPLET_ID / do-agent on droplet)' },
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
