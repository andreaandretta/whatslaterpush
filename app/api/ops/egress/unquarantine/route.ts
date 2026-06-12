import { NextRequest, NextResponse } from 'next/server';
import { unquarantineEgress } from '../../../../lib/egress-pool';

// POST /api/ops/egress/unquarantine?id=<egress_id>&secret=$OPS_SECRET
// (or pass the secret via x-ops-secret header)
//
// Fase 0 §6: manual override after Andrea buys a new IP / refreshes IP
// reputation. Emits audit egress_unquarantine so the ledger reflects the
// state change. Idempotent: unquarantineEgress no-ops when the egress isn't
// currently quarantined, so spamming this endpoint is safe.
//
// Auth: OPS_SECRET gate matches the other /api/ops/* endpoints. Middleware
// (sw_session cookie) already exempts /api/ops/* paths so the secret-guarded
// call doesn't need an authenticated browser session.

export const dynamic = 'force-dynamic';

function requireOpsSecret(req: NextRequest): boolean {
  const param = new URL(req.url).searchParams.get('secret');
  const header = req.headers.get('x-ops-secret');
  const expected = process.env.OPS_SECRET;
  return !!expected && (param === expected || header === expected);
}

export async function POST(req: NextRequest) {
  if (!requireOpsSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'missing_id' }, { status: 400 });
  }
  await unquarantineEgress(id, 'manual_ops');
  return NextResponse.json({ ok: true, egress_id: id });
}
