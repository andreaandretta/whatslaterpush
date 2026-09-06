// Egress proxy pool for pairing — Fase 0 §2 / spec
// docs/superpowers/specs/2026-06-12-fase-0-ip-burning-mitigations-design.md
//
// Pairing-only egress: when PAIRING_PROXY_ENABLED=true, /api/auth/init picks
// an Egress from the env-configured pool and injects its proxy fields into
// the Evolution /instance/create payload. Steady-state sessions stay direct
// on the droplet, so the proxy is NOT an uptime dependency for already-paired
// users — only for the handshake that Meta categorises as bot-prone.
//
// Quarantine state lives in audit_events (event_type 'egress_quarantine' /
// 'egress_unquarantine' with payload {egress_id, reason, until}) rather than
// a dedicated table — same ledger pattern as ops_commands and matches the
// existing audit_events PII policy (egress_id is not PII).

export type EgressProtocol = 'http' | 'https' | 'socks4' | 'socks5';

export interface Egress {
  id: string;
  host: string;
  port: number;
  protocol: EgressProtocol;
  username?: string;
  password?: string;
  label?: string;
}

export class MisconfigError extends Error {
  constructor(msg: string) { super(msg); this.name = 'MisconfigError'; }
}
export class FrozenError extends Error {
  constructor(msg: string) { super(msg); this.name = 'FrozenError'; }
}

const VALID_PROTOCOLS: EgressProtocol[] = ['http', 'https', 'socks4', 'socks5'];

import { getSupabaseAdmin } from './supabase-admin';


interface LatestEgressEvent {
  event_type: 'egress_quarantine' | 'egress_unquarantine';
  payload: { egress_id: string; reason?: string; until?: string };
}

// Returns { error } distinctly from { event: null } so callers can FAIL CLOSED on
// a read error instead of mistaking it for "no quarantine on record".
async function getLatestEgressEvent(egressId: string): Promise<{ error: boolean; event: LatestEgressEvent | null }> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('audit_events')
    .select('event_type,payload')
    .in('event_type', ['egress_quarantine', 'egress_unquarantine'])
    .filter('payload->>egress_id', 'eq', egressId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[egress-pool] getLatestEgressEvent err=${error.message}`);
    return { error: true, event: null };
  }
  return { error: false, event: (data as unknown as LatestEgressEvent) || null };
}

export async function isEgressQuarantined(egressId: string): Promise<boolean> {
  const { error, event } = await getLatestEgressEvent(egressId);
  // FAIL CLOSED: a read error must NOT make a quarantined (possibly Meta-banned)
  // egress look healthy. getEgressForPairing's loop just skips this egress and
  // tries the next, so a single read error costs one egress, not the whole pool;
  // only a TOTAL DB outage (every check errors) escalates to FrozenError — correct,
  // since at that point Supabase itself is down.
  if (error) return true;
  if (!event) return false;
  if (event.event_type === 'egress_unquarantine') return false;
  if (!event.payload.until) return false;
  return new Date(event.payload.until).getTime() > Date.now();
}

// Idempotent: skip if already actively quarantined. Avoids audit spam when
// multiple cron runs hit the same blackout threshold within the same minute.
// Insert direct (not logAuditEvent) so egress_id and until round-trip the
// scrubObject sentry-pii filter cleanly — neither is PII.
// Re-write at most ~once/hour while an incident persists, so the audit ledger
// isn't spammed by the 15-min cron yet the quarantine 'until' keeps advancing.
const QUARANTINE_EXTEND_THRESHOLD_MS = 60 * 60 * 1000;

export async function quarantineEgress(
  egressId: string,
  reason: string,
  ttlHours: number = 24,
): Promise<void> {
  const newUntilMs = Date.now() + ttlHours * 3600_000;
  const { error, event } = await getLatestEgressEvent(egressId);
  // Can't reason about state during a DB read error; isEgressQuarantined already
  // fails closed, so skip writing here.
  if (error) return;
  const activeUntilMs = (event && event.event_type === 'egress_quarantine' && event.payload.until)
    ? new Date(event.payload.until).getTime()
    : 0;
  const isActive = activeUntilMs > Date.now();
  // Already quarantined: re-write only if the fresh TTL pushes 'until' meaningfully
  // forward (>1h). This EXTENDS the quarantine for an ONGOING incident (so the
  // egress doesn't auto-recover 24h after the FIRST detection) while deduping the
  // per-tick re-detections that would otherwise spam audit_events.
  if (isActive && newUntilMs - activeUntilMs < QUARANTINE_EXTEND_THRESHOLD_MS) return;
  const until = new Date(newUntilMs).toISOString();
  const supabase = getSupabaseAdmin();
  const { error: insErr } = await supabase.from('audit_events').insert({
    event_type: 'egress_quarantine',
    payload: { egress_id: egressId, reason, until },
  });
  if (insErr) {
    console.warn(`[egress-pool] quarantine insert err=${insErr.message}`);
  }
}

export async function unquarantineEgress(egressId: string, reason: string = 'manual'): Promise<void> {
  if (!(await isEgressQuarantined(egressId))) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('audit_events').insert({
    event_type: 'egress_unquarantine',
    payload: { egress_id: egressId, reason },
  });
  if (error) {
    console.warn(`[egress-pool] unquarantine insert err=${error.message}`);
  }
}

// Returns:
//   null            — proxy disabled (legacy mode, no proxy fields injected)
// Throws:
//   MisconfigError — PAIRING_PROXY_ENABLED=true but pool empty/all malformed
//                    (operator error, /api/auth/init returns 500, NOT user-facing)
//   FrozenError    — pool valid but every egress is quarantined
//                    (/api/auth/init returns 503 with activation form path)
export async function getEgressForPairing(): Promise<Egress | null> {
  if (process.env.PAIRING_PROXY_ENABLED !== 'true') return null;
  const pool = loadEgressFromEnv();
  if (pool.length === 0) {
    throw new MisconfigError(
      'PAIRING_PROXY_ENABLED=true but pool is empty or malformed. ' +
      'Check PAIRING_EGRESS_POOL + per-egress vars (HOST/PORT/PROTOCOL).',
    );
  }
  // Sequential is fine — pool is small (~2-4 entries).
  for (const e of pool) {
    if (!(await isEgressQuarantined(e.id))) return e;
  }
  throw new FrozenError(`All ${pool.length} egress quarantined. Pairing frozen.`);
}

export function loadEgressFromEnv(): Egress[] {
  const pool = (process.env.PAIRING_EGRESS_POOL || '').trim();
  if (!pool) return [];
  const ids = pool.split(',').map(s => s.trim()).filter(Boolean);
  const result: Egress[] = [];
  for (const id of ids) {
    const prefix = `PAIRING_EGRESS_${id.toUpperCase().replace(/-/g, '_')}_`;
    const host = process.env[prefix + 'HOST'];
    const portStr = process.env[prefix + 'PORT'];
    const protocol = (process.env[prefix + 'PROTOCOL'] || 'http') as EgressProtocol;
    const username = process.env[prefix + 'USERNAME'];
    const password = process.env[prefix + 'PASSWORD'];
    const label = process.env[prefix + 'LABEL'];
    if (!host || !portStr) continue;
    const port = Number(portStr);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) continue;
    if (!VALID_PROTOCOLS.includes(protocol)) continue;
    result.push({
      id, host, port, protocol,
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...(label ? { label } : {}),
    });
  }
  return result;
}
