import { createClient } from '@supabase/supabase-js';
import { fetchDropletMetrics } from './droplet';
import { isEgressQuarantined, quarantineEgress, loadEgressFromEnv } from './egress-pool';
import { isTestInstance } from './monitoring-filters';

// --- Tunables (env-overridable so thresholds can be tuned without a deploy) ---

// Send-cron is considered DOWN if its per-tick heartbeat (ops_heartbeat,
// name='send-messages', stamped every 60s) is older than this. 5min ≈ 5 missed
// ticks — long enough to ride out a single slow lambda, short enough to page
// fast on a real outage.
const CRON_STALE_SEC = Number(process.env.MONITORING_CRON_STALE_SEC) || 300;

// A pending message is "in ritardo" (overdue) once it is this many minutes past
// its scheduled_at. Above normal jitter + the disconnect smart-retry staircase.
const MSG_OVERDUE_MIN = Number(process.env.MONITORING_MSG_OVERDUE_MIN) || 30;

// webhook_inactive only considers an 'open' instance seen within this window
// (last_connection_update). NOTE: that column is only refreshed by the
// CONNECTION_UPDATE webhook / the connect route / the dashboard status poll —
// NOT on every message send. So the window must be GENEROUS, or a quiet but
// genuinely-active user (paired once, never reopens the dashboard) would be
// wrongly excluded and a real broken webhook on their instance would go unseen.
// Default 30 days: long enough to keep quiet real users in, short enough to drop
// truly-abandoned months-old stubs. The test-instance filter (not this window)
// is what removes pre-launch noise. Override with MONITORING_WEBHOOK_ACTIVE_HOURS;
// set to 0 to disable the recency filter entirely (open + non-test only).
const WEBHOOK_ACTIVE_HOURS = process.env.MONITORING_WEBHOOK_ACTIVE_HOURS !== undefined
  ? Number(process.env.MONITORING_WEBHOOK_ACTIVE_HOURS)
  : 720;

// --- Types ---

export interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  checked_at: string;
  // Optional per-result channel override. When set, dispatchAlert sends through
  // exactly these channels instead of the per-check default. Lets a single check
  // self-route by sub-reason (e.g. messages_stuck: page only when the operator
  // can actually act, dashboard-only otherwise).
  channels?: ('whatsapp' | 'email' | 'db')[];
}

// --- Supabase client ---

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// --- Individual Checks ---

export async function checkEvolutionApi(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `${process.env.EVOLUTION_API_URL}/instance/fetchInstances`,
        {
          headers: { apikey: process.env.EVOLUTION_API_KEY! },
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        return { name: 'evolution_api', status: 'critical', message: `HTTP ${res.status}`, checked_at: now };
      }
      return { name: 'evolution_api', status: 'ok', message: 'Raggiungibile', checked_at: now };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    const msg = err?.name === 'AbortError' ? 'Timeout 8s' : (err?.message || 'Errore connessione');
    return { name: 'evolution_api', status: 'critical', message: msg, checked_at: now };
  }
}

