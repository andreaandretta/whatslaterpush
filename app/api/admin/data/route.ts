import { NextRequest, NextResponse } from 'next/server';
import { runAllChecks } from '../../../lib/monitoring';
import { requireAdmin } from '../../../lib/admin-auth';
import { getSupabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';
// GET/RPC deterministico su supabase-js: la Next Data Cache lo congelerebbe
// (bug storico stress-index/reset-quote). force-no-store la disattiva. (Task 42)
export const fetchCache = 'force-no-store';


// --- Stripe helpers (raw fetch, no SDK) ---

async function stripeFetch(path: string): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.stripe.com${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getStripeData() {
  const empty = { recentPayments: [], activeSubscriptions: 0, failedPayments: [], monthlyRevenue: 0 };
  if (!process.env.STRIPE_SECRET_KEY) return empty;

  try {
    const now = new Date();
    const monthStart = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);

    const [chargesRes, subsRes, monthRes, failedRes] = await Promise.all([
      stripeFetch('/v1/charges?limit=10'),
      stripeFetch('/v1/subscriptions?status=active&limit=100'),
      stripeFetch(`/v1/charges?created[gte]=${monthStart}&limit=100`),
      stripeFetch('/v1/charges?limit=10&paid=false'),
    ]);

    const recentPayments = (chargesRes?.data || []).map((c: any) => ({
      amount: (c.amount || 0) / 100,
      plan: c.metadata?.plan || 'unknown',
      date: new Date((c.created || 0) * 1000).toISOString(),
      status: c.status || 'unknown',
    }));

    const activeSubscriptions = subsRes?.data?.length || 0;

    const monthlyRevenue = (monthRes?.data || [])
      .filter((c: any) => c.paid)
      .reduce((sum: number, c: any) => sum + (c.amount || 0), 0) / 100;

    const failedPayments = (failedRes?.data || []).map((c: any) => ({
      amount: (c.amount || 0) / 100,
      date: new Date((c.created || 0) * 1000).toISOString(),
      error: c.failure_message || c.outcome?.seller_message || 'Pagamento fallito',
    }));

    return { recentPayments, activeSubscriptions, failedPayments, monthlyRevenue };
  } catch {
    return empty;
  }
}

// --- Business data ---

async function getBusinessData() {
  const supabase = getSupabaseAdmin();

  const [totalRes, planRes, expiringRes, churnedRes, recentRes] = await Promise.all([
    supabase.from('user_instances').select('id', { count: 'exact', head: true }),
    supabase.from('user_instances').select('subscription_plan'),
    supabase.from('user_instances')
      .select('phone_number, trial_ends_at')
      .eq('subscription_plan', 'trial')
      .gte('trial_ends_at', new Date().toISOString())
      .lte('trial_ends_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('user_instances')
      .select('phone_number, trial_ends_at')
      .eq('subscription_plan', 'free')
      .not('trial_ends_at', 'is', null)
      .lt('trial_ends_at', new Date().toISOString()),
    supabase.from('user_instances')
      .select('phone_number, subscription_plan, connection_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const totalUsers = totalRes.count || 0;

  const byPlan = { free: 0, trial: 0, personal: 0, professional: 0, business: 0 };
  for (const row of (planRes.data || [])) {
    const p = row.subscription_plan as keyof typeof byPlan;
    if (p in byPlan) byPlan[p]++;
  }

  const mrr = byPlan.personal * 4.99 + byPlan.professional * 9.99 + byPlan.business * 19.99;

  return {
    totalUsers,
    byPlan,
    trialExpiring: expiringRes.data || [],
    trialChurned: churnedRes.data || [],
    mrr: Math.round(mrr * 100) / 100,
    recentUsers: recentRes.data || [],
  };
}

// --- Main handler ---

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;

  const supabase = getSupabaseAdmin();

  const [system, business, stripe, alertsRes, dailyReportRes] = await Promise.all([
    runAllChecks(),
    getBusinessData(),
    getStripeData(),
    supabase.from('monitoring_alerts').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('daily_reports').select('*').order('report_date', { ascending: false }).limit(1),
  ]);

  return NextResponse.json({
    system,
    business,
    stripe,
    alerts: alertsRes.data || [],
    latestReport: dailyReportRes.data?.[0] || null,
  });
}
