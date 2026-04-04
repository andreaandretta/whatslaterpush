import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchDropletMetrics, fetchDropletHistory24h } from '../../../lib/droplet';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

const OPERATOR_PHONE = '393442582226';

export interface DailyReportData {
  report_date: string;
  ram_peak_percent: number;
  ram_peak_time: string | null;
  cpu_avg_percent: number;
  disk_percent: number;
  messages_sent: number;
  messages_failed: number;
  active_senders: number;
  new_users: number;
  churned_trials: number;
  daily_revenue: number;
  mrr: number;
}

export async function collectDailyReport(): Promise<DailyReportData> {
  const supabase = getSupabase();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayISO = yesterday.toISOString();
  const todayDate = now.toISOString().split('T')[0];

  // --- Infra metrics ---
  const history = await fetchDropletHistory24h();
  let ram_peak_percent = 0;
  let ram_peak_time: string | null = null;
  for (const point of history) {
    if (point.percent > ram_peak_percent) {
      ram_peak_percent = point.percent;
      ram_peak_time = point.time;
    }
  }

  const metrics = await fetchDropletMetrics();
  const cpu_avg_percent = metrics?.cpu_percent ?? 0;
  const disk_percent = metrics?.disk_percent ?? 0;

  // --- Messages ---
  const { count: sentCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gte('updated_at', yesterdayISO);

  const { count: failedCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'failed')
    .gte('updated_at', yesterdayISO);

  // Distinct senders (by instance_phone) who sent messages in the last 24h
  const { data: senderRows } = await supabase
    .from('scheduled_messages')
    .select('instance_phone')
    .eq('status', 'sent')
    .gte('updated_at', yesterdayISO);
  const activeSenders = new Set((senderRows || []).map((r: any) => r.instance_phone).filter(Boolean)).size;

  // --- Users ---
  const { count: newUsersCount } = await supabase
    .from('user_instances')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', yesterdayISO);

  const { count: churnedCount } = await supabase
    .from('user_instances')
    .select('id', { count: 'exact', head: true })
    .eq('subscription_plan', 'free')
    .not('trial_ends_at', 'is', null)
    .lt('trial_ends_at', now.toISOString())
    .gte('trial_ends_at', yesterdayISO);

  // --- Revenue ---
  let daily_revenue = 0;
  let mrr = 0;
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const dayStartUnix = Math.floor(yesterday.getTime() / 1000);
      const res = await fetch(`https://api.stripe.com/v1/charges?created[gte]=${dayStartUnix}&limit=100`, {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        daily_revenue = (data.data || [])
          .filter((c: any) => c.paid)
          .reduce((sum: number, c: any) => sum + (c.amount || 0), 0) / 100;
      }
    } catch { /* ignore */ }

    try {
      const subsRes = await fetch('https://api.stripe.com/v1/subscriptions?status=active&limit=100', {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      if (subsRes.ok) {
        const subs = await subsRes.json();
        mrr = (subs.data || []).reduce((sum: number, s: any) => {
          const amount = s.items?.data?.[0]?.price?.unit_amount || 0;
          return sum + amount / 100;
        }, 0);
      }
    } catch { /* ignore */ }
  }

  // Fallback MRR from DB if Stripe not available
  if (mrr === 0) {
    const { data: plans } = await supabase
      .from('user_instances')
      .select('subscription_plan');
    if (plans) {
      for (const row of plans) {
        if (row.subscription_plan === 'personal') mrr += 4.99;
        if (row.subscription_plan === 'business') mrr += 19.99;
      }
    }
  }

  return {
    report_date: todayDate,
    ram_peak_percent,
    ram_peak_time,
    cpu_avg_percent,
    disk_percent,
    messages_sent: sentCount ?? 0,
    messages_failed: failedCount ?? 0,
    active_senders: activeSenders,
    new_users: newUsersCount ?? 0,
    churned_trials: churnedCount ?? 0,
    daily_revenue: Math.round(daily_revenue * 100) / 100,
    mrr: Math.round(mrr * 100) / 100,
  };
}

export function formatWhatsAppReport(r: DailyReportData): string {
  const peakTime = r.ram_peak_time
    ? new Date(r.ram_peak_time).toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
    : '—';
  const total = r.messages_sent + r.messages_failed;
  const successRate = total > 0 ? ((r.messages_sent / total) * 100).toFixed(1) : '100.0';
  const dateStr = new Date(r.report_date).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });

  return [
    `\u{1F4CA} WhatsLater Report \u2014 ${dateStr}`,
    '\u2501'.repeat(21),
    '\u{1F5A5} INFRASTRUTTURA',
    `  RAM picco: ${r.ram_peak_percent}% (${peakTime})`,
    `  CPU media: ${r.cpu_avg_percent}%`,
    `  Disco: ${r.disk_percent}%`,
    '',
    '\u{1F4E8} MESSAGGI (24h)',
    `  Inviati: ${r.messages_sent} da ${r.active_senders} utenti`,
    `  Falliti: ${r.messages_failed} (tasso: ${successRate}%)`,
    '',
    '\u{1F465} UTENTI',
    `  Nuovi: ${r.new_users}`,
    `  Trial scaduti: ${r.churned_trials}`,
    '',
    '\u{1F4B0} REVENUE',
    `  Oggi: \u20AC${r.daily_revenue.toFixed(2)}`,
    `  MRR: \u20AC${r.mrr.toFixed(2)}`,
    '\u2501'.repeat(21),
  ].join('\n');
}

async function sendReportWhatsApp(text: string): Promise<boolean> {
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('user_instances')
      .select('instance_name')
      .eq('connection_status', 'open')
      .neq('phone_number', OPERATOR_PHONE)
      .limit(1);
    let instanceName = data?.[0]?.instance_name;
    if (!instanceName) {
      const { data: fallback } = await supabase
        .from('user_instances')
        .select('instance_name')
        .eq('phone_number', OPERATOR_PHONE)
        .limit(1);
      instanceName = fallback?.[0]?.instance_name;
      if (!instanceName) return false;
    }
    const res = await fetch(
      `${process.env.EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        method: 'POST',
        headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: OPERATOR_PHONE, text }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const report = await collectDailyReport();
    const supabase = getSupabase();

    // Store in DB
    await supabase.from('daily_reports').upsert(report, { onConflict: 'report_date' });

    // Send WhatsApp
    const text = formatWhatsAppReport(report);
    await sendReportWhatsApp(text);

    return NextResponse.json({ status: 'ok', report });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Report failed' }, { status: 500 });
  }
}
