import { NextRequest, NextResponse } from 'next/server';

// Shared auth gate for /api/ops/* control-tower endpoints.
// Returns a NextResponse (500/401) to short-circuit when unauthorized, or null
// when the request is allowed to proceed.
// Prefers `Authorization: Bearer <value>`; also accepts a DEPRECATED ?secret=<value>
// query fallback (see below). Matched against the DEDICATED OPS_SECRET only — NO
// CRON_SECRET fallback, so a leaked CRON_SECRET cannot grant ops access and a
// missing OPS_SECRET fails closed (500).
export function denyUnlessOpsAuthorized(req: NextRequest): NextResponse | null {
  const expected = process.env.OPS_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'OPS_SECRET not configured' }, { status: 500 });
  }
  // Header (Authorization: Bearer) is the PREFERRED channel — it never lands in a
  // URL, so it can't leak via browser history, Referer, or proxy/Vercel request
  // logs. The ?secret= query param is a DEPRECATED but still-supported fallback,
  // kept ONLY for GET-only server-to-server callers that cannot send custom headers
  // (the Claude Cowork Torre via web_fetch, the cron-job.org pinger). DO NOT remove
  // the query path without first migrating those external callers — they are
  // configured outside this repo and a hard-cut would silently dark ops monitoring.
  // Either a valid header OR a valid query authorizes; an absent/empty token never
  // does (expected is guaranteed non-empty by the 500 guard above), and a wrong
  // query no longer blocks a valid header.
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null;
  const queryToken = new URL(req.url).searchParams.get('secret');
  if (headerToken !== expected && queryToken !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
