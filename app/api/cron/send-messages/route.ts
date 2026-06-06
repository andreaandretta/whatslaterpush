import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeItalianPhone } from '../../../lib/phone';
import { shouldSendMessage, rescheduleTomorrow, rescheduleSoon } from '../../../lib/cron-utils';
import { getPlanLimits } from '../../../lib/plans';
import { canSend, recordSend, markBlocked } from '../../../lib/rate-limit';
import { nextOccurrence } from '../../../lib/recurrence';
import { computeTypingDelay, sendTypingPresence } from '../../../lib/typing-presence';
import { logAuditEvent, hashContactRef } from '../../../lib/audit';

export const dynamic = 'force-dynamic';

async function checkFailures(supabase: ReturnType<typeof createClient>, userPhone: string) {
  const { count } = await supabase.from('scheduled_messages').select('id', { count: 'exact', head: true }).eq('instance_phone', userPhone).eq('status', 'failed').gte('created_at', new Date(Date.now() - 86400000).toISOString());
  if ((count || 0) >= 5) {
    await markBlocked(supabase, 'user:' + userPhone, count + ' failed in 24h');
    // Sentry alert: user has crossed the failure-rate circuit breaker.
    // Tag with hashed phone so the same user dedups across events; raw
    // phone would be redacted by the sentryBeforeSend PII scrubber anyway.
    Sentry.captureMessage('user_blocked_failure_rate', {
      level: 'error',
      tags: { user_hash: await hashContactRef(userPhone) },
      extra: { failed_24h_count: count },
    });
    return true;
  }
  return false;
}

