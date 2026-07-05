import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { getCoolifyBase, COOLIFY_NOT_CONFIGURED } from '../../../../lib/coolify-base';

export const dynamic = 'force-dynamic';

const COOLIFY_TIMEOUT_MS = 8000;

async function coolifyGet(base: string, path: string, token: string, signal: AbortSignal) {
  return fetch(`${base}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
}

// Whitelist safe fields (drop any secrets/env the Coolify payload may carry).
// Image fields added for patch-verification: services (compose) carry the image
// inside docker_compose_raw (services.*.image); applications (image-based deploy)
// expose docker_image/docker_image_tag at top level. Whitelist all candidates so
// the caller can eyeball which image tag is actually running.
function safeResource(r: any, kind: string) {
  if (!r || typeof r !== 'object') return null;
  return {
    kind,
    uuid: r.uuid ?? null,
    name: r.name ?? null,
    status: r.status ?? null,
    fqdn: r.fqdn ?? null,
    docker_image: r.docker_image ?? null,
    docker_image_tag: r.docker_image_tag ?? null,
    docker_registry_image_name: r.docker_registry_image_name ?? null,
    docker_compose_raw: r.docker_compose_raw ?? null,
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
  const base = getCoolifyBase();
  if (!base) {
    return NextResponse.json({ error: COOLIFY_NOT_CONFIGURED }, { status: 500 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COOLIFY_TIMEOUT_MS);
  try {
    const [appsRes, svcRes, dbRes] = await Promise.all([
      coolifyGet(base, '/applications', token, controller.signal),
      coolifyGet(base, '/services', token, controller.signal),
      coolifyGet(base, '/databases', token, controller.signal),
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
