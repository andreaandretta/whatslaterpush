import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { evolutionClient } from '../../../../lib/evolution/client';
import { validatePhone } from '../../../lib/phone';

export const dynamic = 'force-dynamic';

// READ-ONLY probe for the photo-recovery design (Probe 0 calibration + Probe 1
// hit-rate). It does NOT write to whatsapp_contacts and adds NO schema. It calls
// the LIVE per-contact fetchProfilePictureUrl on a TEST instance and reports the
// raw response shape + classification + hit-rate + the per-instance ban signals
// (instance_disconnect/403 from audit_events, and the in-sample 401-wall count),
// so we can decide go/no-go BEFORE building the real worker. Throwaway: delete
// this route if the probe says no-go.
//
// HARD-ALLOWLISTED to test numbers only — the real number (393442582226) is
// intentionally absent, so any attempt to probe it returns 403. Real users are
// never probed.
//
// Usage (manual, CRON_SECRET via ?secret= or Authorization: Bearer):
//   POST /api/admin/photo-probe?phone=393780858599&limit=3            (Probe 1 sample)
//   POST /api/admin/photo-probe?phone=393780858599&limit=3&offset=3   (next page)
//   POST /api/admin/photo-probe?phone=393780858599&numbers=39...,39... (Probe 0)

// TEMP (2026-06-26): 393442582226 abilitato per UN micro-probe rappresentativo
// autorizzato da Andrea. RIMUOVERE subito dopo la misura (ripristino hard-deny).
const PROBE_ALLOWED = new Set(['393509898408', '393780858599', '393442582226']);

const MAX_LIMIT = 3;   // <=3 live calls/invocation to stay under Vercel Hobby 10s
const GAP_MS = 1200;   // gentle spacing between live calls (ban-safe pacing)

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Map a fetchProfilePictureUrl outcome to the buckets the real worker will use.
// Raw status/body is preserved in the response so we can calibrate the
// classifier against the patched fork (Probe 0).
function classify(ok: boolean, url: string | null, status?: number, body?: string): string {
  if (ok && url) return 'found';
  if (ok && !url) return 'no_photo_or_private'; // HTTP 200 + null
  const blob = `${status ?? ''} ${body ?? ''}`.toLowerCase();
  if (/not-authorized|item-not-found|forbidden|\b401\b|\b404\b/.test(blob)) return 'no_photo_or_private';
  return 'error_retryable'; // timeout / 429 / 5xx without not-authorized
}

// Per-instance ban signal: instance_disconnect events in the last 3h for THIS
// instance (the global checkInstanceFlapping is fleet-wide; this is targeted).
async function disconnectSignal(supabase: any, instanceName: string) {
  const sinceMs = Date.now() - 3 * 60 * 60 * 1000;
  const since = new Date(sinceMs).toISOString();
  const { data } = await supabase
    .from('audit_events')
    .select('payload, created_at')
    .eq('event_type', 'instance_disconnect')
    .gte('created_at', since);
  const rows = (data || []).filter((e: any) => e?.payload?.instance === instanceName);
  const codes = rows.map((e: any) => e?.payload?.code).filter((c: any) => c != null);
  return { disconnects_3h: rows.length, has_403: codes.includes(403), codes };
}

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(req.url);
  const provided =
    url.searchParams.get('secret') || req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const phone = validatePhone(url.searchParams.get('phone') || '');
  if (!phone || !PROBE_ALLOWED.has(phone)) {
    return NextResponse.json(
      { error: 'phone must be an allowlisted TEST number', allowed: Array.from(PROBE_ALLOWED) },
      { status: 403 }
    );
  }

  const supabase = getSupabase();
  const { data: inst } = await supabase
    .from('user_instances')
    .select('instance_name, connection_status')
    .eq('phone_number', phone)
    .single();
  if (!inst?.instance_name) {
    return NextResponse.json({ error: 'instance not found' }, { status: 404 });
  }
  if (inst.connection_status !== 'open') {
    return NextResponse.json(
      { error: 'instance not open', connection_status: inst.connection_status },
      { status: 409 }
    );
  }

  // Targets: explicit ?numbers=csv (Probe 0), else a sample page of NULL-photo rows.
  let targets: string[];
  const explicit = url.searchParams.get('numbers');
  if (explicit) {
    targets = (explicit.split(',').map((s) => validatePhone(s.trim())).filter(Boolean) as string[]).slice(0, MAX_LIMIT);
  } else {
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || '3', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));
    const { data: rows } = await supabase
      .from('whatsapp_contacts')
      .select('contact_number')
      .eq('user_phone', phone)
      .is('profile_pic_url', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);
    targets = (rows || []).map((r: any) => r.contact_number).filter(Boolean);
  }
  if (targets.length === 0) {
    return NextResponse.json({ error: 'no targets (cache empty for this offset)' }, { status: 400 });
  }

  const signalBefore = await disconnectSignal(supabase, inst.instance_name);

  const probed: any[] = [];
  for (let i = 0; i < targets.length; i++) {
    if (i > 0) await sleep(GAP_MS);
    const number = targets[i];
    try {
      const r = await evolutionClient.fetchProfilePictureUrl(inst.instance_name, number);
      const u = typeof r?.profilePictureUrl === 'string' && r.profilePictureUrl.trim() ? r.profilePictureUrl.trim() : null;
      probed.push({ number, ok: true, has_url: !!u, raw_status: 200, classification: classify(true, u) });
    } catch (e: any) {
      const msg = String(e?.message || e);
      const m = msg.match(/Evolution API error:\s*(\d+)\s*-\s*([\s\S]*)/i);
      const status = m ? parseInt(m[1], 10) : undefined;
      const body = (m ? m[2] : msg).slice(0, 200);
      probed.push({ number, ok: false, has_url: false, raw_status: status ?? null, raw_body: body, classification: classify(false, null, status, body) });
    }
  }

  const signalAfter = await disconnectSignal(supabase, inst.instance_name);
  const counts = probed.reduce((a: Record<string, number>, p) => {
    a[p.classification] = (a[p.classification] || 0) + 1;
    return a;
  }, {});
  const decided = (counts.found || 0) + (counts.no_photo_or_private || 0);

  return NextResponse.json({
    ok: true,
    phone,
    instance: inst.instance_name,
    probed_count: probed.length,
    counts,
    // hit-rate over DECIDED results (found vs no-photo), excluding transient errors
    hit_rate_recoverable: decided ? +(((counts.found || 0) / decided).toFixed(2)) : null,
    no_photo_wall: counts.no_photo_or_private || 0, // the 401-wall signal (in-sample)
    disconnect_signal_before: signalBefore,
    disconnect_signal_after: signalAfter,
    probed,
  });
}
