import { NextRequest, NextResponse } from 'next/server';

// Shared auth gate for /api/ops/* control-tower endpoints.
// Returns a NextResponse (500/401) to short-circuit when unauthorized, or null
// when the request is allowed to proceed.
// Accepts ?secret=<value> or `Authorization: Bearer <value>`, matched against the
// DEDICATED OPS_SECRET only — NO CRON_SECRET fallback, so a leaked CRON_SECRET
// cannot grant ops access and a missing OPS_SECRET fails closed (500).
export function denyUnlessOpsAuthorized(req: NextRequest): NextResponse | null {
  const expected = process.env.OPS_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'OPS_SECRET not configured' }, { status: 500 });
  }
  const queryToken = new URL(req.url).searchParams.get('secret');
  const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if ((queryToken || headerToken) !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
