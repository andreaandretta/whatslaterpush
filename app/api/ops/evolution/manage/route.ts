import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const EVOLUTION_TIMEOUT_MS = 8000;
const ALLOWED_ACTIONS = ['logout', 'delete'] as const;
type Action = (typeof ALLOWED_ACTIONS)[number];

function evoDelete(path: string, key: string, signal: AbortSignal) {
  return fetch(`${process.env.EVOLUTION_API_URL}${path}`, {
    method: 'DELETE',
    headers: { apikey: key },
    cache: 'no-store',
    signal,
  });
}

// Best-effort audit trail for destructive ops (never blocks the action).
async function auditOp(name: string, action: string, steps: Record<string, unknown>) {
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    await createClient(url, key).from('audit_events').insert({
      user_phone: null,
      event_type: `ops_evolution_${action}`,
      payload: { instance: name, steps },
    });
  } catch { /* best-effort */ }
}

// GET /api/ops/evolution/manage?action=logout|delete&name=SchedWhats-<digits>
// Control-tower mutation: logout and/or fully delete an Evolution instance
// (delete also purges its synced WhatsApp data on the droplet).
// Auth: ?secret=<OPS_SECRET|CRON_SECRET>. GET-with-side-effects is intentional —
// the only channel reachable from the control tower is GET via the Vercel MCP;
// guarded by the secret + a strict instance-name allowlist (SchedWhats-<digits>).
export async function GET(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const action = url.searchParams.get('action') as Action | null;
  const name = url.searchParams.get('name') || '';

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'invalid action (logout|delete)' }, { status: 400 });
  }
  if (!/^SchedWhats-[0-9]+$/.test(name)) {
    return NextResponse.json({ error: 'invalid instance name (expected SchedWhats-<digits>)' }, { status: 400 });
  }

  const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return NextResponse.json({ error: 'Evolution env not configured' }, { status: 500 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);
  const steps: Record<string, unknown> = {};
  try {
    // Logout first to free the Baileys socket; tolerate failure (already closed).
    const logoutRes = await evoDelete(`/instance/logout/${name}`, EVOLUTION_API_KEY, controller.signal);
    steps.logout_status = logoutRes.status;

    if (action === 'logout') {
      await auditOp(name, 'logout', steps);
      return NextResponse.json({ ok: logoutRes.ok, instance: name, action, steps }, { status: logoutRes.ok ? 200 : 502 });
    }

    // action === 'delete'
    const delRes = await evoDelete(`/instance/delete/${name}`, EVOLUTION_API_KEY, controller.signal);
    steps.delete_status = delRes.status;
    const body = await delRes.json().catch(() => null);
    await auditOp(name, 'delete', steps);
    return NextResponse.json(
      { ok: delRes.ok, instance: name, action, steps, upstream: body },
      { status: delRes.ok ? 200 : 502 },
    );
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { ok: false, instance: name, action, steps, error: aborted ? 'Evolution timeout' : 'Evolution unreachable' },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
