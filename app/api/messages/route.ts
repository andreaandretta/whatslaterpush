import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPlanLimits } from '../../lib/plans';
import { verifyCookie, AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { validatePhone } from '../../lib/phone';
import { applyJitter } from '../../lib/cron-utils';
import { isValidRule } from '../../lib/recurrence';
import { logAuditEvent, clientIpFromHeaders, hashContactRef } from '../../lib/audit';

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

  // Attach cached profile photos from whatsapp_contacts so the dashboard
  // avatars can render WhatsApp pictures without a second client round-trip.
  const recipientNumbers = Array.from(
    new Set(
      ((data || []) as Array<{ recipient_number: string | null }>)
        .map((m) => m.recipient_number)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    )
  );

  const photoByNumber = new Map<string, string>();
  if (recipientNumbers.length > 0) {
    const { data: contacts } = await supabase
      .from('whatsapp_contacts')
      .select('contact_number, profile_pic_url')
      .eq('user_phone', phone)
      .in('contact_number', recipientNumbers);
    for (const c of (contacts || []) as Array<{ contact_number: string; profile_pic_url: string | null }>) {
      const url = c.profile_pic_url?.trim();
      if (url) photoByNumber.set(c.contact_number, url);
    }
  }

  const messages = ((data || []) as Array<Record<string, any>>).map((m) => ({
    ...m,
    photo_url: m.recipient_number ? photoByNumber.get(m.recipient_number) || null : null,
  }));

  const { count: lifetimeCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('instance_phone', phone);

  return NextResponse.json({
    messages,
    subscription_plan: user?.subscription_plan || 'unknown',
    trial_ends_at: user?.trial_ends_at || null,
    total_scheduled_lifetime: lifetimeCount ?? 0,
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
  const {
    recipient_number: rawNumber,
    recipient_name,
    message,
    scheduled_at,
    recurrence_rule,
    media_type,
    media_url,
    media_filename,
    media_caption,
  } = body || {};

  if (typeof rawNumber !== 'string' || rawNumber.includes('@g.us') || rawNumber.includes('@broadcast')) {
    return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  }

  const normalized = validatePhone(rawNumber);
  if (!normalized) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });

  if (normalized === phone) {
    return NextResponse.json({ error: 'self_target' }, { status: 400 });
  }

  // When media is attached, the message body becomes optional (used as
  // caption). Without media, the body is mandatory like before.
  const hasMedia = typeof media_type === 'string' && typeof media_url === 'string' && media_url.length > 0;
  const messageStr = typeof message === 'string' ? message : '';
  if (!hasMedia) {
    if (messageStr.trim().length === 0 || messageStr.length > 3500) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
  } else {
    // With media: allow empty body, just cap length.
    if (messageStr.length > 3500) {
      return NextResponse.json({ error: 'invalid_message' }, { status: 400 });
    }
    const ALLOWED_MEDIA = ['image', 'video', 'document', 'audio', 'sticker', 'location', 'contact'];
    if (!ALLOWED_MEDIA.includes(media_type)) {
      return NextResponse.json({ error: 'invalid_media_type' }, { status: 400 });
    }
  }

  if (typeof scheduled_at !== 'string') {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }
  const scheduledDate = new Date(scheduled_at);
  if (isNaN(scheduledDate.getTime()) || scheduledDate.getTime() < Date.now() + 60_000) {
    return NextResponse.json({ error: 'invalid_datetime' }, { status: 400 });
  }

  // recurrence_rule is optional. If present, must be a valid RRULE subset
  // (see app/lib/recurrence.ts). Null/undefined/empty means one-shot send.
  let normalizedRule: string | null = null;
  if (recurrence_rule != null && recurrence_rule !== '') {
    if (typeof recurrence_rule !== 'string' || !isValidRule(recurrence_rule)) {
      return NextResponse.json({ error: 'invalid_recurrence_rule' }, { status: 400 });
    }
    normalizedRule = recurrence_rule;
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

  // MAX_PENDING quota — prevents an authenticated client (or compromised
  // session) from filling the queue faster than the cron can drain it. Cap is
  // dailyLimit × 7 so users keep a full week of buffer even under heavy use;
  // abusive flows trip 429 long before they materially grow the table.
  const { count: pendingCount } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('instance_phone', phone)
    .eq('status', 'pending');

  const MAX_PENDING = limits.dailyLimit * 7;
  if ((pendingCount || 0) >= MAX_PENDING) {
    return NextResponse.json({
      error: 'queue_full',
      message: 'Hai troppi messaggi in coda. Aspetta che ne venga inviato qualcuno.',
      pending: pendingCount || 0,
      limit: MAX_PENDING,
    }, { status: 429 });
  }

  const cleanMessage = messageStr.trim();
  const cleanName = typeof recipient_name === 'string' && recipient_name.trim().length > 0
    ? recipient_name.trim().slice(0, 100)
    : null;
  const cleanMediaCaption = typeof media_caption === 'string' && media_caption.length > 0
    ? media_caption.slice(0, 3500)
    : null;
  const cleanMediaFilename = typeof media_filename === 'string' && media_filename.length > 0
    ? media_filename.slice(0, 200)
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
      scheduled_at: applyJitter(scheduledDate.toISOString()),
      status: 'pending',
      retry_count: 0,
      max_retries: 3,
      wa_message_id: null,
      recurrence_rule: normalizedRule,
      media_type: hasMedia ? media_type : null,
      media_url: hasMedia ? media_url : null,
      media_filename: cleanMediaFilename,
      media_caption: cleanMediaCaption,
    })
    .select('id, scheduled_at')
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  await logAuditEvent({
    userPhone: phone,
    eventType: 'schedule_created',
    payload: {
      message_id: inserted.id,
      scheduled_at: inserted.scheduled_at,
      has_recurrence: normalizedRule !== null,
      recipient_hash: await hashContactRef(normalized),
      body_length: cleanMessage.length,
    },
    ipAddress: clientIpFromHeaders(req.headers),
  });

  // Best-effort: ensure the manually-typed recipient has a whatsapp_contacts
  // row so the picker can list them next time even before the webhook
  // confirms their existence via CONTACTS_UPSERT. ignoreDuplicates=true maps
  // to ON CONFLICT DO NOTHING, which keeps any pre-existing webhook-ingested
  // row intact (their added_manually stays whatever it already was — usually
  // false). A failure here must not mask the scheduled-message success, so
  // errors are logged and swallowed.
  try {
    const { error: contactErr } = await supabase
      .from('whatsapp_contacts')
      .upsert({
        user_phone: phone,
        contact_number: normalized,
        name: cleanName,
        push_name: null,
        source: 'MANUAL',
        added_manually: true,
      }, { onConflict: 'user_phone,contact_number', ignoreDuplicates: true });
    if (contactErr) console.error('MANUAL_CONTACT_UPSERT_FAILED', contactErr.message);
  } catch (err: any) {
    console.error('MANUAL_CONTACT_UPSERT_FAILED', err?.message || err);
  }

  return NextResponse.json({
    id: inserted.id,
    scheduled_at: inserted.scheduled_at,
    status: 'pending',
  });
}