// REAL "cron down" signal. Reads the per-tick heartbeat the send-messages cron
// stamps every 60s (ops_heartbeat name='send-messages'). A stale heartbeat means
// the whole send pipeline has stopped — distinct from "a specific message is
// stuck" (checkMessagesStuck). This is the urgent one. It is infra-global, so it
// stays quiet pre-launch as long as the cron itself is running.
export async function checkCronHeartbeat(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('ops_heartbeat')
      .select('ts')
      .eq('name', 'send-messages')
      .limit(1);
    if (error) return { name: 'cron_heartbeat', status: 'critical', message: `Errore lettura heartbeat: ${error.message}`, checked_at: now };
    const ts = data?.[0]?.ts;
    if (!ts) {
      // No beat yet (fresh deploy / table just created). Unknown ≠ incident.
      return { name: 'cron_heartbeat', status: 'ok', message: 'In attesa del primo battito del cron', checked_at: now };
    }
    const ageSec = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
    if (ageSec > CRON_STALE_SEC) {
      const mins = Math.max(1, Math.round(ageSec / 60));
      return { name: 'cron_heartbeat', status: 'critical', message: `Nessun invio da ${mins} min (ultimo battito: ${formatItalianTime(ts)})`, checked_at: now };
    }
    return { name: 'cron_heartbeat', status: 'ok', message: `Cron attivo (ultimo battito ${ageSec}s fa)`, checked_at: now };
  } catch (err: any) {
    return { name: 'cron_heartbeat', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

// "Messages stuck" — separate from cron-down. Counts pending messages that are
// overdue (past scheduled_at by > MSG_OVERDUE_MIN) and explains WHY, with the
// dominant reason named in plain language. Test instances are excluded.
//
// A message stuck because ITS OWN instance is disconnected is NOT a cron failure
// (the cron is smart-retrying it) → lower-urgency warning naming the instance,
// so the operator knows the user must reconnect. Many overdue messages on
// CONNECTED instances while the cron heartbeat is alive is a real send-pipeline
// problem → critical.
export async function checkMessagesStuck(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - MSG_OVERDUE_MIN * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('id, scheduled_at, user_instances!inner(instance_name, phone_number, connection_status)')
      .eq('status', 'pending')
      .lt('scheduled_at', cutoff)
      .order('scheduled_at', { ascending: true })
      .limit(1000);
    if (error) return { name: 'messages_stuck', status: 'warning', message: `Errore query: ${error.message}`, channels: ['db'], checked_at: now };

    const rows = (data || []).filter((r: any) => {
      const ui = r.user_instances;
      return ui && !isTestInstance(ui.instance_name, ui.phone_number);
    });
    if (rows.length === 0) {
      return { name: 'messages_stuck', status: 'ok', message: 'Nessun messaggio in ritardo', checked_at: now };
    }

    // Two independent reasons, counted separately so neither masks the other:
    //  - disconnected instance: the user's phone is offline. The cron is smart-
    //    retrying; the USER must reconnect. Non-actionable for the operator →
    //    dashboard only (no page).
    //  - connected instance but still overdue: a possible send/quota problem the
    //    operator can investigate → page. (The reliable "everything stopped"
    //    critical is checkCronHeartbeat; this stays a warning.)
    let disconnectedMsgs = 0;
    let connectedMsgs = 0;
    const disconnectedBy = new Map<string, number>(); // phone/instance -> overdue count
    for (const r of rows as any[]) {
      const ui = r.user_instances;
      if ((ui.connection_status || '') !== 'open') {
        disconnectedMsgs++;
        const key = ui.phone_number || ui.instance_name || 'sconosciuta';
        disconnectedBy.set(key, (disconnectedBy.get(key) || 0) + 1);
      } else {
        connectedMsgs++;
      }
    }
    const total = rows.length;

    const parts: string[] = [];
    if (disconnectedMsgs > 0) {
      const sorted = Array.from(disconnectedBy.entries()).sort((a, b) => b[1] - a[1]);
      const who = maskNumber(sorted[0][0]);
      const others = disconnectedBy.size - 1;
      const extra = others > 0 ? (others === 1 ? ' e un altro numero' : ` e altri ${others} numeri`) : '';
      parts.push(`${disconnectedMsgs} fermi perché l'istanza ${who}${extra} è disconnessa (l'utente deve riconnettere)`);
    }
    if (connectedMsgs > 0) {
      parts.push(`${connectedMsgs} con istanza connessa che non partono (possibile errore di invio o quota/cooldown)`);
    }

    return {
      name: 'messages_stuck',
      status: 'warning',
      message: `${total} messaggi in ritardo: ${parts.join('; ')}.`,
      // Page only when there is something the operator can act on (connected
      // instances). Pure disconnected backlog is dashboard-only.
      channels: connectedMsgs > 0 ? undefined : ['db'],
      checked_at: now,
    };
  } catch (err: any) {
    return { name: 'messages_stuck', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkWebhookInactive(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    // Step 1: instances that SHOULD be active = connection_status 'open' AND seen
    // recently. We pull phone_number + last_connection_update so we can drop test
    // instances and long-abandoned 'open' stubs (never-really-active) before
    // probing/paging — only genuine, recently-active users count.
    const { data: openInstances, error: e1 } = await supabase
      .from('user_instances')
      .select('instance_name, phone_number, last_connection_update')
      .eq('connection_status', 'open');
    if (e1) return { name: 'webhook_inactive', status: 'critical', message: `Errore query: ${e1.message}`, checked_at: now };

    const recencyEnabled = WEBHOOK_ACTIVE_HOURS > 0;
    const recentCutoff = Date.now() - WEBHOOK_ACTIVE_HOURS * 60 * 60 * 1000;
    const activeInstances = (openInstances || []).filter((inst: any) => {
      if (isTestInstance(inst.instance_name, inst.phone_number)) return false;
      if (!recencyEnabled) return true; // recency filter disabled → open + non-test is enough
      const seen = inst.last_connection_update ? new Date(inst.last_connection_update).getTime() : 0;
      return seen >= recentCutoff; // drop truly-abandoned months-old 'open' stubs
    });
    if (activeInstances.length === 0) {
      return { name: 'webhook_inactive', status: 'ok', message: 'Nessuna istanza realmente attiva da controllare', checked_at: now };
    }

    // Step 2: verify webhook is configured on each active instance via Evolution API
    const unconfigured: string[] = [];
    for (const inst of activeInstances) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(
            `${process.env.EVOLUTION_API_URL}/webhook/find/${inst.instance_name}`,
            {
              headers: { apikey: process.env.EVOLUTION_API_KEY! },
              signal: controller.signal,
            }
          );
          if (!res.ok) {
            unconfigured.push(inst.instance_name);
            continue;
          }
          const data = await res.json();
          // Check if webhook URL is set (handles both v2.0 wrapped and v2.x flat formats)
          const webhookUrl = data?.url || data?.webhook?.url || '';
          if (!webhookUrl) {
            unconfigured.push(inst.instance_name);
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        unconfigured.push(inst.instance_name);
      }
    }

    if (unconfigured.length === activeInstances.length) {
      return { name: 'webhook_inactive', status: 'critical', message: `Webhook mancante su tutte le ${activeInstances.length} istanze attive — nessuna risposta WhatsApp in arrivo viene ricevuta.`, checked_at: now };
    }
    if (unconfigured.length > 0) {
      const masked = unconfigured.map((n) => maskNumber(n)).join(', ');
      return { name: 'webhook_inactive', status: 'warning', message: `Webhook mancante su ${unconfigured.length}/${activeInstances.length} istanze (${masked}).`, checked_at: now };
    }
    return { name: 'webhook_inactive', status: 'ok', message: `Webhook configurato su tutte le ${activeInstances.length} istanze attive`, checked_at: now };
  } catch (err: any) {
    return { name: 'webhook_inactive', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkSupabaseDown(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('user_instances').select('id').limit(1);
    if (error) return { name: 'supabase_down', status: 'critical', message: `Errore database: ${error.message}`, checked_at: now };
    return { name: 'supabase_down', status: 'ok', message: 'Database raggiungibile', checked_at: now };
  } catch (err: any) {
    return { name: 'supabase_down', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

// Messages stuck half-way through sending ('processing' > 10min). The send-cron
// auto-recovers 'processing' rows after 2min, so anything still stuck at 10min
// means that recovery itself is failing. Test instances excluded.
export async function checkMessagesStalled(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('id, user_instances!inner(instance_name, phone_number)')
      .eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .limit(500);
    if (error) return { name: 'messages_stalled', status: 'critical', message: `Errore query: ${error.message}`, checked_at: now };
    const stuck = (data || []).filter((r: any) => {
      const ui = r.user_instances;
      return ui && !isTestInstance(ui.instance_name, ui.phone_number);
    });
    if (stuck.length > 0) return { name: 'messages_stalled', status: 'critical', message: `${stuck.length} messaggi bloccati a metà invio (stato "processing") da oltre 10 min — il recupero automatico non li ha sbloccati.`, checked_at: now };
    return { name: 'messages_stalled', status: 'ok', message: 'Nessun messaggio bloccato a metà invio', checked_at: now };
  } catch (err: any) {
    return { name: 'messages_stalled', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkFailedSpike(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('scheduled_messages')
      .select('id, user_instances!inner(instance_name, phone_number)')
      .eq('status', 'failed')
      .gt('updated_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
      .limit(500);
    if (error) return { name: 'failed_spike', status: 'critical', message: `Errore query: ${error.message}`, checked_at: now };
    const c = (data || []).filter((r: any) => {
      const ui = r.user_instances;
      return ui && !isTestInstance(ui.instance_name, ui.phone_number);
    }).length;
    if (c > 10) return { name: 'failed_spike', status: 'critical', message: `${c} messaggi falliti nelle ultime 2h — possibili numeri non validi, contenuti bloccati o ban.`, checked_at: now };
    if (c > 5) return { name: 'failed_spike', status: 'warning', message: `${c} messaggi falliti nelle ultime 2h.`, checked_at: now };
    return { name: 'failed_spike', status: 'ok', message: `${c} messaggi falliti nelle ultime 2h`, checked_at: now };
  } catch (err: any) {
    return { name: 'failed_spike', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkDropletRam(): Promise<CheckResult> {
  const now = new Date().toISOString();
  // Push mode (runbook §8.2): metriche dal cron Hetzner via host_metrics.
  // Legacy: API DigitalOcean (droplet distrutto 2026-07-05, DO_* rimosse).
  const pushMode = (process.env.HOST_METRICS_SOURCE || '').trim().toLowerCase() === 'push';
  if (!pushMode && (!process.env.DO_API_TOKEN || !process.env.DO_DROPLET_ID)) {
    return { name: 'droplet_ram', status: 'ok', message: 'Monitoring host non configurato (HOST_METRICS_SOURCE=push o DO_*)', checked_at: now };
  }

  try {
    const metrics = await fetchDropletMetrics();
    if (!metrics) {
      return {
        name: 'droplet_ram',
        status: 'warning',
        message: pushMode
          ? 'Metriche host assenti o stantie (>5 min) — cron push sul server fermo?'
          : 'Impossibile leggere metriche DO',
        checked_at: now,
      };
    }

    const ram = metrics.ram_percent;

    // Channel routing (WhatsApp/email/dashboard) is decided by dispatchAlert from
    // the RAM %, so the message stays a plain status — no routing jargon here.
    if (ram >= 80) {
      return { name: 'droplet_ram', status: 'critical', message: `RAM del server all'${ram}% — quasi piena.`, checked_at: now };
    }
    if (ram >= 70) {
      return { name: 'droplet_ram', status: 'warning', message: `RAM del server al ${ram}%.`, checked_at: now };
    }
    if (ram >= 50) {
      return { name: 'droplet_ram', status: 'warning', message: `RAM del server al ${ram}%.`, checked_at: now };
    }
    return { name: 'droplet_ram', status: 'ok', message: `RAM al ${ram}%`, checked_at: now };
  } catch (err: any) {
    return { name: 'droplet_ram', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkInstanceFlapping(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const windowStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('audit_events')
      .select('payload')
      .eq('event_type', 'instance_disconnect')
      .gte('created_at', windowStart);
    if (error) return { name: 'instance_flapping', status: 'critical', message: `Errore query: ${error.message}`, checked_at: now };

    const agg: Record<string, { n: number; codes: Set<number> }> = {};
    for (const row of data || []) {
      const pl: any = (row as any)?.payload || {};
      const inst = typeof pl.instance === 'string' ? pl.instance : 'unknown';
      if (isTestInstance(inst)) continue; // test instances flap during pairing tests — not a real ban signal
      if (!agg[inst]) agg[inst] = { n: 0, codes: new Set() };
      agg[inst].n++;
      if (typeof pl.code === 'number') agg[inst].codes.add(pl.code);
    }

    let worst: { inst: string; n: number; codes: number[] } | null = null;
    for (const [inst, v] of Object.entries(agg)) {
      if (!worst || v.n > worst.n) worst = { inst, n: v.n, codes: Array.from(v.codes) };
    }

    if (!worst || worst.n < 4) {
      return { name: 'instance_flapping', status: 'ok', message: worst ? `Max ${worst.n} disconnessioni/3h` : 'Nessuna disconnessione recente', checked_at: now };
    }

    // 403 forbidden = likely ban/block; repeated flapping (>=8/3h) also critical.
    const has403 = worst.codes.includes(403);
    const codesStr = worst.codes.length ? ` [codici ${worst.codes.join(',')}]` : '';
    if (has403 || worst.n >= 8) {
      return { name: 'instance_flapping', status: 'critical', message: `Il numero ${maskNumber(worst.inst)} si è disconnesso ${worst.n} volte in 3h${codesStr} — rischio ban/blocco WhatsApp.`, checked_at: now };
    }
    return { name: 'instance_flapping', status: 'warning', message: `Il numero ${maskNumber(worst.inst)} si è disconnesso ${worst.n} volte in 3h${codesStr}.`, checked_at: now };
  } catch (err: any) {
    return { name: 'instance_flapping', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

// 24h pairing blackout. Detects the May 2026 incident pattern (IPv6 droplet
// silently dropped every `CONNECTION_UPDATE state=open` for ~30 days while
// /api/auth/init kept handing out valid pairing codes — zero monitors caught it).
// Threshold rationale (Q2 + Codex F4a): critical at >=5 attempts because at
// early-stage volume a single confused user can produce 3 retries during a
// single onboarding session, and 3-as-critical would page on a real but benign
// edge case. The IPv6 bug produced >>5 init/day so the higher threshold still
// catches it well within 24h.
// Fase 0 §6: split into (a) per-egress check when PAIRING_PROXY_ENABLED=true
// + (b) legacy global check. Legacy auto-disables 25h after
// PAIRING_PROXY_ENABLED_SINCE so it doesn't false-positive on transition data.
// Per-egress check quarantines an egress (writes audit egress_quarantine via
// quarantineEgress) when started>=5 / completed=0 in 24h; quarantineEgress is
// idempotent so re-runs by concurrent cron triggers don't audit-spam.
export async function checkPairingBlackout(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('audit_events')
      .select('event_type,payload')
      .in('event_type', ['pairing_started', 'pairing_completed'])
      .gte('created_at', windowStart);
    if (error) return { name: 'pairing_blackout', status: 'critical', message: `Errore query: ${error.message}`, checked_at: now };

    // Exclude operator pairing tests (burned/test numbers) — otherwise repeated
    // test pairings on a Meta-blocked number trip a false "pairing rotto".
    const rows = ((data || []) as Array<{ event_type: string; payload: any }>)
      .filter((r) => !isTestInstance(r.payload?.instance_name));
    const proxyEnabled = process.env.PAIRING_PROXY_ENABLED === 'true';

    // === (a) Per-egress check (proxy mode only) ===
    if (proxyEnabled) {
      const perEgress = new Map<string, { started: number; completed: number }>();
      for (const r of rows) {
        const eid = r.payload?.egress_id;
        if (!eid) continue; // pre-A1 data falls through to legacy below
        const slot = perEgress.get(eid) || { started: 0, completed: 0 };
        if (r.event_type === 'pairing_started') slot.started++;
        else if (r.event_type === 'pairing_completed') slot.completed++;
        perEgress.set(eid, slot);
      }
      const quarantined: string[] = [];
      for (const [eid, { started, completed }] of perEgress.entries()) {
        if (started >= 5 && completed === 0) {
          await quarantineEgress(eid, 'blackout_24h', 24);
          quarantined.push(eid);
        }
      }
      if (quarantined.length > 0) {
        return {
          name: 'pairing_blackout',
          status: 'critical',
          message: `Pairing congelato: ${quarantined.length} proxy messi in pausa perché nessun numero riusciva a connettersi.`,
          checked_at: now,
        };
      }
    }

    // === (b) Aggregate backstop ===
    // Runs over ALL rows whenever the per-egress branch did not already quarantine.
    // Catches DISTRIBUTED blackouts the per-egress threshold misses: e.g. 3 starts
    // across 3 egresses (9 total / 0 completions) — no single egress reaches
    // started>=5, but pairing is globally broken. NO 25h 'ok' short-circuit: this
    // aggregate stays a real safety net for the whole life of proxy mode.
    let started = 0;
    let completed = 0;
    for (const r of rows) {
      if (r.event_type === 'pairing_started') started++;
      else if (r.event_type === 'pairing_completed') completed++;
    }
    if (completed >= 1) return { name: 'pairing_blackout', status: 'ok', message: `${completed}/${started} pairing riusciti in 24h`, checked_at: now };
    if (started === 0) return { name: 'pairing_blackout', status: 'ok', message: 'Nessun tentativo di pairing nelle 24h', checked_at: now };
    if (started >= 5) return { name: 'pairing_blackout', status: 'critical', message: `${started} tentativi, 0 successi in 24h — pairing rotto`, checked_at: now };
    return { name: 'pairing_blackout', status: 'warning', message: `${started} tentativi, 0 successi in 24h — monitora`, checked_at: now };
  } catch (err: any) {
    return { name: 'pairing_blackout', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

// Fase 0 §6 — fires when 100% of the pool is quarantined. checkPairingBlackout
// already auto-quarantines individual egress; this check is the discriminator
// that turns "1 egress down, route to next" into "freeze pairing — every
// retry now burns reputation, stop trying until manual unquarantine or TTL
// expiry". Emits audit pairing_freeze_activated so the event has its own
// ledger entry independent of the underlying egress_quarantine rows.
export async function checkAllEgressDown(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const pool = loadEgressFromEnv();
    if (pool.length === 0) {
      return { name: 'all_egress_down', status: 'ok', message: 'Nessun pool di proxy configurato', checked_at: now };
    }
    const states = await Promise.all(pool.map(e => isEgressQuarantined(e.id)));
    const quarantinedCount = states.filter(Boolean).length;
    if (quarantinedCount === pool.length) {
      const supabase = getSupabase();
      await supabase.from('audit_events').insert({
        event_type: 'pairing_freeze_activated',
        payload: { pool_size: pool.length, triggered_at: now },
      });
      return {
        name: 'all_egress_down',
        status: 'critical',
        message: `Tutti i ${pool.length} proxy sono in quarantena: nessun nuovo numero può connettersi.`,
        checked_at: now,
      };
    }
    return {
      name: 'all_egress_down',
      status: 'ok',
      message: `${pool.length - quarantinedCount}/${pool.length} proxy disponibili`,
      checked_at: now,
    };
  } catch (err: any) {
    return { name: 'all_egress_down', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

// --- Run All Checks ---

export async function runAllChecks(): Promise<CheckResult[]> {
  const checks = [
    checkEvolutionApi,
    checkCronHeartbeat,
    checkMessagesStuck,
    checkWebhookInactive,
    checkSupabaseDown,
    checkMessagesStalled,
    checkFailedSpike,
    checkDropletRam,
    checkInstanceFlapping,
    checkPairingBlackout,
    checkAllEgressDown,
  ];
  const results: CheckResult[] = [];
  for (const checkFn of checks) {
    try {
      results.push(await checkFn());
    } catch (err: any) {
      results.push({
        name: checkFn.name.replace('check', '').replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, ''),
        status: 'critical',
        message: `Uncaught: ${err?.message || 'unknown'}`,
        checked_at: new Date().toISOString(),
      });
    }
  }
  return results;
}

// --- Anti-spam / dedup ---

// Higher rank = more severe. Used by classifyTransition + shouldAlert escalation
// pass-through: a warning->critical transition MUST not be silenced by the dedup
// window (Codex review F1c).
const STATUS_RANK: Record<string, number> = { ok: 0, warning: 1, critical: 2 };

// How long an ACTIVE incident stays quiet between re-notifications. The first
// alert fires immediately (onset); after that the same ongoing problem is
// re-sent at most once per this window (a "promemoria"), instead of every
// 15-min monitor tick. Default 6h; override with MONITORING_REMINDER_HOURS.
export function reminderMs(): number {
  const h = Number(process.env.MONITORING_REMINDER_HOURS);
  return (Number.isFinite(h) && h > 0 ? h : 6) * 60 * 60 * 1000;
}

export type AlertTransition = 'onset' | 'escalation' | 'reminder' | 'recovery' | 'none';

// Pure classification of a check's status transition, comparing the previously
// recorded status (monitoring_checks) with the current one. The health-check
// route uses this to decide WHAT kind of notification (if any) to send and how
// to label it. Dedup of repeated reminders is still gated by shouldAlert.
//   ok            -> non-ok : onset      (first alert, fire now)
//   weaker        -> worse  : escalation (e.g. warning->critical, fire now)
//   non-ok        -> same/milder non-ok : reminder (only every reminder window)
//   non-ok        -> ok     : recovery   ("Risolto")
//   ok/null       -> ok     : none
export function classifyTransition(previousStatus: string | null | undefined, currentStatus: string): AlertTransition {
  const prev = STATUS_RANK[previousStatus ?? 'ok'] ?? 0;
  const cur = STATUS_RANK[currentStatus] ?? 0;
  if (cur === 0) return prev > 0 ? 'recovery' : 'none';
  if (prev === 0) return 'onset';
  if (cur > prev) return 'escalation';
  return 'reminder';
}

// Mask a phone/instance identifier to its last 4 digits for operator-facing
// alerts (no full customer numbers in the alert text — PII hygiene, H5).
export function maskNumber(value: string | null | undefined): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'n/d'; // gender-neutral so it reads fine after "il numero" / "l'istanza"
  return '…' + digits.slice(-4);
}

// Dedup gate keyed on monitoring_alerts. Returns true if we should (re)send now:
// no alert logged within the reminder window, OR a strict escalation vs the last
// logged status (escalation bypasses the window). Same/milder status within the
// window is suppressed — that is what stops the every-tick re-spam.
export async function shouldAlert(checkName: string, currentStatus?: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const windowMs = reminderMs();
    const windowStart = new Date(Date.now() - windowMs).toISOString();
    const { data, error } = await supabase
      .from('monitoring_alerts')
      .select('created_at, status')
      .eq('check_name', checkName)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('shouldAlert query error:', error.message);
      return true;
    }
    if (!data || data.length === 0) return true;
    // Belt-and-suspenders: confirm the last alert is within the window.
    const lastAlert = new Date(data[0].created_at).getTime();
    if (Date.now() - lastAlert > windowMs) return true;
    // Escalation pass-through: a strictly worse status than the last-alerted one
    // bypasses the window. Regressions to a milder status stay suppressed.
    if (currentStatus !== undefined) {
      const prevRank = STATUS_RANK[(data[0] as any).status] ?? 0;
      const curRank = STATUS_RANK[currentStatus] ?? 0;
      if (curRank > prevRank) return true;
    }
    return false;
  } catch {
    return true; // if we can't check, better to alert
  }
}

// Recovery dedup: only announce/record a resolution if the most recent logged
// alert for this check is still non-ok (i.e. the incident hasn't already been
// resolved). Prevents a second concurrent health-check run — and every
// subsequent tick — from re-sending "Risolto" for the same recovery.
export async function shouldRecover(checkName: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('monitoring_alerts')
      .select('status')
      .eq('check_name', checkName)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return false; // can't confirm an open incident → don't emit a stray recovery
    if (!data || data.length === 0) return false; // never alerted → nothing to resolve
    return (data[0] as any).status !== 'ok';
  } catch {
    return false;
  }
}

// --- Alert Cascade ---

// Fail-fast read: if ADMIN_PHONE / ADMIN_EMAIL are unset, surface the
// misconfiguration at call site rather than silently routing alerts to a
// hardcoded fallback (audit-2026-05-25 issue #5: PII operatore committed
// to public repo). Throws are deferred to actual usage to keep import-time
// side-effects minimal.
function operatorPhone(): string {
  const v = process.env.ADMIN_PHONE;
  if (!v) throw new Error('ADMIN_PHONE env var is required for operator alerts');
  return v;
}
function operatorEmail(): string {
  const v = process.env.ADMIN_EMAIL;
  if (!v) throw new Error('ADMIN_EMAIL env var is required for operator alerts');
  return v;
}

// Plain-language "what is happening" — no jargon, no internal field names.
const CHECK_DESCRIPTIONS: Record<string, string> = {
  evolution_api: 'Il server WhatsApp (Evolution) non risponde',
  cron_heartbeat: 'Gli invii sono fermi — il cron che manda i messaggi non gira',
  messages_stuck: 'Alcuni messaggi programmati non stanno partendo',
  webhook_inactive: 'Webhook non configurato — le risposte WhatsApp in arrivo non vengono ricevute',
  supabase_down: 'Il database non risponde',
  messages_stalled: 'Messaggi bloccati a metà invio',
  failed_spike: 'Troppi messaggi falliti',
  droplet_ram: 'Memoria del server quasi piena',
  instance_flapping: 'Un numero si disconnette in continuazione — rischio ban WhatsApp',
  pairing_blackout: 'Le connessioni di nuovi numeri non vanno a buon fine',
  all_egress_down: 'Tutti i proxy di connessione sono bloccati — pairing congelato',
};

// "What to do" — the single most useful next action for the operator.
const CHECK_ACTIONS: Record<string, string> = {
  evolution_api: 'Controlla il container Evolution su Coolify (Hetzner) e riavvialo se serve.',
  cron_heartbeat: 'Controlla cron-job.org e il Vercel Cron di /api/cron/send-messages; riattiva il pinger.',
  messages_stuck: "Se è un'istanza disconnessa, l'utente deve riconnettere su /connect. Se sono molti numeri diversi, controlla il nodo Evolution.",
  webhook_inactive: "Ri-registra il webhook dell'istanza da Evolution Manager (URL /api/webhook).",
  supabase_down: 'Controlla lo stato del progetto su Supabase.',
  messages_stalled: 'Controlla i log del cron send-messages: il recupero automatico dei "processing" potrebbe essere bloccato.',
  failed_spike: 'Apri /admin e verifica numeri/contenuti che falliscono (numeri non validi o possibile ban).',
  droplet_ram: 'Spegni istanze/app orfane su Coolify o aumenta la RAM del nodo.',
  instance_flapping: 'Sospendi gli invii su quel numero e verifica un possibile ban Meta prima di ripristinare.',
  pairing_blackout: "Verifica l'immagine Evolution patchata e la reputazione del numero/egress usato.",
  all_egress_down: 'Sblocca manualmente un egress o attendi la scadenza della quarantena.',
};

const SEVERITY_EMOJI: Record<string, string> = { critical: '🔴', warning: '🟠', ok: '✅' };

function formatItalianTime(date?: string | Date): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

function buildAlertText(check: CheckResult, isReminder = false): string {
  const head = isReminder
    ? '🔁 WhatsLater — Promemoria (problema ancora attivo)'
    : `${SEVERITY_EMOJI[check.status] || '⚠️'} WhatsLater — ${check.status === 'critical' ? 'Allarme' : 'Avviso'}`;
  const action = CHECK_ACTIONS[check.name];
  const lines = [
    head,
    '━━━━━━━━━━━━━━━━',
    `Cosa succede: ${CHECK_DESCRIPTIONS[check.name] || check.name}`,
    `Dettaglio: ${check.message}`,
    action ? `Cosa fare: ${action}` : null,
    `Ora: ${formatItalianTime()}`,
    '━━━━━━━━━━━━━━━━',
    'Dashboard: https://whatslaterpush.vercel.app/admin',
  ].filter(Boolean) as string[];
  return lines.join('\n');
}

function buildRecoveryText(check: CheckResult): string {
  return `✅ WhatsLater — Risolto\n━━━━━━━━━━━━━━━━\n${CHECK_DESCRIPTIONS[check.name] || check.name}\nIl problema è rientrato.\nOra: ${formatItalianTime()}`;
}

async function getAlertInstance(): Promise<string | null> {
  try {
    const supabase = getSupabase();
    // SECURITY: Only use the operator's own instance as sender. Never route alerts
    // through customer instances — the alert text may include admin links and
    // would otherwise leak into customers' WhatsApp sent-message history.
    const { data } = await supabase
      .from('user_instances')
      .select('instance_name')
      .eq('phone_number', operatorPhone())
      .limit(1);
    return data?.[0]?.instance_name || null;
  } catch {
    return null;
  }
}

async function sendWhatsApp(text: string): Promise<boolean> {
  try {
    const instanceName = await getAlertInstance();
    if (!instanceName) return false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(
        `${process.env.EVOLUTION_API_URL}/message/sendText/${instanceName}`,
        {
          method: 'POST',
          headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: operatorPhone(), text }),
          signal: controller.signal,
        }
      );
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

async function sendEmail(check: CheckResult, text: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: operatorEmail(),
        subject: `⚠️ WhatsLater: ${check.name} — ${check.status}`,
        text,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function logAlert(check: CheckResult, channel: string): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase.from('monitoring_alerts').insert({
      check_name: check.name,
      status: check.status,
      message: check.message,
      channel,
    });
  } catch {
    console.error('Failed to log monitoring alert:', check.name);
  }
}

// Record a resolution WITHOUT notifying. Used for warning-level incidents that
// resolve: we don't page a "Risolto" (silent-by-default), but we must log an 'ok'
// row so the dedup sees the incident as closed — otherwise the next recurrence
// of the same warning within the reminder window would be suppressed as a
// duplicate instead of treated as a fresh onset.
export async function logResolution(check: CheckResult): Promise<void> {
  await logAlert({ ...check, status: 'ok' }, 'db_only');
}

export async function sendAlertWithChannel(check: CheckResult, channels: ('whatsapp' | 'email' | 'db')[], isReminder = false): Promise<void> {
  const text = buildAlertText(check, isReminder);

  if (channels.includes('whatsapp')) {
    if (await sendWhatsApp(text)) {
      await logAlert(check, 'whatsapp');
      if (!channels.includes('email')) return;
    }
  }
  if (channels.includes('email')) {
    if (await sendEmail(check, text)) {
      await logAlert(check, 'email');
      return;
    }
  }
  await logAlert(check, 'db_only');
}

export async function sendAlert(check: CheckResult, isReminder = false): Promise<void> {
  const text = buildAlertText(check, isReminder);

  // Cascade: WhatsApp → Email → DB only
  if (await sendWhatsApp(text)) {
    await logAlert(check, 'whatsapp');
    return;
  }
  if (await sendEmail(check, text)) {
    await logAlert(check, 'email');
    return;
  }
  await logAlert(check, 'db_only');
}

// Single place that routes a check to the right channels by severity/type, and
// carries the reminder flag so a re-notification is labelled "Promemoria".
// Used by the health-check route for both first alerts and reminders.
export async function dispatchAlert(check: CheckResult, isReminder = false): Promise<void> {
  // Per-check self-routing wins (e.g. messages_stuck dashboard-only when the
  // backlog is purely user-disconnect, which the operator can't act on).
  if (check.channels) {
    return sendAlertWithChannel(check, check.channels, isReminder);
  }
  if (check.name === 'droplet_ram') {
    // Progressive channel escalation by RAM %.
    const ramPct = parseInt(check.message.match(/(\d+)%/)?.[1] || '0', 10);
    if (ramPct >= 80) return sendAlertWithChannel(check, ['whatsapp', 'email'], isReminder);
    if (ramPct >= 70) return sendAlertWithChannel(check, ['whatsapp'], isReminder);
    return sendAlertWithChannel(check, ['db'], isReminder);
  }
  if (check.name === 'pairing_blackout' || check.name === 'all_egress_down') {
    // Critical pages WhatsApp+email; warning stays in the DB (false-positive
    // protection for low-traffic onboarding windows). all_egress_down is always
    // critical, so its db-only branch is intentionally inert.
    if (check.status === 'critical') return sendAlertWithChannel(check, ['whatsapp', 'email'], isReminder);
    return sendAlertWithChannel(check, ['db'], isReminder);
  }
  return sendAlert(check, isReminder);
}

export async function sendRecovery(check: CheckResult): Promise<void> {
  const text = buildRecoveryText(check);

  if (await sendWhatsApp(text)) {
    await logAlert({ ...check, status: 'ok' }, 'whatsapp');
    return;
  }
  if (await sendEmail({ ...check, status: 'ok' }, text)) {
    await logAlert({ ...check, status: 'ok' }, 'email');
    return;
  }
  await logAlert({ ...check, status: 'ok' }, 'db_only');
}
