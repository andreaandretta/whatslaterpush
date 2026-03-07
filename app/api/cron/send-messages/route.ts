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

    const { data: users, error: usersErr } = await supabase.from('user_instances').select('id, phone_number, instance_name, trial_ends_at, subscription_status');
    if (usersErr) { console.error('CRON: users error:', usersErr.message); return NextResponse.json({ error: usersErr.message }, { status: 500 }); }
    console.log('CRON: ' + (users || []).length + ' users to process');

    let sent = 0, failed = 0, skipped = 0, rateLimited = 0;
    const processedInstances = new Set();

    for (const user of users || []) {
      if (processedInstances.has(user.instance_name)) { console.log('CRON: skip dup:', user.instance_name); continue; }
      processedInstances.add(user.instance_name);
      const instanceName = user.instance_name || 'SchedWhats-Primary';
      const ownerPhone = user.phone_number;

      if (await checkFailures(supabase, ownerPhone)) {
        try { await sendEvolutionText(instanceName, ownerPhone, 'Messaggi sospesi. Troppi fallimenti. Riprova domani.'); } catch (e) {}
        skipped++; continue;
      }

      const { data: messages, error: msgErr } = await supabase.from('scheduled_messages').select('*').eq('user_instance_id', user.id).eq('status', 'pending').lte('scheduled_at', new Date().toISOString()).order('scheduled_at', { ascending: true }).limit(10);
      if (msgErr) { console.error('CRON: msg error for ' + ownerPhone + ':', msgErr.message); continue; }
      console.log('CRON: ' + (messages || []).length + ' pending for ' + ownerPhone + ' inst=' + instanceName);

      for (const msg of messages || []) {
        const check = canSend(ownerPhone, instanceName);
        if (!check.allowed) { console.log('CRON: rate limit ' + ownerPhone + ': ' + check.reason); rateLimited++; continue; }
        try {
          await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
          console.log('CRON: send id=' + msg.id + ' to=' + msg.recipient_number + ' norm=' + normalizePhoneForEvolution(msg.recipient_number));
          const res = await sendEvolutionText(instanceName, msg.recipient_number, msg.parsed_message);
          if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + res.body.substring(0, 200));
          let rd = {}; try { rd = JSON.parse(res.body); } catch (e) {}
          console.log('CRON: sent OK id=' + msg.id + ' evo_key=' + JSON.stringify(rd?.key));
          recordSend(ownerPhone, instanceName);
          await supabase.from('scheduled_messages').update({ status: 'sent', sent_at: new Date().toISOString(), user_notified: true }).eq('id', msg.id);
          try { await sendEvolutionText(instanceName, ownerPhone, 'Inviato a ' + (msg.recipient_name || msg.recipient_number) + '!\n"' + (msg.parsed_message || '').substring(0, 80) + '"'); } catch (e) {}
          sent++;
        } catch (err) {
          console.error('CRON: FAILED id=' + msg.id + ':', err.message);
          const nr = (msg.retry_count || 0) + 1;
          await supabase.from('scheduled_messages').update({ status: nr >= 3 ? 'failed' : 'pending', retry_count: nr, error_message: err.message, scheduled_at: nr < 3 ? new Date(Date.now() + nr * 5 * 60 * 1000).toISOString() : msg.scheduled_at }).eq('id', msg.id);
          if (nr >= 3) { try { await sendEvolutionText(instanceName, ownerPhone, 'Impossibile inviare a ' + (msg.recipient_name || msg.recipient_number) + ' dopo 3 tentativi.\nErrore: ' + err.message.substring(0, 150)); } catch (e) {} failed++; }
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