import { NextRequest, NextResponse } from 'next/server';
import { fetchDropletMetrics, fetchDropletHistory24h } from '../../../lib/droplet';
import { requireAdmin } from '../../../lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

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
