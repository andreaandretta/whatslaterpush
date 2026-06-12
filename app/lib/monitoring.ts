import { createClient } from '@supabase/supabase-js';
import { fetchDropletMetrics } from './droplet';
import { isEgressQuarantined, quarantineEgress, loadEgressFromEnv } from './egress-pool';

// --- Types ---

export interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'critical';
  message: string;
  checked_at: string;
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

export async function checkCronStalled(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('scheduled_at', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    if (error) return { name: 'cron_stalled', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    if ((count ?? 0) > 0) return { name: 'cron_stalled', status: 'critical', message: `${count} messaggi pending da >25h`, checked_at: now };
    return { name: 'cron_stalled', status: 'ok', message: 'Nessun messaggio bloccato', checked_at: now };
  } catch (err: any) {
    return { name: 'cron_stalled', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkWebhookInactive(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    // Step 1: any active instances?
    const { data: activeInstances, error: e1 } = await supabase
      .from('user_instances')
      .select('instance_name')
      .eq('connection_status', 'open');
    if (e1) return { name: 'webhook_inactive', status: 'critical', message: `Query error: ${e1.message}`, checked_at: now };
    if (!activeInstances || activeInstances.length === 0) {
      return { name: 'webhook_inactive', status: 'ok', message: 'Nessuna istanza attiva', checked_at: now };
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
      return { name: 'webhook_inactive', status: 'critical', message: `Webhook non configurato su ${unconfigured.length}/${activeInstances.length} istanze attive`, checked_at: now };
    }
    if (unconfigured.length > 0) {
      return { name: 'webhook_inactive', status: 'warning', message: `Webhook mancante su ${unconfigured.length}/${activeInstances.length}: ${unconfigured.join(', ')}`, checked_at: now };
    }
    return { name: 'webhook_inactive', status: 'ok', message: `Webhook configurato su ${activeInstances.length} istanze`, checked_at: now };
  } catch (err: any) {
    return { name: 'webhook_inactive', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkSupabaseDown(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('user_instances').select('id').limit(1);
    if (error) return { name: 'supabase_down', status: 'critical', message: `DB error: ${error.message}`, checked_at: now };
    return { name: 'supabase_down', status: 'ok', message: 'Database raggiungibile', checked_at: now };
  } catch (err: any) {
    return { name: 'supabase_down', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkMessagesStalled(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
    if (error) return { name: 'messages_stalled', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    if ((count ?? 0) > 0) return { name: 'messages_stalled', status: 'critical', message: `${count} messaggi bloccati in 'processing'`, checked_at: now };
    return { name: 'messages_stalled', status: 'ok', message: 'Nessun messaggio bloccato', checked_at: now };
  } catch (err: any) {
    return { name: 'messages_stalled', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkFailedSpike(): Promise<CheckResult> {
  const now = new Date().toISOString();
  try {
    const supabase = getSupabase();
    const { count, error } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gt('updated_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    if (error) return { name: 'failed_spike', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };
    const c = count ?? 0;
    if (c > 10) return { name: 'failed_spike', status: 'critical', message: `${c} messaggi falliti nelle ultime 2h`, checked_at: now };
    if (c > 5) return { name: 'failed_spike', status: 'warning', message: `${c} messaggi falliti nelle ultime 2h`, checked_at: now };
    return { name: 'failed_spike', status: 'ok', message: `${c} falliti nelle ultime 2h`, checked_at: now };
  } catch (err: any) {
    return { name: 'failed_spike', status: 'critical', message: err?.message || 'Errore', checked_at: now };
  }
}

export async function checkDropletRam(): Promise<CheckResult> {
  const now = new Date().toISOString();
  if (!process.env.DO_API_TOKEN || !process.env.DO_DROPLET_ID) {
    return { name: 'droplet_ram', status: 'ok', message: 'Monitoring DO non configurato', checked_at: now };
  }

  try {
    const metrics = await fetchDropletMetrics();
    if (!metrics) {
      return { name: 'droplet_ram', status: 'warning', message: 'Impossibile leggere metriche DO', checked_at: now };
    }

    const ram = metrics.ram_percent;

    if (ram >= 80) {
      return { name: 'droplet_ram', status: 'critical', message: `RAM al ${ram}% — alert WhatsApp + Email`, checked_at: now };
    }
    if (ram >= 70) {
      return { name: 'droplet_ram', status: 'warning', message: `RAM al ${ram}% — alert WhatsApp`, checked_at: now };
    }
    if (ram >= 50) {
      return { name: 'droplet_ram', status: 'warning', message: `RAM al ${ram}% — solo dashboard`, checked_at: now };
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
    if (error) return { name: 'instance_flapping', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };

    const agg: Record<string, { n: number; codes: Set<number> }> = {};
    for (const row of data || []) {
      const pl: any = (row as any)?.payload || {};
      const inst = typeof pl.instance === 'string' ? pl.instance : 'unknown';
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
      return { name: 'instance_flapping', status: 'critical', message: `${worst.inst}: ${worst.n} disconnessioni in 3h${codesStr} — rischio ban/blocco`, checked_at: now };
    }
    return { name: 'instance_flapping', status: 'warning', message: `${worst.inst}: ${worst.n} disconnessioni in 3h${codesStr}`, checked_at: now };
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
    if (error) return { name: 'pairing_blackout', status: 'critical', message: `Query error: ${error.message}`, checked_at: now };

    const rows = (data || []) as Array<{ event_type: string; payload: any }>;
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
          message: `Egress quarantined: ${quarantined.join(', ')}`,
          checked_at: now,
        };
      }
    }

    // === (b) Legacy global check ===
    // Skips entirely 25h after the proxy go-live: by that point every row in
    // the window has egress_id, so the global aggregate is statistically
    // identical to the per-egress one — no value in double-firing.
    const since = process.env.PAIRING_PROXY_ENABLED_SINCE;
    const legacyExpired = since && (Date.now() - new Date(since).getTime() > 25 * 60 * 60 * 1000);
    if (proxyEnabled && legacyExpired) {
      return { name: 'pairing_blackout', status: 'ok', message: 'Per-egress monitoring active; legacy skipped', checked_at: now };
    }

    // Legacy only sees rows without egress_id (pre-A1 era + proxy=off rows).
    const legacyRows = proxyEnabled ? rows.filter(r => !r.payload?.egress_id) : rows;
    let started = 0;
    let completed = 0;
    for (const r of legacyRows) {
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
      return { name: 'all_egress_down', status: 'ok', message: 'No egress pool configured', checked_at: now };
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
        message: `All ${pool.length} egress quarantined. Pairing frozen.`,
        checked_at: now,
      };
    }
    return {
      name: 'all_egress_down',
      status: 'ok',
      message: `${pool.length - quarantinedCount}/${pool.length} egress available`,
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
    checkCronStalled,
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

// --- Anti-spam ---

// Higher rank = more severe. Used by shouldAlert escalation pass-through:
// a warning->critical transition within the 1h dedup window MUST not be
// silenced (Codex review F1c — original dedup keyed on check_name only,
// so escalation to a worse status was getting eaten for up to 1h).
const STATUS_RANK: Record<string, number> = { ok: 0, warning: 1, critical: 2 };

export async function shouldAlert(checkName: string, currentStatus?: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    // Check if we already alerted (any channel) within the last hour.
    // We also pull `status` so we can let escalations (warning->critical)
    // bypass the dedup window — see comment on STATUS_RANK above.
    const { data, error } = await supabase
      .from('monitoring_alerts')
      .select('created_at, status')
      .eq('check_name', checkName)
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('shouldAlert query error:', error.message);
      return true;
    }
    if (!data || data.length === 0) return true;
    // Double-check: verify the alert is actually within the last hour (belt-and-suspenders)
    const lastAlert = new Date(data[0].created_at).getTime();
    if (Date.now() - lastAlert > 60 * 60 * 1000) return true;
    // Escalation pass-through: if the new status is strictly worse than the
    // last-alerted status, allow the alert through despite being within the
    // dedup window. Regressions to a milder status remain suppressed (we
    // already alerted, no need to re-page for a partial recovery).
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

const CHECK_DESCRIPTIONS: Record<string, string> = {
  evolution_api: 'Evolution API non raggiungibile',
  cron_stalled: 'Cron bloccato — messaggi pending da >25h',
  webhook_inactive: 'Webhook inattivo — nessun messaggio recente',
  supabase_down: 'Database Supabase non raggiungibile',
  messages_stalled: 'Messaggi bloccati in stato "processing"',
  failed_spike: 'Picco di messaggi falliti',
  droplet_ram: 'RAM droplet elevata',
  instance_flapping: 'Istanza instabile (disconnessioni ripetute / rischio ban)',
  pairing_blackout: 'Pairing non funziona — nessun completamento in 24h',
};

function formatItalianTime(): string {
  return new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

function buildAlertText(check: CheckResult): string {
  return `⚠️ WhatsLater Alert\n━━━━━━━━━━━━━━━━\nProblema: ${CHECK_DESCRIPTIONS[check.name] || check.name}\nDettaglio: ${check.message}\nOra: ${formatItalianTime()}\n━━━━━━━━━━━━━━━━\nhttps://whatslaterpush.vercel.app/admin`;
}

function buildRecoveryText(check: CheckResult): string {
  return `✅ WhatsLater Risolto\n━━━━━━━━━━━━━━━━\nRisolto: ${CHECK_DESCRIPTIONS[check.name] || check.name}\nOra: ${formatItalianTime()}`;
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

export async function sendAlertWithChannel(check: CheckResult, channels: ('whatsapp' | 'email' | 'db')[]): Promise<void> {
  const text = buildAlertText(check);

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

export async function sendAlert(check: CheckResult): Promise<void> {
  const text = buildAlertText(check);

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
