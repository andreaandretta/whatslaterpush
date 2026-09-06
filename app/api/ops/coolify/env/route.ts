import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { getCoolifyBase, COOLIFY_NOT_CONFIGURED } from '../../../../lib/coolify-base';
import { getSupabaseAdminOrNull } from '../../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const COOLIFY_TIMEOUT_MS = 12000;

// Mask values for keys that look like secrets so the list response never leaks
// the droplet's DB password / API keys into logs or context.
const SECRET_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|DATABASE|REDIS|AUTH|DSN|PRIVATE|CREDENTIAL|JWT|WEBHOOK|SALT)/i;
function redactEnv(e: any) {
  const key = e?.key ?? e?.name ?? null;
  const value = e?.value ?? '';
  const isSecret = key ? SECRET_RE.test(key) : true;
  return { key, is_secret: isSecret, value: isSecret ? `***(len:${String(value).length})` : value };
}

function kindPlural(k: string | null): string {
  return (k || 'service').toLowerCase() === 'application' ? 'applications' : 'services';
}

async function auditOp(action: string, kind: string, uuid: string, key: string, status: number) {
  try {
    const supabase = getSupabaseAdminOrNull();
    if (!supabase) return;
    await supabase.from('audit_events').insert({
      user_phone: null,
      event_type: `ops_coolify_env_${action}`,
      payload: { kind, uuid, key, upstream_status: status },
    });
  } catch { /* best-effort */ }
}

function coolify(base: string, path: string, token: string, init: RequestInit) {
  return fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  });
}

// GET  /api/ops/coolify/env?uuid=<uuid>&kind=service                 → list env vars (values masked)
// GET  /api/ops/coolify/env?uuid=<uuid>&kind=service&key=K&value=V   → upsert env var K=V
// POST /api/ops/coolify/env  body { uuid, kind, key, value }         → upsert env var
// Auth: ?secret=<OPS_SECRET>. GET-with-side-effects supported because the control
// tower can only reach GET; POST mirrors it for normal REST use.
async function handle(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const token = process.env.COOLIFY_API_TOKEN;
  if (!token) return NextResponse.json({ error: 'COOLIFY_API_TOKEN not configured' }, { status: 500 });
  const base = getCoolifyBase();
  if (!base) return NextResponse.json({ error: COOLIFY_NOT_CONFIGURED }, { status: 500 });

  const url = new URL(req.url);
  let uuid = (url.searchParams.get('uuid') || '').trim();
  let kindRaw = url.searchParams.get('kind');
  let key = url.searchParams.get('key');
  let value = url.searchParams.get('value');

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({} as any));
    uuid = (uuid || body?.uuid || '').trim();
    kindRaw = kindRaw || body?.kind || null;
    key = key ?? body?.key ?? null;
    value = value ?? body?.value ?? null;
  }

  const kind = kindPlural(kindRaw);
  if (!/^[a-z0-9]{10,30}$/i.test(uuid)) {
    return NextResponse.json({ error: 'invalid or missing uuid' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COOLIFY_TIMEOUT_MS);
  try {
    // ── LIST MODE ──────────────────────────────────────────────────────────
    if (!key) {
      const res = await coolify(base, `/${kind}/${uuid}/envs`, token, { method: 'GET', signal: controller.signal });
      const body = await res.json().catch(() => null);
      const arr = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      return NextResponse.json(
        {
          ok: res.ok,
          mode: 'list',
          kind,
          uuid,
          upstream_status: res.status,
          count: arr.length,
          envs: arr.map(redactEnv),
          upstream_raw: res.ok ? undefined : body,
        },
        { status: res.ok ? 200 : 502 },
      );
    }

    // ── UPSERT MODE ────────────────────────────────────────────────────────
    // Try PATCH (update existing key); fall back to POST (create) if it fails.
    const payload = JSON.stringify({ key, value: value ?? '', is_preview: false });
    let res = await coolify(base, `/${kind}/${uuid}/envs`, token, { method: 'PATCH', body: payload, signal: controller.signal });
    let method = 'PATCH';
    let body = await res.json().catch(() => null);
    if (!res.ok) {
      res = await coolify(base, `/${kind}/${uuid}/envs`, token, { method: 'POST', body: payload, signal: controller.signal });
      method = 'POST(after PATCH ' + (body ? '' : '') + 'failed)';
      body = await res.json().catch(() => null);
    }
    await auditOp('upsert', kind, uuid, key, res.status);
    return NextResponse.json(
      { ok: res.ok, mode: 'upsert', method, kind, uuid, key, upstream_status: res.status, upstream: body },
      { status: res.ok ? 200 : 502 },
    );
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

export const GET = handle;
export const POST = handle;
