import { NextRequest, NextResponse } from 'next/server';
import { fetchDropletMetrics, fetchDropletHistory24h } from '../../../lib/droplet';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.MONITORING_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [metrics, history] = await Promise.all([
    fetchDropletMetrics(),
    fetchDropletHistory24h(),
  ]);

  if (!metrics) {
    return NextResponse.json(
      { error: 'DO metrics unavailable', ram_percent: 0, cpu_percent: 0, disk_percent: 0, uptime_seconds: 0, ram_history_24h: [] },
      { status: 200 }
    );
  }

  return NextResponse.json({
    ...metrics,
    ram_history_24h: history,
  });
}
