import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { fetchDropletMetrics } from '../../../../lib/droplet';
import { getPlanLimits } from '../../../../lib/plans';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// 2GB droplet (CLAUDE.md); Baileys ~50MB/instance (the operator's estimate).
const DROPLET_RAM_MB = Number(process.env.DROPLET_RAM_MB) || 2048;
const EST_MB_PER_INSTANCE = Number(process.env.EST_MB_PER_INSTANCE) || 50;
const RAM_WARN = 70;
const RAM_CRIT = 85;            // OOM-imminent threshold
const CRON_STALE_SEC = 180;     // cron stack considered down if monitor silent >3 min

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const RANK: Record<string, number> = { unknown: 0, ok: 0, warning: 1, critical: 2 };
function worstOf(...s: string[]): string {
  return s.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');
}

// GET /api/ops/stress-index?secret=<OPS_SECRET|CRON_SECRET>
// LEVEL 2 predictive indicators: droplet/evolution/cron stress + residual
// capacity + RAM projection for N new users. Read-only, secret-guarded.
export async function GET(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const supabase = getSupabase();
  const [metrics, snapRes] = await Promise.all([
    fetchDropletMetrics().catch(() => null),
    supabase.rpc('ops_stress_snapshot'),
  ]);
  const db: any = snapRes?.data || {};
  const dbOk = !snapRes?.error;

  // A. Droplet stress + projection
  const ram: number | null = metrics?.ram_percent ?? null;
  const pctPerInstance = Math.round((EST_MB_PER_INSTANCE / DROPLET_RAM_MB) * 100 * 100) / 100; // ~2.44
  const dropletStatus = ram == null ? 'unknown' : ram >= RAM_CRIT ? 'critical' : ram >= RAM_WARN ? 'warning' : 'ok';
  const headroomPct = ram == null ? null : Math.max(0, RAM_CRIT - ram);
  const safeNewUsers = (ram == null || pctPerInstance <= 0) ? null : Math.max(0, Math.floor((headroomPct as number) / pctPerInstance));
  const projectRam = (n: number) => ram == null ? null : Math.min(100, Math.round((ram + n * pctPerInstance) * 10) / 10);

  // B. Evolution stress (pre-ban: >3 disconnect/1h on one instance)
  const wf = db.worst_flapping || null;
  const wfCount = wf?.count ?? 0;
  const banRisk = wfCount > 3;
  const offline = (db.instances_close ?? 0) + (db.instances_refused ?? 0);
  const evoStatus = wfCount >= 8 ? 'critical' : (banRisk || offline > 0) ? 'warning' : 'ok';

  // C. Cron stress
  const freshSec: number | null = typeof db.monitor_fresh_sec === 'number' ? db.monitor_fresh_sec : null;
  const cronAlive = freshSec != null && freshSec <= CRON_STALE_SEC;
  const pendingOverdue = db.pending_overdue ?? 0;
  const cronStatus = (!cronAlive || pendingOverdue >= 5) ? 'critical' : pendingOverdue > 0 ? 'warning' : 'ok';

  // D. Residual capacity
  const openInstances: Array<{ plan: string; sent: number }> = Array.isArray(db.open_instances) ? db.open_instances : [];
  const dailyMessagesRemaining = openInstances.reduce((sum, i) => sum + Math.max(0, getPlanLimits(i.plan || 'free').dailyLimit - (i.sent || 0)), 0);

  const overall = worstOf(dropletStatus, evoStatus, cronStatus);

  return NextResponse.json({
    ok: true,
    overall,
    generated_at: new Date().toISOString(),
    db_ok: dbOk,
    droplet: {
      status: dropletStatus,
      ram_percent: ram,
      cpu_percent: metrics?.cpu_percent ?? null,
      disk_percent: metrics?.disk_percent ?? null,
      thresholds: { warning_pct: RAM_WARN, critical_pct: RAM_CRIT },
      active_instances: db.instances_open ?? null,
      est_mb_per_instance: EST_MB_PER_INSTANCE,
      pct_per_instance: pctPerInstance,
      headroom_to_critical_pct: headroomPct,
      projection: {
        ram_if_plus_5_users: projectRam(5),
        ram_if_plus_10_users: projectRam(10),
        safe_new_users_today: safeNewUsers,
      },
    },
    evolution: {
      status: evoStatus,
      ban_risk: banRisk,
      instances_total: db.instances_total ?? null,
      open: db.instances_open ?? null,
      close: db.instances_close ?? null,
      refused: db.instances_refused ?? null,
      disconnects_1h: db.disconnects_1h ?? 0,
      disconnects_2h: db.disconnects_2h ?? 0,
      worst_flapping: wf,
    },
    cron: {
      status: cronStatus,
      alive: cronAlive,
      monitor_fresh_sec: freshSec,
      pending_overdue: pendingOverdue,
      pending_total: db.pending_total ?? 0,
      avg_processing_drift_ms: db.avg_drift_ms ?? null,
    },
    capacity: {
      droplet_users_remaining: safeNewUsers,
      daily_messages_remaining: dailyMessagesRemaining,
      note: 'Stima a ' + EST_MB_PER_INSTANCE + 'MB/istanza su ' + DROPLET_RAM_MB + 'MB. daily_messages_remaining = somma quote tier residue delle istanze connesse.',
    },
  });
}
