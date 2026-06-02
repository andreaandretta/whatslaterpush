import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';

export const dynamic = 'force-dynamic';

const EVOLUTION_TIMEOUT_MS = 8000;

// Whitelist the fields we return. Evolution's fetchInstances payload also
// carries per-instance secrets (token / hash / apikey) and raw owner JIDs —
// those are dropped here so the ops proxy never leaks credentials or extra
// PII outside the server, which is the whole point of routing through Vercel.
function safeInstance(raw: any) {
  if (!raw || typeof raw !== 'object') return null;
  // v2 may return flat objects or nest the instance under `.instance`.
  const i = raw.instance && typeof raw.instance === 'object' ? raw.instance : raw;
  const counts = i._count || raw._count || null;
  return {
    name: i.name ?? i.instanceName ?? null,
    connection_status: i.connectionStatus ?? i.state ?? i.status ?? null,
    profile_name: i.profileName ?? null,
    number: i.number ?? null,
    integration: i.integration ?? null,
    messages: counts?.Message ?? null,
    contacts: counts?.Contact ?? null,
    chats: counts?.Chat ?? null,
  };
}

// GET /api/ops/evolution/instances
// Read-only control-tower proxy: lists Evolution instances + connection state.
// Auth: ?secret=<OPS_SECRET|CRON_SECRET> or `Authorization: Bearer <...>`.
export async function GET(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return NextResponse.json({ error: 'Evolution env not configured' }, { status: 500 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { apikey: EVOLUTION_API_KEY },
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, upstream_status: res.status, error: 'Evolution API error' },
        { status: 502 },
      );
    }
    const list = Array.isArray(body) ? body : [];
    const instances = list.map(safeInstance).filter(Boolean);
    const open = instances.filter((i: any) => i.connection_status === 'open').length;
    return NextResponse.json({
      ok: true,
      count: instances.length,
      open,
      instances,
      fetched_at: new Date().toISOString(),
    });
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { ok: false, error: aborted ? 'Evolution API timeout' : 'Evolution API unreachable' },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
