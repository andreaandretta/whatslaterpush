import { createClient } from '@supabase/supabase-js';

export interface DropletMetrics {
  ram_percent: number;
  cpu_percent: number;
  disk_percent: number;
  uptime_seconds: number;
}

export interface RamDataPoint {
  time: string;
  percent: number;
}

const DO_API = 'https://api.digitalocean.com';

// ── Push mode (runbook §8.2) ────────────────────────────────────────────────
// HOST_METRICS_SOURCE=push → le metriche arrivano dal cron sul server Hetzner
// via POST /api/ops/host-metrics (tabella host_metrics) invece che dall'API
// DigitalOcean (droplet distrutto 2026-07-05). Una riga più vecchia di
// PUSH_STALE_MS = feed fermo → null, così checkDropletRam segnala il buco
// invece di mostrare dati vecchi come buoni.
const PUSH_STALE_MS = 5 * 60 * 1000;

export function hostMetricsPushMode(): boolean {
  return (process.env.HOST_METRICS_SOURCE || '').trim().toLowerCase() === 'push';
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function fetchPushedMetrics(): Promise<DropletMetrics | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('host_metrics')
      .select('ram_percent, cpu_percent, disk_percent, uptime_seconds, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    if (Date.now() - new Date(data.created_at).getTime() > PUSH_STALE_MS) return null;
    return {
      ram_percent: data.ram_percent ?? 0,
      cpu_percent: data.cpu_percent ?? 0,
      disk_percent: data.disk_percent ?? 0,
      uptime_seconds: data.uptime_seconds ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchPushedHistory24h(): Promise<RamDataPoint[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('host_metrics')
      .select('ram_percent, created_at')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true })
      .limit(2000); // 1 riga/min = 1440/24h, margine incluso
    if (error || !data) return [];
    return data.map((r: any) => ({
      time: new Date(r.created_at).toISOString(),
      percent: Math.max(0, Math.min(100, r.ram_percent ?? 0)),
    }));
  } catch {
    return [];
  }
}

async function doFetch(metricPath: string, start: string, end: string): Promise<any> {
  const token = process.env.DO_API_TOKEN;
  const dropletId = process.env.DO_DROPLET_ID;
  if (!token || !dropletId) return null;

  const url = `${DO_API}/v2/monitoring/metrics/droplet/${metricPath}?host_id=${dropletId}&start=${start}&end=${end}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

function getLastValue(result: any): number | null {
  const values = result?.data?.result?.[0]?.values;
  if (!values || values.length === 0) return null;
  return parseFloat(values[values.length - 1][1]);
}

export async function fetchDropletMetrics(): Promise<DropletMetrics | null> {
  if (hostMetricsPushMode()) return fetchPushedMetrics();
  if (!process.env.DO_API_TOKEN || !process.env.DO_DROPLET_ID) return null;

  const now = Math.floor(Date.now() / 1000);
  const fiveMinAgo = String(now - 300);
  const nowStr = String(now);

  try {
    const [memFreeRes, memTotalRes, cpuRes, diskFreeRes, diskSizeRes] = await Promise.all([
      doFetch('memory_free', fiveMinAgo, nowStr),
      doFetch('memory_available', fiveMinAgo, nowStr),
      doFetch('cpu', fiveMinAgo, nowStr),
      doFetch('filesystem_free', fiveMinAgo, nowStr),
      doFetch('filesystem_size', fiveMinAgo, nowStr),
    ]);

    // If any primary metric fetch failed (returned null), bail out entirely
    if (memFreeRes === null || memTotalRes === null || cpuRes === null || diskFreeRes === null || diskSizeRes === null) {
      return null;
    }

    const memFree = getLastValue(memFreeRes);
    const memTotal = getLastValue(memTotalRes);
    const diskFree = getLastValue(diskFreeRes);
    const diskSize = getLastValue(diskSizeRes);

    const ram_percent = (memFree !== null && memTotal !== null && memTotal > 0)
      ? Math.round((1 - memFree / memTotal) * 100)
      : 0;

    // CPU values are cumulative counters (seconds), not percentages.
    // Calculate usage from delta between last two data points.
    let cpu_percent = 0;
    const cpuResults = cpuRes?.data?.result;
    if (Array.isArray(cpuResults)) {
      const idle = cpuResults.find((r: any) => r.metric?.mode === 'idle');
      if (idle && idle.values && idle.values.length >= 2) {
        const v = idle.values;
        const idleDelta = parseFloat(v[v.length - 1][1]) - parseFloat(v[v.length - 2][1]);
        const timeDelta = parseFloat(v[v.length - 1][0]) - parseFloat(v[v.length - 2][0]);
        if (timeDelta > 0) {
          // idle is in CPU-seconds; divide by time to get fraction, then invert for usage
          const idleFraction = idleDelta / timeDelta;
          cpu_percent = Math.round((1 - idleFraction) * 100);
          cpu_percent = Math.max(0, Math.min(100, cpu_percent));
        }
      }
    }

    const disk_percent = (diskFree !== null && diskSize !== null && diskSize > 0)
      ? Math.round((1 - diskFree / diskSize) * 100)
      : 0;

    let uptime_seconds = 0;
    try {
      const dropletRes = await fetch(
        `${DO_API}/v2/droplets/${process.env.DO_DROPLET_ID}`,
        { headers: { Authorization: `Bearer ${process.env.DO_API_TOKEN}` } }
      );
      if (dropletRes.ok) {
        const info = await dropletRes.json();
        const createdAt = new Date(info?.droplet?.created_at || 0).getTime();
        uptime_seconds = Math.floor((Date.now() - createdAt) / 1000);
      }
    } catch { /* ignore */ }

    return { ram_percent, cpu_percent, disk_percent, uptime_seconds };
  } catch {
    return null;
  }
}

export async function fetchDropletHistory24h(): Promise<RamDataPoint[]> {
  if (hostMetricsPushMode()) return fetchPushedHistory24h();
  if (!process.env.DO_API_TOKEN || !process.env.DO_DROPLET_ID) return [];

  const now = Math.floor(Date.now() / 1000);
  const dayAgo = String(now - 86400);
  const nowStr = String(now);

  try {
    const [memFreeRes, memTotalRes] = await Promise.all([
      doFetch('memory_free', dayAgo, nowStr),
      doFetch('memory_available', dayAgo, nowStr),
    ]);

    const freeValues = memFreeRes?.data?.result?.[0]?.values || [];
    const totalValues = memTotalRes?.data?.result?.[0]?.values || [];

    if (freeValues.length === 0 || totalValues.length === 0) return [];

    const totalMap = new Map<string, number>();
    for (const [ts, val] of totalValues) {
      totalMap.set(ts, parseFloat(val));
    }

    return freeValues.map(([ts, freeVal]: [string, string]) => {
      const free = parseFloat(freeVal);
      const total = totalMap.get(ts) || totalValues[totalValues.length - 1]?.[1] || free;
      const totalNum = typeof total === 'string' ? parseFloat(total) : total;
      const percent = totalNum > 0 ? Math.round((1 - free / totalNum) * 100) : 0;
      return {
        time: new Date(parseInt(ts) * 1000).toISOString(),
        percent: Math.max(0, Math.min(100, percent)),
      };
    });
  } catch {
    return [];
  }
}
