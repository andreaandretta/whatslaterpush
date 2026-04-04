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

    let cpu_percent = 0;
    const cpuResults = cpuRes?.data?.result;
    if (Array.isArray(cpuResults)) {
      const idle = cpuResults.find((r: any) => r.metric?.mode === 'idle');
      if (idle) {
        const idleValues = idle.values;
        if (idleValues && idleValues.length > 0) {
          cpu_percent = Math.round(100 - parseFloat(idleValues[idleValues.length - 1][1]));
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
