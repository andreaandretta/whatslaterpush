import { createClient } from '@supabase/supabase-js';

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
    const { count: activeCount, error: e1 } = await supabase
      .from('user_instances')
      .select('id', { count: 'exact', head: true })
      .eq('connection_status', 'open');
    if (e1) return { name: 'webhook_inactive', status: 'critical', message: `Query error: ${e1.message}`, checked_at: now };
    if ((activeCount ?? 0) === 0) return { name: 'webhook_inactive', status: 'ok', message: 'Nessuna istanza attiva', checked_at: now };

    // Step 2: newest message
    const { data, error: e2 } = await supabase
      .from('scheduled_messages')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1);
    if (e2) return { name: 'webhook_inactive', status: 'critical', message: `Query error: ${e2.message}`, checked_at: now };

    if (!data || data.length === 0) {
      return { name: 'webhook_inactive', status: 'warning', message: `Nessun messaggio nel DB con ${activeCount} istanze attive`, checked_at: now };
    }

    const latest = new Date(data[0].created_at).getTime();
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    if (latest < twelveHoursAgo) {
      return { name: 'webhook_inactive', status: 'warning', message: `Ultimo messaggio ${new Date(data[0].created_at).toLocaleString('it-IT')} con ${activeCount} istanze attive`, checked_at: now };
    }
    return { name: 'webhook_inactive', status: 'ok', message: 'Webhook attivo', checked_at: now };
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

// --- Run All Checks ---

export async function runAllChecks(): Promise<CheckResult[]> {
  const checks = [
    checkEvolutionApi,
    checkCronStalled,
    checkWebhookInactive,
    checkSupabaseDown,
    checkMessagesStalled,
    checkFailedSpike,
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

export async function shouldAlert(checkName: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('monitoring_alerts')
      .select('created_at')
      .eq('check_name', checkName)
      .in('channel', ['whatsapp', 'email'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return true;
    const lastAlert = new Date(data[0].created_at).getTime();
    return Date.now() - lastAlert > 60 * 60 * 1000; // 1 hour cooldown
  } catch {
    return true; // if we can't check, better to alert
  }
}

// --- Alert Cascade ---

const OPERATOR_PHONE = '393442582226';
const OPERATOR_EMAIL = 'musicizthekey@gmail.com';

const CHECK_DESCRIPTIONS: Record<string, string> = {
  evolution_api: 'Evolution API non raggiungibile',
  cron_stalled: 'Cron bloccato — messaggi pending da >25h',
  webhook_inactive: 'Webhook inattivo — nessun messaggio recente',
  supabase_down: 'Database Supabase non raggiungibile',
  messages_stalled: 'Messaggi bloccati in stato "processing"',
  failed_spike: 'Picco di messaggi falliti',
};

function formatItalianTime(): string {
  return new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
}

function buildAlertText(check: CheckResult): string {
  return `⚠️ WhatsLater Alert\n━━━━━━━━━━━━━━━━\nProblema: ${CHECK_DESCRIPTIONS[check.name] || check.name}\nDettaglio: ${check.message}\nOra: ${formatItalianTime()}\n━━━━━━━━━━━━━━━━\nControlla: whatslaterpush.vercel.app/monitoring?secret=...`;
}

function buildRecoveryText(check: CheckResult): string {
  return `✅ WhatsLater Risolto\n━━━━━━━━━━━━━━━━\nRisolto: ${CHECK_DESCRIPTIONS[check.name] || check.name}\nOra: ${formatItalianTime()}`;
}

async function getAlertInstance(): Promise<string | null> {
  try {
    const supabase = getSupabase();
    // Use a DIFFERENT instance from the operator's own phone to avoid self-message
    // (self-messages via Evolution API return 200 but don't deliver/notify)
    const { data, error } = await supabase
      .from('user_instances')
      .select('instance_name')
      .eq('connection_status', 'open')
      .neq('phone_number', OPERATOR_PHONE)
      .limit(1);
    if (!error && data && data.length > 0) return data[0].instance_name;
    // Fallback: use operator's own instance if no other available
    const { data: fallback } = await supabase
      .from('user_instances')
      .select('instance_name')
      .eq('phone_number', OPERATOR_PHONE)
      .limit(1);
    return fallback?.[0]?.instance_name || null;
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
          body: JSON.stringify({ number: OPERATOR_PHONE, text }),
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
        to: OPERATOR_EMAIL,
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
