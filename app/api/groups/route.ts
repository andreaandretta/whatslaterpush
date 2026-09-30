import { NextRequest, NextResponse } from 'next/server';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { getSupabaseAdmin } from '../../lib/supabase-admin';
import { groupsEnabledFor, readGroups } from '../../lib/groups';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';
// fetchAllGroups può metterci fino a 25 s con molti gruppi (1+2N richieste a WhatsApp).
export const maxDuration = 30;

// Lista dei gruppi per il picker (D3, D6). Solo nome, numero di persone e se si
// può scrivere: i partecipanti non escono mai da qui. Ogni lettura live passa dal
// gettone su DB (1 ogni 30 min, condiviso con /api/contacts) e dal segnale "lento".

function respond(body: Record<string, unknown>, status: number, t0: number, extra: Record<string, string> = {}, timing: string[] = []) {
  const total = performance.now() - t0;
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Server-Timing': [...timing, `total;dur=${total.toFixed(1)}`].join(', '),
      ...extra,
    },
  });
}

export async function GET(req: NextRequest) {
  const t0 = performance.now();
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  const phone = payload?.phone ?? null;
  if (!phone) return respond({ error: 'Unauthorized' }, 401, t0);

  // Spento (D13): la UI nasconde la sezione, Evolution non si chiama.
  if (!groupsEnabledFor(phone)) {
    return respond({ enabled: false, connected: false, groups: [] }, 200, t0, { 'X-Groups-Source': 'off' });
  }

  const supabase = getSupabaseAdmin();
  const { data: user } = await supabase
    .from('user_instances')
    .select('instance_name, connection_status')
    .eq('phone_number', phone)
    .maybeSingle();
  const dbMs = performance.now() - t0;
  const instance = (user as { instance_name?: string | null } | null)?.instance_name;
  if (!instance) return respond({ error: 'User not found' }, 404, t0);

  const status = (user as { connection_status?: string | null }).connection_status;
  if (status !== 'open' && status !== 'connecting') {
    return respond({ enabled: true, connected: false, groups: [] }, 200, t0, { 'X-Groups-Source': 'disconnected' });
  }

  const refresh = new URL(req.url).searchParams.get('refresh') === '1';
  const tGroups = performance.now();
  const r = await readGroups(phone, instance, supabase, { caller: 'groups', refresh });
  const timing = [`db;dur=${dbMs.toFixed(1)}`, `groups;dur=${(performance.now() - tGroups).toFixed(1)}`];
  const headers: Record<string, string> = { 'X-Groups-Source': r.source };
  if (r.source === 'stale') headers['X-Groups-Stale'] = '1';

  // Evolution in errore o in timeout e nessuna cache da servire.
  if (r.error && r.source === 'none') {
    return r.error === 'timeout'
      ? respond({ error: 'groups_timeout', message: 'I gruppi ci mettono troppo a rispondere: riprova tra poco.' }, 504, t0, headers, timing)
      : respond({ error: 'groups_unavailable', message: 'Non riesco a leggere i gruppi adesso: riprova tra poco.' }, 502, t0, headers, timing);
  }

  const body: Record<string, unknown> = {
    enabled: true,
    connected: true,
    groups: r.groups,
    fetched_at: r.fetchedAt,
    source: r.source,
  };
  if (r.throttled) body.throttled = true;
  if (r.slow) body.slow = true;
  return respond(body, 200, t0, headers, timing);
}
