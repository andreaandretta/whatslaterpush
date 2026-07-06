import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { fetchDropletMetrics, fetchDropletHistory24h, hostMetricsPushMode } from '../../../../lib/droplet';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// TEMP probe diagnostica (da rimuovere): replica fetchPushedMetrics passo-passo
// e riporta dove muore, senza swallow.
async function tempProbe() {
  const out: any = {};
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    out.has_url = !!url;
    out.has_key = !!key;
    if (!url || !key) return out;
    const c = createClient(url, key);
    const { data, error } = await c
      .from('host_metrics')
      .select('id, ram_percent, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    out.data = data ?? null;
    out.pg_error = error ? { code: (error as any).code, message: error.message } : null;
    if (data?.created_at) out.age_ms = Date.now() - new Date(data.created_at).getTime();
  } catch (e: any) {
    out.threw = String(e?.message || e);
  }
  return out;
}

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
        // TEMP debug (route secret-guarded): cosa vede il runtime. Da rimuovere
        // a diagnosi chiusa.
        debug_push_mode: pushMode,
        debug_source_typeof: typeof process.env.HOST_METRICS_SOURCE,
        debug_probe: await tempProbe(),
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
