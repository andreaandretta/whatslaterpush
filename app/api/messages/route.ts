import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlanLimits } from '../../lib/plans';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';

export const dynamic = 'force-dynamic';

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');
  return createClient(url, key);
}

async function getAuthedPhone(req: NextRequest): Promise<string | null> {
  const raw = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const payload = await verifyCookie(raw);
  return payload?.phone ?? null;
}

export async function GET(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = getSupabase();
  const { data: user } = await supabase
    .from('user_instances')
    .select('id, trial_ends_at, subscription_plan, connection_status')
    .eq('phone_number', phone)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const planLimits = getPlanLimits(user.subscription_plan || 'free');
  const historyStart = new Date(Date.now() - planLimits.historyDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('scheduled_messages')
    .select('*')
    .eq('instance_phone', phone)
    .gte('created_at', historyStart)
    .order('scheduled_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    messages: data || [],
    subscription_plan: user?.subscription_plan || 'unknown',
    trial_ends_at: user?.trial_ends_at || null,
  });
}

export async function DELETE(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: msg } = await supabase
    .from('scheduled_messages')
    .select('id, instance_phone')
    .eq('id', id)
    .eq('instance_phone', phone)
    .single();

  if (!msg) return NextResponse.json({ error: 'Message not found or not owned' }, { status: 403 });

  const { error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('instance_phone', phone);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
