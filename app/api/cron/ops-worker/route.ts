import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const EVOLUTION_TIMEOUT_MS = 8000;
const COOLIFY_BASE = process.env.COOLIFY_API_URL || 'http://161.35.212.68:8000';
const BATCH = 10;

function supa() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically; manual
// triggers (via the Vercel MCP, GET-only) pass ?secret=<OPS_SECRET>.
function authed(req: NextRequest): boolean {
  const provided =
    new URL(req.url).searchParams.get('secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return !!provided && (provided === process.env.CRON_SECRET || provided === process.env.OPS_SECRET);
}

function evo(method: string, path: string, signal: AbortSignal) {
  return fetch(`${process.env.EVOLUTION_API_URL}${path}`, {
    method,
    headers: { apikey: process.env.EVOLUTION_API_KEY! },
    cache: 'no-store',
    signal,
  });
}

// Allowlisted command handlers. Unknown commands fail safely (no side effects).
async function runCommand(
  cmd: { command: string; target: string | null; params: any },
  signal: AbortSignal,
): Promise<{ ok: boolean; result?: any; error?: string }> {
  const { command, target, params } = cmd;
  switch (command) {
    case 'evolution_logout': {
      if (!/^SchedWhats-[0-9]+$/.test(target || '')) return { ok: false, error: 'invalid target' };
      const r = await evo('DELETE', `/instance/logout/${target}`, signal);
      return { ok: r.ok, result: { status: r.status } };
    }
    case 'evolution_delete': {
      if (!/^SchedWhats-[0-9]+$/.test(target || '')) return { ok: false, error: 'invalid target' };
      const lo = await evo('DELETE', `/instance/logout/${target}`, signal);
      const del = await evo('DELETE', `/instance/delete/${target}`, signal);
      const body = await del.json().catch(() => null);
      return { ok: del.ok, result: { logout_status: lo.status, delete_status: del.status, upstream: body } };
    }
    case 'coolify_restart': {
      if (!target) return { ok: false, error: 'missing target uuid' };
      const type = params?.type === 'service' ? 'services' : 'applications';
      const r = await fetch(`${COOLIFY_BASE}/api/v1/${type}/${target}/restart`, {
        headers: { Authorization: `Bearer ${process.env.COOLIFY_API_TOKEN}`, Accept: 'application/json' },
        cache: 'no-store',
        signal,
      });
      const body = await r.json().catch(() => null);
      return { ok: r.ok, result: { status: r.status, upstream: body } };
    }
    default:
      return { ok: false, error: `unknown command: ${command}` };
  }
}

// GET /api/cron/ops-worker
// Drains the ops_commands queue: claims pending rows atomically and executes
// the allowlisted action. Path is under /api/cron (middleware-exempt).
export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = supa();
  const { data: pending, error: selErr } = await supabase
    .from('ops_commands')
    .select('id, command, target, params, attempts')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (selErr) return NextResponse.json({ ok: false, error: selErr.message }, { status: 500 });
  if (!pending || pending.length === 0) return NextResponse.json({ ok: true, processed: 0, results: [] });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVOLUTION_TIMEOUT_MS);
  const results: any[] = [];
  try {
    for (const cmd of pending) {
      // Atomic optimistic claim: only one worker wins the pending -> processing flip.
      const { data: claimed } = await supabase
        .from('ops_commands')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', cmd.id)
        .eq('status', 'pending')
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      let outcome: { ok: boolean; result?: any; error?: string };
      try {
        outcome = await runCommand(cmd as any, controller.signal);
      } catch (e: any) {
        outcome = { ok: false, error: e?.name === 'AbortError' ? 'timeout' : 'exception' };
      }

      await supabase
        .from('ops_commands')
        .update({
          status: outcome.ok ? 'done' : 'failed',
          result: outcome.result ?? null,
          error: outcome.error ?? null,
          attempts: (cmd.attempts || 0) + 1,
          executed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', cmd.id);

      results.push({ id: cmd.id, command: cmd.command, target: cmd.target, ok: outcome.ok });
    }
  } finally {
    clearTimeout(timer);
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
