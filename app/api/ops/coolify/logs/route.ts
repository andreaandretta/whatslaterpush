import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';
import { getCoolifyBase, COOLIFY_NOT_CONFIGURED } from '../../../../lib/coolify-base';
import { scrubString } from '../../../../lib/sentry-pii';

export const dynamic = 'force-dynamic';

const COOLIFY_TIMEOUT_MS = 8000;

async function coolifyGet(base: string, path: string, token: string, signal: AbortSignal) {
  return fetch(`${base}/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
}

// Coolify returns logs as { logs: "<text>" } on recent versions, or sometimes a
// raw string / { log }. Normalize to a single string.
function extractLogs(body: any): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (typeof body.logs === 'string') return body.logs;
  if (typeof body.log === 'string') return body.log;
  return null;
}

// GET /api/ops/coolify/logs?uuid=<resourceUuid>&kind=service|application|auto&lines=N
// Container logs for a Coolify resource (default: the Evolution service) so the
// control tower can see WHY a WhatsApp instance disconnected — not just THAT it
// did. Logs pass through the shared PII scrubber (Baileys logs carry customer
// phone numbers / JIDs). Auth: ?secret=<OPS_SECRET|CRON_SECRET>. Needs
// COOLIFY_API_TOKEN. Coolify documents /applications/{uuid}/logs; service-log
// support varies by version, so `auto` probes service first, then application.
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
  // Default target when ?uuid= is omitted: the Evolution service's Coolify
  // resource uuid, from env (a resource id, NOT a secret). Was hardcoded to the
  // OLD DigitalOcean service uuid (`pkso00o0…`) — stale since the 2026-07-05
  // decommission, so it now lives in COOLIFY_EVOLUTION_UUID alongside the node.
  const uuid = (url.searchParams.get('uuid') || process.env.COOLIFY_EVOLUTION_UUID || '').trim();
  if (!uuid) {
    return NextResponse.json(
      { error: 'uuid required (pass ?uuid= or set COOLIFY_EVOLUTION_UUID)' },
      { status: 400 },
    );
  }
  if (!/^[a-z0-9]{10,30}$/i.test(uuid)) {
    return NextResponse.json({ error: 'invalid uuid' }, { status: 400 });
  }
  const kind = (url.searchParams.get('kind') || 'auto').toLowerCase();
  let lines = parseInt(url.searchParams.get('lines') || '120', 10);
  if (!Number.isFinite(lines) || lines < 1) lines = 120;
  if (lines > 500) lines = 500;

  const segments =
    kind === 'application' ? ['applications']
    : kind === 'service' ? ['services']
    : ['services', 'applications'];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COOLIFY_TIMEOUT_MS);
  const attempts: Record<string, number> = {};
  try {
    for (const seg of segments) {
      const res = await coolifyGet(base, `/${seg}/${uuid}/logs?lines=${lines}`, token, controller.signal);
      attempts[seg] = res.status;
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, error: 'Coolify auth rejected', attempts }, { status: 502 });
      }
      if (res.ok) {
        const body = await res.json().catch(() => null);
        const raw = extractLogs(body);
        return NextResponse.json({
          ok: true,
          source_kind: seg === 'services' ? 'service' : 'application',
          uuid,
          lines,
          attempts,
          logs: raw ? scrubString(raw) : '',
          fetched_at: new Date().toISOString(),
        });
      }
    }
    return NextResponse.json(
      { ok: false, error: 'logs not available for this uuid via Coolify API (service logs may be unsupported on this version - fall back to SSH)', attempts },
      { status: 404 },
    );
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { ok: false, error: aborted ? 'Coolify API timeout' : 'Coolify API unreachable', attempts },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
