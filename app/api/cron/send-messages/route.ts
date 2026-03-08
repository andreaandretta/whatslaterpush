// @ts-nocheck
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function normalizePhoneForEvolution(phone) {
  let n = (phone || '').replace(/\D/g, '');
  if (n.startsWith('3') && !n.startsWith('39') && n.length === 10) n = '39' + n;
  if (n.startsWith('0')) n = '39' + n.substring(1);
  return n;
}

const rateLimits = new Map();
const LIMITS = { PER_USER_PER_MINUTE: 15, PER_USER_PER_DAY: 100, PER_INSTANCE_PER_MINUTE: 18, SPAM_THRESHOLD: 50 };

function getRateState(key) {
  const now = Date.now();
  let state = rateLimits.get(key);
  if (!state) { state = { minuteCount: 0, minuteReset: now + 60000, dailyCount: 0, dailyReset: now + 86400000, blocked: false }; rateLimits.set(key, state); return state; }
  if (now >= state.minuteReset) { state.minuteCount = 0; state.minuteReset = now + 60000; }
  if (now >= state.dailyReset) { state.dailyCount = 0; state.dailyReset = now + 86400000; state.blocked = false; state.blockReason = undefined; }
  return state;
}

function canSend(userPhone, instanceName) {
  const u = getRateState('user:' + userPhone), i = getRateState('inst:' + instanceName);
  if (u.blocked) return { allowed: false, reason: 'Blocked: ' + u.blockReason };
  if (u.dailyCount >= LIMITS.PER_USER_PER_DAY) return { allowed: false, reason: 'Daily limit' };
  if (u.minuteCount >= LIMITS.PER_USER_PER_MINUTE) return { allowed: false, reason: 'Minute limit' };
  if (i.minuteCount >= LIMITS.PER_INSTANCE_PER_MINUTE) return { allowed: false, reason: 'Instance limit' };
  return { allowed: true };
}

function recordSend(userPhone, instanceName) {
  const u = getRateState('user:' + userPhone), i = getRateState('inst:' + instanceName);
  u.minuteCount++; u.dailyCount++; i.minuteCount++;
  if (u.dailyCount >= LIMITS.SPAM_THRESHOLD) { u.blocked = true; u.blockReason = u.dailyCount + '/day'; }
}

async function checkFailures(supabase, userPhone) {
  const { count } = await supabase.from('scheduled_messages').select('id', { count: 'exact', head: true }).eq('instance_phone', userPhone).eq('status', 'failed').gte('created_at', new Date(Date.now() - 86400000).toISOString());
  if ((count || 0) >= 5) { const s = getRateState('user:' + userPhone); s.blocked = true; s.blockReason = count + ' failed in 24h'; return true; }
  return false;
}

async function sendEvolutionText(instanceName, toPhone, text) {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const normalizedTo = normalizePhoneForEvolution(toPhone);
  console.log('CRON: sendText inst=' + instanceName + ' to=' + normalizedTo + ' (raw=' + toPhone + ')');
  const res = await fetch(evoUrl + '/message/sendText/' + instanceName, {
    method: 'POST',
    headers: { 'apikey': evoKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: normalizedTo, text }),
  });
  const body = await res.text();
  console.log('CRON: Evolution status=' + res.status + ' body=' + body.substring(0, 400));
  return { ok: res.ok, status: res.status, body };
}

export async function GET(req) {
  const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const startTime = Date.now();
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get('secret');
    if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // P0 FIX: Single JOIN query - each row carries its own instance_name
    // No per-user loop, no global state, no instance confusion possible
    const { data: pendingMessages, error: queryErr } = await supabase
      .from('scheduled_messages')
      .select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_status)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(50);

    if (queryErr) {
      console.error('CRON: Query error:', queryErr.message);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }
    console.log('CRON: ' + (pendingMessages || []).length + ' pending messages found');

    let sent = 0, failed = 0, skipped = 0, rateLimited = 0;

    for (const msg of pendingMessages || []) {
      const userInst = msg.user_instances;
      if (!userInst || !userInst.instance_name) {
        console.error('CRON: Message ' + msg.id + ' has no linked user_instance. Skipping.');
        skipped++;
        continue;
      }

      const instanceName = userInst.instance_name;
      const ownerPhone = userInst.phone_number;

      const isBlocked = await checkFailures(supabase, ownerPhone);
      if (isBlocked) {
        try {
          await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
            method: 'POST',
            headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: ownerPhone, text: '\u26a0\ufe0f Messaggi sospesi temporaneamente. Troppi invii falliti.' })
          });
        } catch (e) {}
        skipped++;
        continue;
      }

      const check = canSend(ownerPhone, instanceName);
      if (!check.allowed) {
        console.log('CRON: RATE LIMITED:', ownerPhone, check.reason);
        rateLimited++;
        continue;
      }

      try {
        const jitter = 2000 + Math.random() * 2000;
        await new Promise(r => setTimeout(r, jitter));
        console.log('CRON: Sending msg ' + msg.id + ' via instance=' + instanceName + ' to=' + msg.recipient_number);
        const res = await fetch(
          process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName,
          {
            method: 'POST',
            headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: msg.recipient_number, text: msg.parsed_message })
          }
        );
        if (!res.ok) {
          const errText = await res.text();
          throw new Error('HTTP ' + res.status + ': ' + errText);
        }
        recordSend(ownerPhone, instanceName);
        await supabase.from('scheduled_messages')
          .update({ status: 'sent', sent_at: new Date().toISOString(), user_notified: true })
          .eq('id', msg.id);
        try {
          await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
            method: 'POST',
            headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: ownerPhone, text: '\u2705 Inviato a ' + (msg.recipient_name || msg.recipient_number) + '!' })
          });
        } catch (notifyErr) {}
        sent++;
      } catch (err: any) {
        const newRetry = (msg.retry_count || 0) + 1;
        await supabase.from('scheduled_messages').update({
          status: newRetry >= 3 ? 'failed' : 'pending',
          retry_count: newRetry,
          error_message: err.message,
          scheduled_at: newRetry < 3 ? new Date(Date.now() + (newRetry * 5 * 60 * 1000)).toISOString() : msg.scheduled_at
        }).eq('id', msg.id);
        if (newRetry >= 3) {
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: ownerPhone, text: '\u274c Impossibile inviare a ' + (msg.recipient_name || msg.recipient_number) + ' dopo 3 tentativi.' })
            });
          } catch (e) {}
          failed++;
        }
      }
    }

    

    const dur = Date.now() - startTime;
    console.log('CRON DONE sent=' + sent + ' failed=' + failed + ' skip=' + skipped + ' rl=' + rateLimited + ' ms=' + dur);
    return NextResponse.json({ sent, failed, skipped, rateLimited, duration: dur + 'ms', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('CRON ERROR:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