async function sendEvolutionText(instanceName: string, toPhone: string, text: string) {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  const normalizedTo = normalizeItalianPhone(toPhone);
  console.log('CRON: sendText inst=' + instanceName + ' to=' + normalizedTo + ' (raw=' + toPhone + ')');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(evoUrl + '/message/sendText/' + instanceName, {
      method: 'POST',
      headers: { 'apikey': evoKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: normalizedTo, text }),
      signal: controller.signal,
    });
    const body = await res.text();
    console.log('CRON: Evolution status=' + res.status + ' body=' + body.substring(0, 400));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const startTime = Date.now();
  try {
    // Auth: accept CRON_SECRET via `Authorization: Bearer` header OR ?secret= query string
    if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });

    const url = new URL(req.url);
    const queryToken = url.searchParams.get('secret');
    const headerToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const provided = headerToken ?? queryToken;

    if (provided !== process.env.CRON_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Clean up stale awaiting_* records older than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: staleCleanup } = await supabase.from('scheduled_messages')
      .update({ status: 'cancelled' })
      .in('status', ['awaiting_time', 'awaiting_recipient', 'awaiting_confirm'])
      .lt('created_at', oneHourAgo)
      .select('id');
    if (staleCleanup?.length) {
      console.log('CRON: Cleaned up ' + staleCleanup.length + ' stale awaiting records');
    }

    // Clean up expired pending_auth_sessions (TTL 10min + 1h grace)
    const oneHourPastExpiry = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: authCleanup } = await supabase.from('pending_auth_sessions')
      .delete()
      .lt('expires_at', oneHourPastExpiry)
      .select('id');
    if (authCleanup?.length) {
      console.log('CRON: Cleaned up ' + authCleanup.length + ' expired pending_auth_sessions');
    }

    // Daily reset (Europe/Rome): once per calendar day, not every cron tick.
    // The date guard (last_daily_reset_at) is what makes the tier limits real —
    // before this the counter was being zeroed every 60s.
    const romeToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' });
    const { data: resetResult } = await supabase
      .from('user_instances')
      .update({ messages_sent_today: 0, upsell_sent_today: false, last_daily_reset_at: romeToday })
      // NULL-guard: also reset rows whose date was never stamped (defense;
      // claim_daily_quota normally stamps it, backfill cleared existing NULLs).
      .or(`last_daily_reset_at.is.null,last_daily_reset_at.lt.${romeToday}`)
      .gt('messages_sent_today', 0)
      .select('id');
    if (resetResult?.length) {
      console.log('CRON: Reset daily counters for ' + resetResult.length + ' users');
    }

    // Trial → Free downgrade
    const { data: expiredTrials } = await supabase
      .from('user_instances')
      .select('phone_number, instance_name')
      .eq('subscription_plan', 'trial')
      .lt('trial_ends_at', new Date().toISOString());

    for (const trial of (expiredTrials || [])) {
      // CAS: only the first concurrent cron trigger flips trial->free (others
      // see plan already 'free' and get 0 rows back) => exactly one "trial
      // scaduto" WhatsApp instead of up to 3 from the 3 concurrent triggers.
      const { data: downgraded } = await supabase.from('user_instances')
        .update({ subscription_plan: 'free' })
        .eq('phone_number', trial.phone_number)
        .eq('subscription_plan', 'trial')
        .select('phone_number');
      if (!downgraded || downgraded.length === 0) continue;
      try {
        await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + trial.instance_name, {
          method: 'POST',
          headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            number: trial.phone_number,
            text: `⏰ Il tuo trial WhatsLater è scaduto.\n\nHai 3 messaggi gratuiti al giorno. Per 20/giorno, passa a Personal a €4,99/mese:\n${process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app'}/dashboard`
          }),
        });
      } catch (e) {}
      console.log('CRON: Trial expired → free for ' + trial.phone_number);
    }

    // P0 FIX: Single JOIN query - each row carries its own instance_name
    // No per-user loop, no global state, no instance confusion possible.
    //
    // Stale 'processing' rows recovery. Two branches based on whether
    // send_attempted_at was stamped before the lambda died:
    //   - send_attempted_at IS NOT NULL → fetch was in flight when lambda
    //     died, Evolution probably delivered. Mark sent (with diagnostic
    //     error_message) to avoid a duplicate on retry. ICP D coaches
    //     care more about not double-sending than about edge-case loss.
    //   - send_attempted_at IS NULL → never reached the fetch call (jitter
    //     or typing simulation killed the lambda). Safe to retry → pending.
    // Legacy rows from before the migration have NULL → safe-retry branch
    // → equivalent to pre-fix behavior, no regression for in-flight rows.
    const staleCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: indeterminateRows } = await supabase.from('scheduled_messages')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        error_message: 'send_indeterminate: lambda died mid-send, marked sent to avoid duplicate (verify WhatsApp ✓✓ if critical)',
      })
      .eq('status', 'processing')
      .lt('updated_at', staleCutoff)
      .not('send_attempted_at', 'is', null)
      .select('id');
    if (indeterminateRows?.length) {
      console.log('CRON: Recovered ' + indeterminateRows.length + ' indeterminate sends (Evolution probably delivered, marked sent to avoid duplicate)');
    }
    const { data: safeRetryRows } = await supabase.from('scheduled_messages')
      .update({ status: 'pending' })
      .eq('status', 'processing')
      .lt('updated_at', staleCutoff)
      .is('send_attempted_at', null)
      .select('id');
    if (safeRetryRows?.length) {
      console.log('CRON: Safe-retry ' + safeRetryRows.length + ' rows (never reached send call, send_attempted_at IS NULL)');
    }

    const { data: pendingMessages, error: queryErr } = await supabase
      .from('scheduled_messages')
      .select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status, messages_sent_today, upsell_sent_today)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(25);

    if (queryErr) {
      console.error('CRON: Query error:', queryErr.message);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }
    console.log('CRON: ' + (pendingMessages || []).length + ' pending messages found');

    let sent = 0, failed = 0, skipped = 0, rateLimited = 0, trialExpired = 0, disconnected = 0;

    // Track which disconnected instances we've already logged
    const disconnectedInstances = new Set<string>();
    // Track which instances we've already attempted the threshold-crossing
    // user notification for in THIS cron run. Without this, a batch of 5 msg
    // from the same disconnected user all crossing the 12-retry threshold
    // would fire 5 identical sendText (all failing because instance is down).
    const thresholdNotifiedInstances = new Set<string>();

    // Process messages in batches of 5 for speed (P11: avoid Vercel Hobby 10s timeout)
    const TIMEOUT_MS = 8000; // bail out before Vercel's 10s limit
    const messages = pendingMessages || [];
    let timedOut = false;
    for (let i = 0; i < messages.length; i += 5) {
      // Timeout guard: stop processing if we're close to the 10s limit
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.log('CRON: TIMEOUT GUARD — stopping after ' + (Date.now() - startTime) + 'ms, ' + (messages.length - i) + ' messages deferred');
        // Sentry alert: cron run exhausted its time budget and deferred
        // remaining messages. Repeated firings indicate queue pressure or
        // sustained Evolution latency — both are signals to investigate.
        Sentry.captureMessage('cron_timeout_deferred', {
          level: 'warning',
          extra: {
            deferred_count: messages.length - i,
            processed_count: i,
            duration_ms: Date.now() - startTime,
            batch_total: messages.length,
          },
        });
        timedOut = true;
        break;
      }

      const batch = messages.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map(async (msg) => {
        // Use shouldSendMessage from cron-utils (tested by 19 unit tests)
        const decision = shouldSendMessage(msg);

        if (decision === 'no_instance') {
          console.error('CRON: Message ' + msg.id + ' has no linked user_instance. Skipping.');
          return 'skipped' as const;
        }

        const instanceName = msg.user_instances.instance_name;
        const ownerPhone = msg.user_instances.phone_number;

        if (decision === 'disconnected') {
          // Smart-retry staircase: 12 attempts × 5min = ≈1h retry window.
          // After 12 retries we defer to next day AND notify the user (best-
          // effort, the notification itself uses the same disconnected
          // instance and may fail silently — that's accepted).
          const RETRY_THRESHOLD = 12;
          const RETRY_MINUTES = 5;
          const prevCount = (msg as any).disconnect_retry_count ?? 0;
          const newCount = prevCount + 1;
          if (!disconnectedInstances.has(instanceName)) {
            disconnectedInstances.add(instanceName);
            console.log('CRON: Instance ' + instanceName + ' is ' + (msg.user_instances.connection_status || 'unknown') + ', smart-retry count=' + newCount + '/' + RETRY_THRESHOLD);
          }

          let newScheduledAt: string;
          let errorMessage: string;
          if (newCount < RETRY_THRESHOLD) {
            newScheduledAt = rescheduleSoon(msg.scheduled_at, RETRY_MINUTES);
            errorMessage = `Istanza disconnessa, retry ${newCount}/${RETRY_THRESHOLD} fra ${RETRY_MINUTES} min`;
          } else {
            newScheduledAt = rescheduleTomorrow(msg.scheduled_at);
            errorMessage = `Istanza disconnessa per ${RETRY_THRESHOLD}× ${RETRY_MINUTES}min, riprogrammato a domani`;
            // Best-effort user notification with /connect link, deduped at
            // instance level so a batch of 5 cross-threshold msg doesn't
            // fire 5 identical sendText (all likely to fail because the
            // instance is still down). The notification fetch itself uses
            // the same disconnected instance so it may fail silently —
            // that's accepted, the deferred message will surface next time
            // the user opens the dashboard.
            if (!thresholdNotifiedInstances.has(instanceName)) {
              thresholdNotifiedInstances.add(instanceName);
              // Sentry alert: instance has been disconnected for the full
              // smart-retry window (12 × 5min). Deduped via the same Set
              // that gates the user notification so we don't spam Sentry
              // when a batch of 5 cross-threshold messages share an instance.
              Sentry.captureMessage('instance_disconnect_threshold', {
                level: 'error',
                tags: { user_hash: await hashContactRef(ownerPhone) },
                extra: {
                  retry_count: newCount,
                  threshold: RETRY_THRESHOLD,
                  connection_status: msg.user_instances.connection_status || 'unknown',
                },
              });
              try {
                await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                  method: 'POST',
                  headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    number: ownerPhone,
                    text: `⚠️ WhatsApp non risponde da più di 1 ora. Ho posticipato i messaggi a domani. Riconnetti su https://${process.env.NEXT_PUBLIC_APP_URL?.replace(/^https?:\/\//, '') || 'whatslaterpush.vercel.app'}/connect`,
                  }),
                });
              } catch (e) {
                console.warn('CRON: Threshold notification failed for ' + instanceName + ' (instance still down? expected)');
              }
            }
          }

          await supabase.from('scheduled_messages').update({
            scheduled_at: newScheduledAt,
            disconnect_retry_count: newCount,
            error_message: errorMessage,
          }).eq('id', msg.id);
          return 'disconnected' as const;
        }

        if (decision === 'trial_expired') {
          console.log('CRON: Trial expired for ' + ownerPhone);
          await supabase.from('scheduled_messages').update({
            status: 'cancelled',
            error_message: 'Trial scaduto'
          }).eq('id', msg.id);
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: ownerPhone, text: `⏰ Il tuo trial WhatsLater è scaduto. I messaggi programmati sono stati sospesi.\n\nVai su ${process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app'}/dashboard per continuare a usare il servizio.` })
            });
          } catch (e) {}
          return 'trial_expired' as const;
        }

        // decision === 'send' — proceed with tier limits, cool-down, rate limiting

        // Tier daily limit check
        const plan = msg.user_instances.subscription_plan || 'free';
        const planLimits = getPlanLimits(plan);
        const sentToday = msg.user_instances.messages_sent_today || 0;
        if (sentToday >= planLimits.dailyLimit) {
          console.log('CRON: DAILY LIMIT reached for ' + ownerPhone + ' (' + sentToday + '/' + planLimits.dailyLimit + ' plan=' + plan + ')');
          return 'rate_limited' as const;
        }

        // Cool-down: max 3 messages to same recipient in 24h
        const { count: recentToRecipient } = await supabase
          .from('scheduled_messages')
          .select('id', { count: 'exact', head: true })
          .eq('instance_phone', ownerPhone)
          .eq('recipient_number', msg.recipient_number)
          .eq('status', 'sent')
          .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        if ((recentToRecipient || 0) >= 3) {
          console.log('CRON: COOLDOWN — 3 msgs already sent to ' + msg.recipient_number + ' in 24h');
          // Smart-retry: a 30-minute deferral lets the natural recipient
          // gap re-open without punishing the message with a full-day shift.
          // The cool-down query above re-evaluates each cron cycle, so if
          // an older "sent" rolls out of the 24h window the next attempt
          // succeeds without further retries.
          const soonIso = rescheduleSoon(msg.scheduled_at, 30);
          await supabase.from('scheduled_messages').update({
            scheduled_at: soonIso,
            error_message: 'Cool-down: max 3 messaggi allo stesso contatto in 24h. Riprogrammato +30 min.'
          }).eq('id', msg.id);
          return 'rate_limited' as const;
        }

        const isBlocked = await checkFailures(supabase, ownerPhone);
        if (isBlocked) {
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: ownerPhone, text: '\u26a0\ufe0f Messaggi sospesi temporaneamente. Troppi invii falliti.' })
            });
          } catch (e) {}
          return 'skipped' as const;
        }

        const check = await canSend(supabase, ownerPhone, instanceName);
        if (!check.allowed) {
          console.log('CRON: RATE LIMITED:', ownerPhone, check.reason);
          return 'rate_limited' as const;
        }

        // Atomic lock: claim message before sending (prevents double-send on overlapping cron runs)
        const { data: claimed } = await supabase.from('scheduled_messages')
          .update({ status: 'processing' })
          .eq('id', msg.id)
          .eq('status', 'pending')
          .select('id');
        if (!claimed || claimed.length === 0) {
          console.log('CRON: Message ' + msg.id + ' already claimed by another process, skipping');
          return 'skipped' as const;
        }

        // Atomic quota gate (anti-overshoot): increment messages_sent_today only
        // if still strictly under the tier limit. NULL = at/over the limit (or a
        // concurrent send took the last slot) -> release the processing lock back
        // to pending and rate-limit. Refunded in the catch if the send fails.
        const { data: claimedQuota, error: quotaErr } = await supabase
          .rpc('claim_daily_quota', { p_phone: ownerPhone, p_limit: planLimits.dailyLimit });
        if (quotaErr || claimedQuota == null) {
          await supabase.from('scheduled_messages').update({ status: 'pending' }).eq('id', msg.id);
          console.log('CRON: quota exhausted (atomic) for ' + ownerPhone + ' plan=' + plan + (quotaErr ? ' err=' + quotaErr.message : ''));
          return 'rate_limited' as const;
        }
        const newSentToday: number = claimedQuota as number;

        // Anti-ban intra-batch jitter (800-2500ms). Extended from the prior
        // 200-400ms because 5 parallel sends within a few hundred ms looked
        // like a burst pattern to Baileys/WhatsApp. Still within the 8s
        // lambda budget on Vercel Hobby (5 parallel × max 2.5s = 2.5s wall).
        await new Promise(r => setTimeout(r, 800 + Math.random() * 1700));

        // Typing simulation: show "is typing…" indicator on the recipient's
        // device proportional to message length (max 4s). Recipients see a
        // human-shaped activity pattern. Failure of /chat/sendPresence is
        // graceful — we log and still send the real message.
        const typingMs = computeTypingDelay((msg.parsed_message || '').length);
        if (typingMs > 0) {
          await sendTypingPresence({
            evoUrl: process.env.EVOLUTION_API_URL!,
            evoKey: process.env.EVOLUTION_API_KEY!,
            instanceName,
            recipientJid: msg.recipient_number,
            typingMs,
          });
          await new Promise(r => setTimeout(r, typingMs));
        }

        // If media is attached, sign the storage path and route through
        // Evolution's /message/sendMedia endpoint instead of /sendText.
        // The signed URL is valid 1h — well above the cron's 8s budget,
        // so Evolution can fetch it during the send call.
        let signedMediaUrl: string | null = null;
        if (msg.media_url && msg.media_type) {
          const { data: signed } = await supabase.storage
            .from('message-media')
            .createSignedUrl(msg.media_url, 3600);
          signedMediaUrl = signed?.signedUrl || null;
          if (!signedMediaUrl) {
            throw new Error('Failed to sign media URL for ' + msg.media_url);
          }
        }

        const sendKind = signedMediaUrl ? 'media' : 'text';
        console.log('CRON: Sending msg ' + msg.id + ' kind=' + sendKind + ' via instance=' + instanceName + ' to=' + msg.recipient_number);

        // Stamp send_attempted_at BEFORE the HTTP call. The stale-processing
        // cleanup at the top of this handler uses this column to decide
        // whether a 'processing' row stuck >2min should be retried (NULL =
        // never reached fetch, safe) or marked sent (NOT NULL = fetch was
        // in flight, Evolution probably delivered, retry would duplicate).
        // Best-effort: if this UPDATE itself fails, we proceed with the
        // fetch anyway — the worst case becomes the original race (potential
        // duplicate) rather than skipping a legitimate send.
        await supabase.from('scheduled_messages')
          .update({ send_attempted_at: new Date().toISOString() })
          .eq('id', msg.id);

        const sendCtrl = new AbortController();
        const sendTimeout = setTimeout(() => sendCtrl.abort(), 8000);
        let res;
        try {
          if (signedMediaUrl) {
            res = await fetch(
              process.env.EVOLUTION_API_URL + '/message/sendMedia/' + instanceName,
              {
                method: 'POST',
                headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  number: msg.recipient_number,
                  mediatype: msg.media_type,
                  media: signedMediaUrl,
                  caption: msg.media_caption || msg.parsed_message || undefined,
                  fileName: msg.media_filename || undefined,
                }),
                signal: sendCtrl.signal,
              }
            );
          } else {
            res = await fetch(
              process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName,
              {
                method: 'POST',
                headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: msg.recipient_number, text: msg.parsed_message }),
                signal: sendCtrl.signal,
              }
            );
          }
        } finally {
          clearTimeout(sendTimeout);
        }
        if (!res.ok) {
          const errText = await res.text();
          throw new Error('HTTP ' + res.status + ': ' + errText);
        }
        // Extract Evolution's message id (key.id) so the webhook can later
        // attach delivery/read receipts to this row. Best-effort: if the
        // response shape changes or JSON parse fails, the send still
        // succeeds — we just lose receipt tracking for this one message.
        let evolutionMessageId: string | null = null;
        try {
          const respText = await res.text();
          const respJson = JSON.parse(respText);
          evolutionMessageId = respJson?.key?.id || null;
        } catch {}

        await recordSend(supabase, ownerPhone, instanceName);
        await supabase.from('scheduled_messages')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            user_notified: true,
            evolution_message_id: evolutionMessageId,
            // Reset the smart-retry counter on successful send so future
            // disconnects on the same row (if it ever re-enters pending,
            // e.g. via recurrence) start from 0.
            disconnect_retry_count: 0,
          })
          .eq('id', msg.id);

        const driftMs = Date.now() - new Date(msg.scheduled_at).getTime();
        await logAuditEvent({
          userPhone: ownerPhone,
          eventType: 'message_sent',
          payload: {
            message_id: msg.id,
            drift_ms: driftMs,
            batch_size: batch.length,
            recipient_hash: await hashContactRef(msg.recipient_number),
            has_recurrence: !!msg.recurrence_rule,
          },
        });

        // Recurrence: if this row was part of a recurring schedule, compute
        // the next occurrence and insert a new pending row. parent_recurrence_id
        // propagates through the chain (first row's id is the group id).
        if (msg.recurrence_rule) {
          const next = nextOccurrence(msg.recurrence_rule, new Date(msg.scheduled_at));
          if (next) {
            const parentId = msg.parent_recurrence_id || msg.id;
            await supabase.from('scheduled_messages').insert({
              user_instance_id: msg.user_instance_id,
              instance_phone: ownerPhone,
              recipient_number: msg.recipient_number,
              recipient_name: msg.recipient_name,
              caption: msg.caption,
              parsed_message: msg.parsed_message,
              scheduled_at: next.toISOString(),
              status: 'pending',
              retry_count: 0,
              max_retries: 3,
              wa_message_id: null,
              // Recurring media messages re-use the same storage path —
              // no re-upload needed each cycle. The cron re-signs the URL
              // at send time, so as long as the file exists in the bucket
              // it'll be reachable.
              media_type: msg.media_type || null,
              media_url: msg.media_url || null,
              media_filename: msg.media_filename || null,
              media_caption: msg.media_caption || null,
              recurrence_rule: msg.recurrence_rule,
              parent_recurrence_id: parentId,
            });
          }
        }

        // Daily counter was already incremented atomically at the pre-send
        // quota claim (claim_daily_quota); newSentToday captured there.

        // Upsell at 80% of daily limit (once per day)
        const upsellThreshold = Math.floor(planLimits.dailyLimit * 0.8);
        if (newSentToday === upsellThreshold && !(msg.user_instances.upsell_sent_today) && plan !== 'business') {
          const nextPlan = (plan === 'free' || plan === 'trial') ? 'Personal' : 'Business';
          const nextLimit = (plan === 'free' || plan === 'trial') ? 20 : 50;
          const nextPrice = (plan === 'free' || plan === 'trial') ? '€4,99' : '€19,99';
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                number: ownerPhone,
                text: `📊 Hai usato ${newSentToday} dei tuoi ${planLimits.dailyLimit} messaggi oggi.\n\nPassa a ${nextPlan} per ${nextLimit}/giorno a ${nextPrice}/mese:\n${process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app'}/dashboard`
              }),
            });
            await supabase.from('user_instances')
              .update({ upsell_sent_today: true })
              .eq('phone_number', ownerPhone);
          } catch (e) {}
        }

        try {
          await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
            method: 'POST',
            headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: ownerPhone, text: '\u2705 Inviato a ' + (msg.recipient_name || msg.recipient_number) + '!' })
          });
        } catch (notifyErr) {}
        return 'sent' as const;
      }));

      // Count results from this batch
      for (let j = 0; j < results.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled') {
          if (r.value === 'sent') sent++;
          else if (r.value === 'skipped') skipped++;
          else if (r.value === 'rate_limited') rateLimited++;
          else if (r.value === 'trial_expired') trialExpired++;
          else if (r.value === 'disconnected') disconnected++;
        } else {
          // Promise rejected = send error, handle retry
          const msg = batch[j];
          const userInst = msg.user_instances;
          const instanceName = userInst?.instance_name;
          const ownerPhone = userInst?.phone_number;
          const err = r.reason;
          // Refund the quota slot claimed pre-send: this attempt failed. On a
          // retry the next attempt re-claims; if terminal nothing was delivered.
          // Either way this attempt must not consume the user's daily quota.
          if (ownerPhone) {
            await supabase.rpc('refund_daily_quota', { p_phone: ownerPhone });
          }
          const newRetry = (msg.retry_count || 0) + 1;
          await supabase.from('scheduled_messages').update({
            status: newRetry >= 3 ? 'failed' : 'pending',
            retry_count: newRetry,
            error_message: err?.message || 'Unknown error',
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
            await logAuditEvent({
              userPhone: ownerPhone,
              eventType: 'message_failed',
              payload: {
                message_id: msg.id,
                error_code: (err as Error)?.message?.substring(0, 200) || 'unknown',
                attempt: newRetry,
                recipient_hash: await hashContactRef(msg.recipient_number),
              },
            });
          }
        }
      }
    }

    

    const dur = Date.now() - startTime;
    console.log('CRON DONE sent=' + sent + ' failed=' + failed + ' skip=' + skipped + ' rl=' + rateLimited + ' trial_exp=' + trialExpired + ' disconn=' + disconnected + ' timedOut=' + timedOut + ' ms=' + dur);
    return NextResponse.json({ sent, failed, skipped, rateLimited, trialExpired, disconnected, timedOut, duration: dur + 'ms', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('CRON ERROR:', (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
