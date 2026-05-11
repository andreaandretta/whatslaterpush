import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlanLimits } from '../../lib/plans';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';

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

export async function POST(req: NextRequest) {
  const phone = await getAuthedPhone(req);
  if (!phone) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { recipient_number: rawNumber, recipient_name, message, scheduled_at } = body || {};

  if (typeof rawNumber !== 'string' || rawNumber.includes('@g.us') || rawNumber.includes('@broadcast')) {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  }

  const normalized = validatePhone(rawNumber);
  if (!normalized) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  if (normalized === phone) {
    return NextResponse.json({ error: 'self_target' }, { status: 400 });
  }

  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 3500) {
    return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
  }

  if (typeof scheduled_at !== 'string') {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }
  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 60_000) {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: user } = await supabase
    .from('user_instances')
    .select('id, subscription_plan')
    .eq('phone_number', phone)
    .single();

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const plan = user.subscription_plan || 'free';
  const limits = getPlanLimits(plan);

  const { data: pendingContacts } = await supabase
    .from('pending_contacts')
    .select('recipient_number')
    .eq('owner_phone', phone);

  const { data: scheduledContacts } = await supabase
    .from('scheduled_messages')
    .select('recipient_number')
    .eq('instance_phone', phone)
    .neq('status', 'cancelled');

  const knownSet = new Set<string>();
  for (const row of pendingContacts || []) if (row.recipient_number) knownSet.add(row.recipient_number);
  for (const row of scheduledContacts || []) if (row.recipient_number) knownSet.add(row.recipient_number);

  if (!knownSet.has(normalized) && knownSet.size >= limits.maxContacts) {
    return NextResponse.json({
      error: 'plan_contacts_limit_exceeded',
      plan,
      limit: limits.maxContacts,
    }, { status: 403 });
  }

  const cleanMessage = message.trim();
  const cleanName = typeof recipient_name === 'string' && recipient_name.trim().length > 0
    ? recipient_name.trim().slice(0, 100)
    : null;

  const { data: inserted, error: insErr } = await supabase
    .from('scheduled_messages')
    .insert({
      user_instance_id: user.id,
      instance_phone: phone,
      recipient_number: normalized,
      recipient_name: cleanName,
      caption: cleanMessage,
      parsed_message: cleanMessage,
      scheduled_at: scheduledDate.toISOString(),
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      wa_message_id: null,
    })
    .select('id, scheduled_at')
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    id: inserted.id,
    scheduled_at: inserted.scheduled_at,
    status: 'pending',
  });
}
