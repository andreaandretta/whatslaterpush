import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { getCoolifyBase, COOLIFY_NOT_CONFIGURED } from '../../../../lib/coolify-base';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const COOLIFY_TIMEOUT_MS = 12000;
const ALLOWED_ACTIONS = ['stop', 'start', 'restart'] as const;
type Action = (typeof ALLOWED_ACTIONS)[number];

async function auditOp(kind: string, uuid: string, action: string, status: number) {
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    await createClient(url, key).from('audit_events').insert({
      user_phone: null,
      event_type: `ops_coolify_${action}`,
      payload: { kind, uuid, upstream_status: status },
    });
  } catch { /* best-effort */ }
}

// GET /api/ops/coolify/manage?action=stop|start|restart&uuid=<uuid>&kind=application|service
// Control-tower mutation: stop/start/restart a Coolify application or service.
// Auth: ?secret=<OPS_SECRET|CRON_SECRET>. Needs COOLIFY_API_TOKEN. GET-with-side-
// effects (the only channel the control tower can reach), guarded by the secret +
// a strict uuid pattern. Coolify accepts GET on these action endpoints.
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

  const url = new URL(req.url);
  const action = url.searchParams.get('action') as Action | null;
  const uuid = (url.searchParams.get('uuid') || '').trim();
  const kindParam = (url.searchParams.get('kind') || 'application').toLowerCase();
  const kindPlural = kindParam === 'service' ? 'services' : 'applications';

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'invalid action (stop|start|restart)' }, { status: 400 });
  }
  if (!/^[a-z0-9]{10,30}$/i.test(uuid)) {
    return NextResponse.json({ error: 'invalid or missing uuid' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COOLIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/v1/${kindPlural}/${uuid}/${action}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    await auditOp(kindPlural, uuid, action, res.status);
    return NextResponse.json(
      { ok: res.ok, kind: kindPlural, uuid, action, upstream_status: res.status, upstream: body, fetched_at: new Date().toISOString() },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    await auditOp(kindPlural, uuid, action, aborted ? 408 : 0);
    return NextResponse.json(
      { ok: false, kind: kindPlural, uuid, action, error: aborted ? 'Coolify API timeout' : 'Coolify API unreachable' },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
