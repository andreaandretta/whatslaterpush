import { NextRequest, NextResponse } from 'next/server';
import { denyUnlessOpsAuthorized } from '../../../../lib/ops-auth';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const TIMEOUT_MS = 8000;

// GET /api/ops/evolution/version?secret=<OPS_SECRET>
// Read-only control-tower probe. Returns the Evolution API root payload (version
// string, manager, client name). Used to diagnose whether NEW-pairing failures
// (fresh instances getting `401 loggedOut` immediately, while old sessions stay
// connected) are caused by an outdated Evolution/Baileys stack vs a flagged IP.
// No side effects; never touches instances.
export async function GET(req: NextRequest) {
  const denied = denyUnlessOpsAuthorized(req);
  if (denied) return denied;

  const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
  if (!EVOLUTION_API_URL) {
    return NextResponse.json({ error: 'Evolution env not configured' }, { status: 500 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/`, {
      headers: EVOLUTION_API_KEY ? { apikey: EVOLUTION_API_KEY } : {},
      cache: 'no-store',
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return NextResponse.json(
      {
        ok: res.ok,
        http_status: res.status,
        version: body?.version ?? null,
        message: body?.message ?? null,
        manager: body?.manager ?? null,
        clientName: body?.clientName ?? null,
        raw: body,
      },
      { status: res.ok ? 200 : 502 },
    );
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return NextResponse.json(
      { ok: false, error: aborted ? 'Evolution timeout' : 'Evolution unreachable' },
      { status: 504 },
    );
  } finally {
    clearTimeout(timer);
  }
}
