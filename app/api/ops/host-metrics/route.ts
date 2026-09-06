import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../lib/ops-auth';
import { getSupabaseAdminOrNull } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Rows older than this are pruned best-effort on every write: the readers only
// need "latest row" (metrics) + 24h (RAM history), 48h keeps a safety margin
// while bounding the table at ~2880 righe (1/min).
const PRUNE_AFTER_MS = 48 * 60 * 60 * 1000;


function asPercent(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 0 && r <= 100 ? r : null;
}

// POST /api/ops/host-metrics — receiver del push host-metrics (runbook §8.2).
// Chiamato ogni 60s dal cron sul server Hetzner (curl). Body JSON:
//   { ram_percent: 0-100 (obbligatorio), disk_percent?, cpu_percent?,
//     load1?, uptime_seconds?, host? }
// Auth: Authorization: Bearer <OPS_SECRET> (preferito — il cron può mandare
// header, il segreto non finisce nei log delle URL); ?secret= resta il
// fallback deprecato di ops-auth. Letto da fetchDropletMetrics quando
// HOST_METRICS_SOURCE=push.
export async function POST(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const ram = asPercent(body?.ram_percent);
  if (ram === null) {
    return NextResponse.json({ error: 'ram_percent required (0-100)' }, { status: 400 });
  }

  const supabase = getSupabaseAdminOrNull();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const loadNum = Number(body?.load1);
  const upNum = Number(body?.uptime_seconds);
  const row = {
    host:
      typeof body?.host === 'string' && body.host.trim()
        ? body.host.trim().slice(0, 64)
        : 'hetzner',
    ram_percent: ram,
    cpu_percent: asPercent(body?.cpu_percent),
    disk_percent: asPercent(body?.disk_percent),
    load1: Number.isFinite(loadNum) ? loadNum : null,
    uptime_seconds: Number.isFinite(upNum) ? Math.max(0, Math.floor(upNum)) : null,
  };

  const { error } = await supabase.from('host_metrics').insert(row);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Prune best-effort (DELETE su indice, ~1/min): mai bloccare l'ingest.
  try {
    await supabase
      .from('host_metrics')
      .delete()
      .lt('created_at', new Date(Date.now() - PRUNE_AFTER_MS).toISOString());
  } catch {
    /* best-effort */
  }

  return NextResponse.json({ ok: true, stored_at: new Date().toISOString() });
}
