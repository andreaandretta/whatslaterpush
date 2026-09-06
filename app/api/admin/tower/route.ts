import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '../../../lib/admin-auth';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

// Data source for the admin "Torre di Controllo" page (app/admin/tower).
// Aggregates everything server-side so the browser never sees OPS_SECRET:
//   - Section 1 (users + queues): admin_tower_users() RPC
//   - Section 2 (stack capacity): self-fetch of our own /api/ops/* proxies + /api/health
//   - Section 3 (projection) is computed client-side from the droplet snapshot.
//
// Auth: requireAdmin (sw_session cookie + ADMIN_PHONES). middleware.ts also
// gates /api/admin/tower at the edge (ADMIN_API_COOKIE_PATHS) — defense in depth.

// Force fully dynamic + uncached: Next.js otherwise caches a constant-shaped GET
// and freezes the snapshot (same gotcha hit on /api/ops/stress-index).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';


// Self-fetch one of our own JSON endpoints with a hard timeout so a slow upstream
// (DigitalOcean / Evolution / Coolify) can never push this route past the Vercel
// lambda limit. Returns null on any failure; the page renders that card as "n/d".
async function fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
  try {
    const res = await fetch(url, { cache: 'no-store', headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const origin = req.nextUrl.origin;
  const ops = process.env.OPS_SECRET || '';
  // OPS_SECRET is used ONLY here, server-side, to reach our secret-guarded
  // /api/ops/* proxies. Passed as an Authorization: Bearer header (NOT a ?secret=
  // query param) so it never lands in the self-fetch URL -> stays out of Vercel
  // request logs for this internal hop. It is never returned to the client.
  // (The ops routes still accept ?secret= for GET-only external callers like the
  // Cowork Torre — that deprecated fallback is unrelated to this internal caller.)
  const opsHeaders = ops ? { Authorization: `Bearer ${ops}` } : undefined;
  const supabase = getSupabaseAdmin();

  const [usersRes, droplet, evolution, coolify, health] = await Promise.all([
    supabase.rpc('admin_tower_users'),
    fetchJson(`${origin}/api/ops/droplet/metrics`, opsHeaders),
    fetchJson(`${origin}/api/ops/evolution/instances`, opsHeaders),
    fetchJson(`${origin}/api/ops/coolify/containers`, opsHeaders),
    fetchJson(`${origin}/api/health`),
  ]);

  const users = Array.isArray(usersRes?.data) ? usersRes.data : [];

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    users,
    users_error: usersRes?.error?.message || null,
    droplet: droplet
      ? {
          ram_percent: droplet.ram_percent,
          cpu_percent: droplet.cpu_percent,
          disk_percent: droplet.disk_percent,
          uptime_seconds: droplet.uptime_seconds,
        }
      : null,
    evolution: evolution
      ? {
          count: evolution.count,
          open: evolution.open,
          instances: Array.isArray(evolution.instances)
            ? evolution.instances.map((i: any) => ({
                name: i.name,
                connection_status: i.connection_status,
                number: i.number,
                messages: i.messages,
                contacts: i.contacts,
                chats: i.chats,
              }))
            : [],
        }
      : null,
    coolify: coolify
      ? {
          count: coolify.count,
          resources: Array.isArray(coolify.resources)
            ? coolify.resources.map((r: any) => ({ kind: r.kind, name: r.name, status: r.status }))
            : [],
        }
      : null,
    health: health
      ? {
          status: health.status,
          services: health.services,
          queue: health.queue,
          instances: health.instances,
        }
      : null,
  });
}
