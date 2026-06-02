import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';

export const dynamic = 'force-dynamic';

const COOLIFY_TIMEOUT_MS = 8000;
// Coolify v4 REST API base. Defaults to the known droplet; override via env.
const COOLIFY_BASE = process.env.COOLIFY_API_URL || 'http://161.35.212.68:8000';

async function coolifyGet(path: string, token: string, signal: AbortSignal) {
  return fetch(`${COOLIFY_BASE}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
}

// Whitelist safe fields (drop any secrets/env the Coolify payload may carry).
function safeResource(r: any, kind: string) {
  if (!r || typeof r !== 'object') return null;
  return {
    kind,
    uuid: r.uuid ?? null,
    name: r.name ?? null,
    status: r.status ?? null,
    fqdn: r.fqdn ?? null,
  };
}

// GET /api/ops/coolify/containers
// Lists Coolify applications + services + databases with their status.
// Auth: ?secret=<OPS_SECRET|CRON_SECRET>. Needs COOLIFY_API_TOKEN in env.
export async function GET(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const token = process.env.COOLIFY_API_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'COOLIFY_API_TOKEN not configured' }, { status: 500 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COOLIFY_TIMEOUT_MS);
  try {
    const [appsRes, svcRes, dbRes] = await Promise.all([
      coolifyGet('/applications', token, controller.signal),
      coolifyGet('/services', token, controller.signal),
      coolifyGet('/databases', token, controller.signal),
    ]);

    if (appsRes.status === 401 || appsRes.status === 403) {
      return NextResponse.json(
        { ok: false, upstream_status: appsRes.status, error: 'Coolify auth rejected' },
        { status: 502 },
      );
    }

    const apps = appsRes.ok ? await appsRes.json().catch(() => []) : [];
    const svcs = svcRes.ok ? await svcRes.json().catch(() => []) : [];
    const dbs = dbRes.ok ? await dbRes.json().catch(() => []) : [];

    const resources = [
      ...(Array.isArray(apps) ? apps.map((r: any) => safeResource(r, 'application')) : []),
      ...(Array.isArray(svcs) ? svcs.map((r: any) => safeResource(r, 'service')) : []),
      ...(Array.isArray(dbs) ? dbs.map((r: any) => safeResource(r, 'database')) : []),
    ].filter(Boolean);

    return NextResponse.json({
      ok: true,
      count: resources.length,
      resources,
      fetched_at: new Date().toISOString(),
    });
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { ok: false, error: aborted ? 'Coolify API timeout' : 'Coolify API unreachable' },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
