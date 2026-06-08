import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const COOLIFY_TIMEOUT_MS = 15000;
const COOLIFY_BASE = process.env.COOLIFY_API_URL || 'http://161.35.212.68:8000';

async function auditOp(uuid: string, status: number, force: boolean) {
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !sk) return;
    await createClient(url, sk).from('audit_events').insert({
      user_phone: null,
      event_type: 'ops_coolify_redeploy',
      payload: { uuid, force, upstream_status: status },
    });
  } catch { /* best-effort */ }
}

// GET|POST /api/ops/coolify/redeploy?uuid=<uuid>[&force=true]
// Triggers a Coolify deployment for an application OR service by uuid (Coolify's
// /deploy endpoint accepts both). Used to make a service pick up new env vars.
// Auth: ?secret=<OPS_SECRET>. GET-with-side-effects supported for the control
// tower; POST mirrors it. Coolify's deploy endpoint is a GET under the hood.
async function handle(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const token = process.env.COOLIFY_API_TOKEN;
  if (!token) return NextResponse.json({ error: 'COOLIFY_API_TOKEN not configured' }, { status: 500 });

  const url = new URL(req.url);
  let uuid = (url.searchParams.get('uuid') || '').trim();
  let force = url.searchParams.get('force') === 'true';

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({} as any));
    uuid = (uuid || body?.uuid || '').trim();
    if (body?.force === true) force = true;
  }

  if (!/^[a-z0-9]{10,30}$/i.test(uuid)) {
    return NextResponse.json({ error: 'invalid or missing uuid' }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COOLIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${COOLIFY_BASE}/api/v1/deploy?uuid=${encodeURIComponent(uuid)}&force=${force}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    await auditOp(uuid, res.status, force);
    return NextResponse.json(
      { ok: res.ok, uuid, force, upstream_status: res.status, upstream: body, fetched_at: new Date().toISOString() },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    await auditOp(uuid, aborted ? 408 : 0, force);
    return NextResponse.json(
      { ok: false, uuid, error: aborted ? 'Coolify API timeout' : 'Coolify API unreachable' },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}

export const GET = handle;
export const POST = handle;
