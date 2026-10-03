import * as Sentry from '@sentry/nextjs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { shouldSendMessage, shouldSendUpsell, rescheduleTomorrow, rescheduleSoon, applyJitter, buildQuotaRequeueUpdate, buildFailureRequeueUpdate, claimSendAttempt, isNotOnWhatsAppError, countBreakerFailures, BREAKER_THRESHOLD, sendTimeoutMs, cooldownReleaseAt, COOLDOWN_MAX_PER_RECIPIENT, disconnectRetryStep, DISCONNECT_RETRY_THRESHOLD, isLateDisconnectBacklog, planBacklogSpread, MEDIA_EXPIRED_ERROR, classifyGroupSendFailure } from '../../../lib/cron-utils';
import { isBillingEnabled, getEffectivePlan } from '../../../lib/billing';
import { getPlanLimits } from '../../../lib/plans';
import { canSend, recordSend, markBlocked } from '../../../lib/rate-limit';
import { reconcileRecurringChain } from '../../../lib/recurrence';
import { nextRomeMorning, newRecipientsPerDay, romeDayStart, applyCourtesyWindow, isWithinCourtesyWindow } from '../../../lib/anti-ban';
import { dailyLimitNow, BIG_GROUP_WARMUP_SIZE } from '../../../lib/daily-limit';
import { isKnownRecipient, countNewRecipientsSentToday } from '../../../lib/first-contact';
import { getSuppression, suppressionsEnabled, suppressionReasonText } from '../../../lib/suppressions';
import { computeTypingDelay, sendTypingPresence } from '../../../lib/typing-presence';
import { applyTemplateVariables } from '../../../lib/template-variables';
import { logAuditEvent, hashContactRef } from '../../../lib/audit';
import { mapErrorReason } from '../../../lib/message-error';
import { fetchEvolutionState, type LiveConnectionStatus } from '../../../lib/connection-state';
import { isGroupJid, recipientDisplayName } from '../../../lib/jid';
import { groupsEnabled, lookupGroup, logRecipient, type GroupLookup } from '../../../lib/groups';
import { truncateAtGrapheme } from '../../../lib/text';

export const dynamic = 'force-dynamic';
// Niente Next Data Cache su NESSUNA fetch di questo cron: il POST costante
// dell'RPC reset_daily_counters veniva congelato dopo la prima esecuzione
// (stesso bug documentato in stress-index e in lib/droplet) → il reset girava
// una volta per deployment e mai più. force-dynamic NON basta: copre la Full
// Route Cache, non la Data Cache delle fetch.
export const fetchCache = 'force-no-store';
// Un allegato fino a 16 MB può chiedere fino a 40 s a Evolution (scarica da
// Supabase, cifra, carica sui server media di WhatsApp, inoltra: vedi
// sendTimeoutMs). Senza maxDuration la lambda poteva morire prima del timeout
// e la riga finiva 'send_indeterminate' senza prova. 60 s = 40 s d'invio +
// jitter + margine; la guardia TIMEOUT_MS sotto resta sugli 8 s per NON
// iniziare nuovi batch tardi.
export const maxDuration = 60;

let resetStampWarned = false;

// ── Gruppi WhatsApp: motivi scritti dal cron (iniziano con "In pausa",
// "Gruppo con più di" o "Controllo del gruppo": mapPendingReason li riconosce) ──
const GROUPS_OFF_TEXT = 'In pausa: gli invii nei gruppi sono sospesi per ora. Tocca Riprendi più tardi.';
const GROUP_FROM_SELF_CHAT_TEXT = 'In pausa: i messaggi nei gruppi si programmano solo dall\'app.';
const BIG_GROUP_WARMUP_TEXT = 'Gruppo con più di 50 persone: nei primi giorni dal collegamento si aspetta — riprogrammato a domattina';
const GROUP_CHECK_RETRY_TEXT = 'Controllo del gruppo non riuscito (WhatsApp non ha risposto): si riprova più tardi, per proteggere il tuo WhatsApp';
const groupNotMemberText = (name: string) => 'In pausa: non risulti più nel gruppo «' + name + '» (o il gruppo non esiste più). Se ci rientri, tocca Riprendi.';
const groupAdminsOnlyText = (name: string) => 'In pausa: nel gruppo «' + name + '» ora scrivono solo gli amministratori.';
const groupCommunityText = (name: string) => 'In pausa: «' + name + '» è una community, non un gruppo in cui scrivere. Scegli uno dei suoi gruppi.';
const groupUndeliverableText = (name: string) => 'In pausa: WhatsApp non è riuscito a mandare il messaggio nel gruppo «' + name + '» (succede quando il telefono di uno dei membri ha un problema). Tocca Riprendi più tardi.';

async function checkFailures(supabase: ReturnType<typeof createClient>, userPhone: string) {
  // Audit 25 set 2026: prima contava OGNI riga 'failed' CREATA nelle ultime
  // 24h. Cinque numeri inesistenti (exists:false) bloccavano tutti i promemoria
  // dell'utente, anche ai clienti validi, e la mattina dopo le stesse righe
  // erano ancora "nelle 24h" della creazione. Ora: finestra sul momento del
  // FALLIMENTO (updated_at), errori permanenti del destinatario esclusi,
  // conteggio per destinatario distinto (vedi countBreakerFailures).
  // updated_at da solo però lo cambia anche chi fa manutenzione: la pulizia
  // allegati della domenica tocca righe fallite un mese fa e il trigger le
  // rendeva "fallite nelle 24h" → invii sospesi ogni domenica. Anche
  // scheduled_at deve stare nelle 24h: su una riga 'failed' è l'orario del
  // tentativo finale (buildFailureRequeueUpdate), quindi mai dopo il
  // fallimento, e la manutenzione non lo tocca.
  const since = new Date(Date.now() - 86400000).toISOString();
  const { data: failedRows } = await supabase.from('scheduled_messages')
    .select('recipient_number, error_message')
    .eq('instance_phone', userPhone)
    .eq('status', 'failed')
    .gte('updated_at', since)
    .gte('scheduled_at', since)
    .limit(200);
  const count = countBreakerFailures((failedRows || []) as Array<{ recipient_number: string | null; error_message: string | null }>);
  if (count >= BREAKER_THRESHOLD) {
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

    // Cron heartbeat: stamp every tick so /api/ops/stress-index detects a
    // stalled send-cron (>3min) before the queue visibly backs up.
    try {
      await supabase.from('ops_heartbeat').upsert({ name: 'send-messages', ts: new Date().toISOString() }, { onConflict: 'name' });
    } catch (e) {}

    // Daily reset (Europe/Rome): once per calendar day, not every cron tick.
    // The date guard (last_daily_reset_at) is what makes the tier limits real.
    // BUG STORICO (scoperto 2026-07-07): la versione via PATCH REST falliva con
    // 400 ad OGNI tick dal giorno del deploy e l'errore veniva scartato in
    // silenzio → i contatori non si azzeravano MAI e il cap giornaliero era di
    // fatto A VITA (ogni Free si fermava dopo 3 messaggi totali, "in coda per
    // sempre"). Ora: RPC SQL (migration 20260707_reset_daily_counters_rpc,
    // stesso pattern di claim_daily_quota che non ha mai fallito — le colonne
    // le risolve Postgres nel corpo, fuori dallo strato REST) e l'errore è
    // FAIL-LOUD: log + Sentry, mai più rotto in silenzio per settimane.
    const { data: resetCount, error: resetErr } = await supabase.rpc('reset_daily_counters');
    if (resetErr) {
      console.error('CRON: daily counter reset FAILED: ' + resetErr.message);
      Sentry.captureMessage('daily_counter_reset_failed', {
        level: 'error',
        extra: { message: resetErr.message, code: (resetErr as any).code ?? null },
      });
    } else if (typeof resetCount === 'number' && resetCount > 0) {
      console.log('CRON: Reset daily counters for ' + resetCount + ' users');
    }
    // Data di reset portata a OGGI anche dove non c'era niente da azzerare
    // (audit 28 set 2026). reset_daily_counters salta le righe con 0 invii,
    // quindi dopo un giorno senza invii la data restava vecchia; claim_daily_quota
    // la timbra solo se NULL. Il primo tick dopo i claim di stamattina trovava
    // "data vecchia + contatore > 0" e azzerava: cap e rampa warm-up valevano
    // doppio ogni giorno dopo un giorno fermo. Qui si toccano SOLO righe con 0
    // invii e upsell non inviato, dove azzerare non cambia niente: è lo stesso
    // effetto del reset, meno il salto. Il fix definitivo è in SQL (migration
    // 20260928_reset_daily_counters_date_based.sql, da applicare); questo resta
    // innocuo anche dopo. Best-effort: un errore non ferma gli invii.
    try {
      const romeToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const { error: stampErr } = await supabase.from('user_instances')
        .update({ last_daily_reset_at: romeToday })
        .or('last_daily_reset_at.is.null,last_daily_reset_at.lt.' + romeToday)
        .eq('messages_sent_today', 0)
        .eq('upsell_sent_today', false);
      // Una riga per lambda, non una al minuto: il 7 lug il PATCH REST su
      // questa colonna rispondeva 400 ("column does not exist") a ogni tick.
      if (stampErr && !resetStampWarned) {
        resetStampWarned = true;
        console.warn('CRON: daily reset date refresh failed (non-fatal): ' + stampErr.message);
      }
    } catch (e) {
      console.warn('CRON: daily reset date refresh error (non-fatal):', (e as Error)?.message);
    }

    // Trial → Free downgrade — the ONLY systematic billing mutation in the
    // codebase, gated on the kill-switch: during the free beta the trial
    // state must stay frozen in the DB (the reactivation runbook,
    // docs/RUNBOOK-riattivazione-billing.md, depends on it) and no pricing
    // WhatsApp may go out. On reactivation this block resumes on its own and
    // works through the backlog (the runbook's grandfather backfill empties
    // that backlog BEFORE the flip).
    if (isBillingEnabled()) {
      const { data: expiredTrials } = await supabase
        .from('user_instances')
        .select('phone_number, instance_name')
        .eq('subscription_plan', 'trial')
        .lt('trial_ends_at', new Date().toISOString())
        // Bounded (runbook §2): at billing reactivation MONTHS of beta trials
        // expire at once — unbounded, this loop (one CAS + one notify fetch
        // per user, sequential, BEFORE the send loop) would blow the 10s
        // lambda budget every run and starve delivery for everyone. 20 per
        // tick converges in a few minutes via the CAS below.
        .limit(20);

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
          // 3s timeout: this fetch runs sequentially per downgraded user and,
          // unlike the per-message sends, used to have NO abort — one slow
          // Evolution response per user was enough to eat the whole lambda
          // budget during a backlog (runbook §2).
          const notifyCtrl = new AbortController();
          const notifyTimeout = setTimeout(() => notifyCtrl.abort(), 3000);
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + trial.instance_name, {
              method: 'POST',
              headers: { apikey: process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                number: trial.phone_number,
                text: `⏰ Il tuo trial WhatsLater è scaduto.\n\nHai 3 messaggi gratuiti al giorno. Per 20/giorno, passa a Personal a €4,99/mese:\n${process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app'}/dashboard`
              }),
              signal: notifyCtrl.signal,
            });
          } finally {
            clearTimeout(notifyTimeout);
          }
        } catch (e) {}
        console.log('CRON: Trial expired → free for ' + trial.phone_number);
      }
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

    // Recurrence reconciliation: ensure every active recurring chain has its next
    // occurrence queued, even when the previous occurrence's creation never ran —
    // a lambda death between status='sent' and the insert, or a row recovered by
    // the stale-'processing' branch above (which only revives 'processing' rows).
    // recurring_chains_needing_next() returns the latest row of each chain that has
    // no live row and whose latest ended sent/failed; we compute the next
    // occurrence (deterministic, no jitter) and INSERT it idempotently — the
    // uniq_recurrence_occurrence partial index collapses concurrent/duplicate
    // creations (23505 = already created). Non-fatal: must not block the send loop.
    try {
      const { data: deadChains } = await supabase.rpc('recurring_chains_needing_next');
      const ids = (deadChains || []).map((r: any) => r.latest_id);
      if (ids.length) {
        const { data: latestRows } = await supabase
          .from('scheduled_messages')
          .select('*')
          .in('id', ids);
        for (const row of (latestRows || [])) {
          const decision = reconcileRecurringChain({
            hasLiveRow: false, // RPC already filtered to chains with no live row
            latestStatus: row.status,
            latestScheduledAt: row.scheduled_at,
            rule: row.recurrence_rule,
            anchorAt: row.recurrence_anchor_at, // BUG #2: re-anchor to original time-of-day
          });
          if (!decision.insert) continue;
          const chainId = row.parent_recurrence_id || row.id;
          const { error: insErr } = await supabase.from('scheduled_messages').insert({
            user_instance_id: row.user_instance_id,
            instance_phone: row.instance_phone,
            recipient_number: row.recipient_number,
            recipient_name: row.recipient_name,
            caption: row.caption,
            parsed_message: row.parsed_message,
            scheduled_at: decision.scheduledAt,
            status: 'pending',
            retry_count: 0,
            max_retries: 3,
            wa_message_id: null,
            media_type: row.media_type || null,
            media_url: row.media_url || null,
            media_filename: row.media_filename || null,
            media_caption: row.media_caption || null,
            recurrence_rule: row.recurrence_rule,
            recurrence_anchor_at: row.recurrence_anchor_at, // BUG #2: anchor travels down the chain
            parent_recurrence_id: chainId,
          });
          if (insErr && insErr.code !== '23505') {
            console.error('CRON: recurrence reconcile insert failed (chain ' + chainId + '): ' + insErr.message);
          } else if (!insErr) {
            console.log('CRON: recurrence reconcile created next occurrence (chain ' + chainId + ') at ' + decision.scheduledAt);
          }
        }
      }
    } catch (reconErr) {
      console.error('CRON: recurrence reconciliation error (non-fatal):', (reconErr as Error)?.message);
    }

    const { data: pendingPool, error: queryErr } = await supabase
      .from('scheduled_messages')
      .select('*, user_instances!inner(id, phone_number, instance_name, trial_ends_at, subscription_plan, connection_status, messages_sent_today, upsell_sent_today, paired_at)')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(60);

    if (queryErr) {
      console.error('CRON: Query error:', queryErr.message);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    // Per-user fairness: cap how many of one user's messages enter a single
    // tick so a user with a large backlog can't monopolize the window and
    // starve others. The remaining rows are picked up on the next tick(s).
    const MAX_PER_USER_PER_TICK = 8;
    const perUserCount: Record<string, number> = {};
    // Backlog alla riconnessione (audit 25 set 2026): le righe trattenute per
    // disconnessione diventano tutte dovute nello stesso tick appena l'istanza
    // torna 'open' → fino a 5 invii paralleli in ~3 s da un device appena
    // ricollegato. Per utente ne parte una, le altre slittano di +90 s l'una
    // (planBacklogSpread). Il guard .eq('status','pending') non scavalca mai
    // una riga già presa da un trigger concorrente.
    const spread = planBacklogSpread((pendingPool || []) as any[], Date.now());
    if (spread.defer.length) {
      await Promise.all(spread.defer.map((d) => supabase.from('scheduled_messages')
        .update({ scheduled_at: d.scheduledAt, error_message: 'WhatsApp ricollegato: invii arretrati distanziati per non partire tutti insieme' })
        .eq('id', d.id)
        .eq('status', 'pending')));
      console.log('CRON: reconnect backlog spread — deferred ' + spread.defer.length + ' rows by +90s steps');
    }
    const pendingMessages = spread.keep.filter((m: any) => {
      const key = m.instance_phone || m.user_instances?.phone_number || 'unknown';
      perUserCount[key] = (perUserCount[key] || 0) + 1;
      return perUserCount[key] <= MAX_PER_USER_PER_TICK;
    }).slice(0, 25);
    console.log('CRON: ' + pendingMessages.length + ' pending messages selected (fair, pool=' + (pendingPool || []).length + ')');

    let sent = 0, failed = 0, skipped = 0, rateLimited = 0, trialExpired = 0, disconnected = 0;

    // Track which disconnected instances we've already logged
    const disconnectedInstances = new Set<string>();
    // Dedup the threshold-crossing Sentry alert to once per instance per run
    // (a batch of 5 cross-threshold msg from the same user = 1 alert).
    const thresholdNotifiedInstances = new Set<string>();
    // Stato vero da Evolution, letto al massimo UNA volta per istanza per tick
    // e solo quando un invio fallisce con un errore da disconnessione.
    const liveStateCache = new Map<string, Promise<LiveConnectionStatus | null>>();
    const liveStateOf = (name: string) => {
      let p = liveStateCache.get(name);
      if (!p) { p = fetchEvolutionState(name); liveStateCache.set(name, p); }
      return p;
    };
    // Dedup the "invii sospesi" owner notification to once per cron run, per
    // instance — same reason as thresholdNotifiedInstances above.
    const blockedNotifiedInstances = new Set<string>();
    // Within-run cooldown guard: the DB "3 msg / 24h" count is read per-message
    // in parallel, so 5 msgs to the same recipient in one batch all see count<3
    // and fire together (#9). Track in-run sends per recipient and enforce the
    // cap against DB-count + in-run-count.
    const inRunSendsToRecipient: Record<string, number> = {};

    const inRunNewRecipients: Record<string, Set<string>> = {}; // corsia lenta numeri nuovi (per run)
    // Controllo del gruppo (D8): uno per istanza+gruppo per giro, condiviso
    // da tutte le righe verso lo stesso gruppo.
    const inRunGroupLookup: Record<string, Promise<GroupLookup>> = {};
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
        // Resolve the billing-effective plan BEFORE any gate: with billing off
        // the raw row still says 'trial' (expired months ago) and would fall
        // into the trial_expired branch, pausing every beta message. The copy
        // is decision-local — msg.user_instances stays raw, and 'beta' must
        // never be written back to the DB (the CHECK constraint rejects it).
        const effectivePlan = getEffectivePlan(msg.user_instances?.subscription_plan);
        const decision = shouldSendMessage(msg.user_instances
          ? { ...msg, user_instances: { ...msg.user_instances, subscription_plan: effectivePlan } }
          : msg);

        if (decision === 'no_instance') {
          console.error('CRON: Message ' + msg.id + ' has no linked user_instance. Skipping.');
          return 'skipped' as const;
        }

        const instanceName = msg.user_instances.instance_name;
        const ownerPhone = msg.user_instances.phone_number;
        const isGroup = isGroupJid(msg.recipient_number);

        if (decision === 'disconnected') {
          // Smart-retry staircase: 12 attempts × 5min = ≈1h retry window, then
          // tomorrow. The ladder restarts every 12 steps (disconnectRetryStep):
          // before, a row left at count=12 by a long outage was deferred ANOTHER
          // full day by a few seconds of 'connecting' the next day.
          //
          // Niente più avviso WhatsApp al titolare qui (audit 25 set 2026):
          // partiva da /message/sendText/<STESSA istanza>, che è proprio quella
          // scollegata/sloggata → non poteva MAI arrivare (…1526 scollegato 17
          // giorni senza che nessuno lo sapesse). L'avviso vive nel banner della
          // dashboard; qui resta l'allerta Sentry per l'operatore.
          const RETRY_THRESHOLD = DISCONNECT_RETRY_THRESHOLD;
          const prevCount = (msg as any).disconnect_retry_count ?? 0;
          const step = disconnectRetryStep(prevCount, msg.user_instances.connection_status);
          const newCount = step.newCount;
          if (!disconnectedInstances.has(instanceName)) {
            disconnectedInstances.add(instanceName);
            console.log('CRON: Instance ' + instanceName + ' is ' + (msg.user_instances.connection_status || 'unknown') + ', smart-retry count=' + newCount + ' (tomorrow every ' + RETRY_THRESHOLD + ')');
          }

          let newScheduledAt: string;
          let errorMessage: string;
          if (step.retryInMinutes !== null) {
            newScheduledAt = rescheduleSoon(msg.scheduled_at, step.retryInMinutes);
            errorMessage = `Istanza disconnessa, retry ${((newCount - 1) % RETRY_THRESHOLD) + 1}/${RETRY_THRESHOLD} fra ${step.retryInMinutes} min`;
          } else {
            // "Domani" è un orario calcolato dal sistema → fascia di cortesia
            // (un promemoria delle 20:30 in scaletta fino alle 21:30 non riparte
            // domani alle 21:30).
            newScheduledAt = applyCourtesyWindow(new Date(rescheduleTomorrow(msg.scheduled_at)), new Date()).toISOString();
            errorMessage = `Istanza disconnessa per ${RETRY_THRESHOLD}× 5min, riprogrammato a domani`;
            if (!thresholdNotifiedInstances.has(instanceName)) {
              thresholdNotifiedInstances.add(instanceName);
              // Sentry alert: instance has been disconnected for the full
              // smart-retry window (12 × 5min). Deduped per instance per run so
              // a batch of 5 cross-threshold messages doesn't spam Sentry.
              Sentry.captureMessage('instance_disconnect_threshold', {
                level: 'error',
                tags: { user_hash: await hashContactRef(ownerPhone) },
                extra: {
                  retry_count: newCount,
                  threshold: RETRY_THRESHOLD,
                  connection_status: msg.user_instances.connection_status || 'unknown',
                },
              });
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
            status: 'paused',
            error_message: 'Trial scaduto — messaggio in pausa, riattiva con un piano'
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

        // Gruppi (D13, D20), senza chiamate a Evolution: interruttore spento, o
        // riga nata dalla chat con se stessi (non è passata dal controllo del POST).
        if (isGroup) {
          const holdText = !groupsEnabled() ? GROUPS_OFF_TEXT : msg.wa_message_id ? GROUP_FROM_SELF_CHAT_TEXT : null;
          if (holdText) {
            await supabase.from('scheduled_messages')
              .update({ status: 'paused', error_message: holdText })
              .eq('id', msg.id).eq('status', 'pending');
            console.log('CRON: group row ' + msg.id + ' paused (' + (holdText === GROUPS_OFF_TEXT ? 'groups off' : 'from self-chat') + ')');
            return 'skipped' as const;
          }
        }

        // Allegato tolto dalla pulizia dei 30 giorni (cleanup-media lascia
        // media_type come segnale e azzera media_url). Senza questo controllo
        // hasMedia era false e la riga partiva come solo testo: promemoria
        // senza il PDF, o corpo vuoto → 400 e tre tentativi bruciati. Si ferma
        // qui, prima di quota e claim: nessun invio, nessun avviso al titolare
        // (la card "Non inviato" lo mostra), non pesa sul breaker.
        if (msg.media_type && !msg.media_url) {
          await supabase.from('scheduled_messages').update({
            status: 'failed',
            retry_count: Math.max(3, msg.retry_count || 0),
            error_message: MEDIA_EXPIRED_ERROR,
            send_attempted_at: null,
          }).eq('id', msg.id).eq('status', 'pending');
          console.log('CRON: media expired for msg ' + msg.id + ' — not sent as text-only');
          return 'failed' as const;
        }

        // Backlog di una disconnessione, già in ritardo di ≥30 min (o rinviato
        // a domani): l'orario non è più quello scelto dall'utente ma uno del
        // sistema, quindi vale la fascia 08-21 come per quota e corsia lenta.
        // Senza, un re-pair alle 00:18 faceva partire i promemoria a mezzanotte.
        // Sotto i 30 min l'orario dell'utente resta (isLateDisconnectBacklog),
        // e resta sempre se l'utente l'ha riscelto (Posticipa/Modifica azzerano
        // error_message: il contatore da solo non basta).
        if (isLateDisconnectBacklog((msg as any).disconnect_retry_count, msg.error_message) && !isWithinCourtesyWindow(new Date())) {
          await supabase.from('scheduled_messages').update({
            scheduled_at: applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000),
            error_message: 'WhatsApp ricollegato fuori orario — il promemoria in ritardo parte domattina',
          }).eq('id', msg.id).eq('status', 'pending');
          return 'rate_limited' as const;
        }

        // Tier daily limit check — on the EFFECTIVE plan: quota, MAX cap and
        // upsell all follow it (beta: 50/day). With billing on this is the raw
        // plan with the same || 'free' fallback as before.
        const plan = effectivePlan;
        const planLimits = getPlanLimits(plan);
        // Rampa di warm-up (anti-ban, 7 set 2026): un numero appena collegato non
        // parte col cap pieno del piano ma con 5/5/10/15/25/35 nei primi 6 giorni
        // (Baileys #1983: 15-20 numeri nuovi al giorno da un'istanza fresca →
        // restrizioni progressive e ban). WARMUP_RAMP_DISABLED=true la spegne.
        // Stessa funzione che la GET /api/messages usa per mostrare il limite
        // di oggi in dashboard (app/lib/daily-limit.ts, rapporto 360 B3).
        const { limit: dailyLimit, inWarmup } = dailyLimitNow(planLimits.dailyLimit, msg.user_instances.paired_at, new Date());
        const sentToday = msg.user_instances.messages_sent_today || 0;
        if (sentToday >= dailyLimit) {
          console.log('CRON: DAILY LIMIT reached for ' + ownerPhone + ' (' + sentToday + '/' + dailyLimit + ' plan=' + plan + (inWarmup ? ' warmup' : '') + ')');
          // Head-of-line fix (runbook §2): left at its old scheduled_at the row
          // re-enters the limit(25) oldest-first window on every tick until
          // midnight — a couple of over-quota users starve everyone else's
          // delivery. Move it past the Rome-midnight quota reset (+ jitter so
          // a backlog doesn't burst at 00:00 sharp); it could not have sent
          // before the reset anyway, so delivery timing is unchanged.
          await supabase.from('scheduled_messages').update({
            scheduled_at: applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000),
            error_message: 'Limite giornaliero raggiunto (' + sentToday + '/' + dailyLimit + ')' + (inWarmup ? ' nei primi giorni dal collegamento' : '') + ' — riprogrammato a domattina',
          }).eq('id', msg.id);
          return 'rate_limited' as const;
        }

        // Cool-down: max 3 messages to same recipient in 24h
        const { data: recentSentRows } = await supabase
          .from('scheduled_messages')
          .select('sent_at')
          .eq('instance_phone', ownerPhone)
          .eq('recipient_number', msg.recipient_number)
          .eq('status', 'sent')
          .gte('sent_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .limit(50);

        const recipKey = ownerPhone + '|' + msg.recipient_number;
        const alreadyInRun = inRunSendsToRecipient[recipKey] || 0;
        const sentTimes = ((recentSentRows || []) as Array<{ sent_at: string | null }>)
          .map((r) => new Date(r.sent_at || ''))
          .filter((d) => !isNaN(d.getTime()));
        // Gli invii di questo stesso giro contano come "adesso".
        for (let k = 0; k < alreadyInRun; k++) sentTimes.push(new Date());
        const releaseAt = cooldownReleaseAt(sentTimes, COOLDOWN_MAX_PER_RECIPIENT);
        if (releaseAt) {
          console.log('CRON: COOLDOWN — ' + sentTimes.length + ' msgs to ' + logRecipient(msg.recipient_number) + ' in 24h (inRun=' + alreadyInRun + ')');
          // Audit 25 set 2026: prima +30 min ripetuti fino al giorno dopo, col
          // motivo "+30 min" falso. Ora l'istante vero in cui la finestra
          // mobile si libera, una volta sola; è un orario calcolato dal
          // sistema, quindi passa per la fascia di cortesia 08-21.
          // Fuori fascia → le 08:00 successive (mai PRIMA di releaseAt: le 20:00
          // di applyCourtesyWindow ricadrebbero ancora dentro il cool-down).
          const at = isWithinCourtesyWindow(releaseAt) ? releaseAt : nextRomeMorning(releaseAt);
          const romeLabel = new Intl.DateTimeFormat('it-IT', {
            timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          }).format(at);
          await supabase.from('scheduled_messages').update({
            scheduled_at: at.toISOString(),
            error_message: 'Massimo ' + COOLDOWN_MAX_PER_RECIPIENT + ' messaggi in 24 ore ' + (isGroup ? 'nello stesso gruppo' : 'alla stessa persona') + ': parte ' + romeLabel,
          }).eq('id', msg.id);
          return 'rate_limited' as const;
        }

        // Destinatario sospeso (ha scritto "stop", oppure WhatsApp ha rifiutato
        // 3 messaggi verso di lui): la riga va in pausa con il motivo, mai inviata.
        if (suppressionsEnabled()) {
          const sup = await getSuppression(supabase, ownerPhone, msg.recipient_number);
          if (sup) {
            await supabase.from('scheduled_messages')
              .update({ status: 'paused', error_message: suppressionReasonText(sup.reason, { group: isGroup }) })
              .eq('id', msg.id).eq('status', 'pending');
            console.log('CRON: SUPPRESSED recipient for ' + ownerPhone + ' reason=' + sup.reason);
            return 'skipped' as const;
          }
        }

        // Corsia lenta per i numeri NUOVI (anti-ban, 7 set 2026): a un numero che
        // l'utente non ha mai scritto e che non ha in rubrica si scrive al massimo
        // N volte al giorno (default 5, env NEW_RECIPIENTS_PER_DAY). Nessuna
        // domanda a nessuno: la riga slitta a domattina con il motivo in chiaro.
        // Per l'ICP D (rubrica già piena) non scatta quasi mai; per un calendario
        // importato in blocco è la differenza tra 5 e 50 sconosciuti al giorno.
        if (process.env.NEW_RECIPIENTS_DISABLED !== 'true') {
          const known = await isKnownRecipient(supabase, ownerPhone, msg.recipient_number);
          if (!known) {
            const todayStartIso = romeDayStart(new Date()).toISOString();
            const inRun = inRunNewRecipients[ownerPhone] || (inRunNewRecipients[ownerPhone] = new Set<string>());
            const newToday = await countNewRecipientsSentToday(supabase, ownerPhone, todayStartIso);
            const inRunOthers = inRun.has(msg.recipient_number) ? inRun.size - 1 : inRun.size;
            const cap = newRecipientsPerDay();
            if (newToday + inRunOthers >= cap) {
              console.log('CRON: NEW-RECIPIENT LANE full for ' + ownerPhone + ' (' + (newToday + inRunOthers) + '/' + cap + ')');
              await supabase.from('scheduled_messages').update({
                scheduled_at: applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000),
                error_message: 'Numeri nuovi: massimo ' + cap + ' al giorno a chi non ti ha mai scritto — riprogrammato a domattina',
              }).eq('id', msg.id);
              return 'rate_limited' as const;
            }
            inRun.add(msg.recipient_number);
          }
        }

        const isBlocked = await checkFailures(supabase, ownerPhone);
        if (isBlocked) {
          // Move the blocked user's row past the Rome-midnight reset so it
          // leaves the global limit(25) oldest-first window instead of
          // re-entering it every tick and starving other users (same head-of
          // -line fix as the daily-limit branch above). Notify the owner ONCE
          // per cron run, with a timeout so a hung socket can't burn the batch.
          await supabase.from('scheduled_messages').update({
            scheduled_at: applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000),
            error_message: 'Invii sospesi (troppi fallimenti nelle ultime 24h) \u2014 riprogrammato a domattina',
          }).eq('id', msg.id);
          if (!blockedNotifiedInstances.has(instanceName)) {
            blockedNotifiedInstances.add(instanceName);
            try {
              const ctrl = new AbortController();
              const t = setTimeout(() => ctrl.abort(), 3000);
              await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                method: 'POST',
                headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: ownerPhone, text: '\u26a0\ufe0f Messaggi sospesi temporaneamente. Troppi invii falliti.' }),
                signal: ctrl.signal,
              });
              clearTimeout(t);
            } catch (e) {}
          }
          return 'rate_limited' as const;
        }

        const check = await canSend(supabase, ownerPhone, instanceName);
        if (!check.allowed) {
          console.log('CRON: RATE LIMITED:', ownerPhone, check.reason);
          // Reschedule out of the window too \u2014 otherwise a rate-limited row
          // sits at its stale scheduled_at and re-enters limit(25) each tick.
          await supabase.from('scheduled_messages').update({
            scheduled_at: applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000),
            error_message: 'Rate limit raggiunto \u2014 riprogrammato a domattina',
          }).eq('id', msg.id);
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

        // Gruppo (D8, D9): ne fai ancora parte? Solo il trigger che ha vinto il
        // claim lo chiede, prima della quota. Non blocca se Evolution non
        // risponde (salvo overlimit o rampa: allora rimanda), solo un verdetto
        // esplicito mette in pausa. Con CACHE_LOCAL_ENABLED un
        // gruppo lasciato può rispondere 201 "inviato" a vuoto. Se la lambda
        // muore qui send_attempted_at è ancora NULL: il recupero la rimette in coda.
        if (isGroup) {
          const lookupKey = instanceName + '|' + msg.recipient_number;
          const look = await (inRunGroupLookup[lookupKey] || (inRunGroupLookup[lookupKey] = lookupGroup(instanceName, msg.recipient_number, ownerPhone, 3000)));
          const groupName = recipientDisplayName(look.kind === 'ok' && look.name ? { ...msg, recipient_name: look.name } : msg);
          const pauseText = look.kind === 'not_member' ? groupNotMemberText(groupName)
            : look.kind === 'ok' && look.community ? groupCommunityText(groupName)
            : look.kind === 'ok' && look.adminOnly && look.self === 'member' ? groupAdminsOnlyText(groupName)
            : null;
          if (pauseText) {
            await supabase.from('scheduled_messages')
              .update({ status: 'paused', error_message: pauseText, send_attempted_at: null })
              .eq('id', msg.id).eq('status', 'processing');
            console.log('CRON: group row ' + msg.id + ' paused after check (' + look.kind + ') to=' + logRecipient(msg.recipient_number));
            return 'skipped' as const;
          }
          // Controllo senza risposta: di norma si prosegue (D8), tranne due casi.
          // WhatsApp ha risposto "rate-overlimit": inviare subito dopo peggiora.
          // Oppure siamo nella rampa e non sappiamo quante persone ha il gruppo (D9).
          // La riga torna in coda tra 15-30 min, dentro la fascia 08-21, senza quota.
          if (look.kind === 'unavailable' && (look.reason === 'overlimit' || inWarmup)) {
            const soon = new Date(applyJitter(new Date(Date.now() + 15 * 60_000).toISOString(), 15 * 60_000));
            const at = isWithinCourtesyWindow(soon) ? soon : new Date(applyJitter(nextRomeMorning(soon).toISOString(), 30 * 60_000));
            await supabase.from('scheduled_messages')
              .update({ status: 'pending', scheduled_at: at.toISOString(), error_message: GROUP_CHECK_RETRY_TEXT, send_attempted_at: null })
              .eq('id', msg.id).eq('status', 'processing');
            console.log('CRON: group row ' + msg.id + ' requeued, check ' + look.reason + (inWarmup ? ' (warmup)' : '') + ' to=' + logRecipient(msg.recipient_number));
            return 'rate_limited' as const;
          }
          if (look.kind === 'ok' && inWarmup && typeof look.size === 'number' && look.size > BIG_GROUP_WARMUP_SIZE) {
            await supabase.from('scheduled_messages')
              .update({
                status: 'pending',
                scheduled_at: applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000),
                error_message: BIG_GROUP_WARMUP_TEXT,
                send_attempted_at: null,
              })
              .eq('id', msg.id).eq('status', 'processing');
            return 'rate_limited' as const;
          }
          if (look.kind === 'ok' && look.name) {
            const fresh = truncateAtGrapheme(look.name, 100);
            if (fresh && fresh !== msg.recipient_name) {
              await supabase.from('scheduled_messages').update({ recipient_name: fresh }).eq('id', msg.id);
              msg.recipient_name = fresh;
            }
          }
        }

        // Mark this recipient as "sending" in this run so the parallel cooldown
        // check for a 2nd message to the same recipient sees it (#9).
        inRunSendsToRecipient[recipKey] = (inRunSendsToRecipient[recipKey] || 0) + 1;

        // Atomic quota gate (anti-overshoot): increment messages_sent_today only
        // if still strictly under the tier limit. NULL = at/over the limit (or a
        // concurrent send took the last slot) -> release the processing lock back
        // to pending and rate-limit. Refunded in the catch if the send fails.
        const { data: claimedQuota, error: quotaErr } = await supabase
          .rpc('claim_daily_quota', { p_phone: ownerPhone, p_limit: dailyLimit });
        if (quotaErr || claimedQuota == null) {
          // Requeue: clear send_attempted_at so the released row does not carry a
          // stale timestamp into its next attempt (see buildQuotaRequeueUpdate).
          // Genuine quota exhaustion (claim returned NULL) → also move past the
          // Rome-midnight reset (head-of-line, runbook §2). A transient RPC
          // error is NOT a quota verdict: plain requeue, retried next tick.
          await supabase.from('scheduled_messages').update(buildQuotaRequeueUpdate(
            quotaErr ? undefined : applyJitter(nextRomeMorning(new Date()).toISOString(), 30 * 60_000)
          )).eq('id', msg.id);
          console.log('CRON: quota exhausted (atomic) for ' + ownerPhone + ' plan=' + plan + (quotaErr ? ' err=' + quotaErr.message : ''));
          return 'rate_limited' as const;
        }
        const newSentToday: number = claimedQuota as number;

        // Anti-ban intra-batch jitter (800-2500ms). Extended from the prior
        // 200-400ms because 5 parallel sends within a few hundred ms looked
        // like a burst pattern to Baileys/WhatsApp. Still within the 8s
        // lambda budget on Vercel Hobby (5 parallel × max 2.5s = 2.5s wall).
        await new Promise(r => setTimeout(r, 800 + Math.random() * 1700));

        const hasMedia = !!(msg.media_url && msg.media_type);

        // Typing simulation: show "is typing…" indicator on the recipient's
        // device proportional to message length (max 4s). Recipients see a
        // human-shaped activity pattern. Failure of /chat/sendPresence is
        // graceful — we log and still send the real message. Skipped for media
        // sends: "sta scrivendo…" before a file is not a human pattern, and
        // those 4 s belong to the (much longer) media send budget.
        // Niente "sta scrivendo" nei gruppi (D9).
        const typingMs = (hasMedia || isGroup) ? 0 : computeTypingDelay((msg.parsed_message || '').length);
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
        // The signed URL is valid 1h — well above the send timeout, so
        // Evolution can fetch it during the send call.
        let signedMediaUrl: string | null = null;
        let mediaSize: number | null = null;
        let mediaMime: string | null = null;
        if (hasMedia) {
          const { data: signed } = await supabase.storage
            .from('message-media')
            .createSignedUrl(msg.media_url, 3600);
          signedMediaUrl = signed?.signedUrl || null;
          if (!signedMediaUrl) {
            throw new Error('Failed to sign media URL for ' + msg.media_url);
          }
          // Dimensione e mimetype dai metadati dell'oggetto (best-effort): la
          // dimensione regola il timeout (sendTimeoutMs), il mimetype esplicito
          // evita che Evolution lo indovini dal nome file o riscaricando l'URL.
          try {
            const path = String(msg.media_url);
            const slash = path.lastIndexOf('/');
            const { data: objs } = await supabase.storage
              .from('message-media')
              .list(slash >= 0 ? path.slice(0, slash) : '', { search: path.slice(slash + 1), limit: 1 });
            const obj = (objs || []).find((o: any) => o?.name === path.slice(slash + 1)) as any;
            const size = Number(obj?.metadata?.size);
            if (Number.isFinite(size) && size > 0) mediaSize = size;
            if (typeof obj?.metadata?.mimetype === 'string' && obj.metadata.mimetype) mediaMime = obj.metadata.mimetype;
          } catch {}
        }

        const sendKind = signedMediaUrl ? 'media' : 'text';
        console.log('CRON: Sending msg ' + msg.id + ' kind=' + sendKind + ' via instance=' + instanceName + ' to=' + logRecipient(msg.recipient_number));

        // Resolve {nome} at send time from the row's recipient_name, so every
        // origin (dashboard, self-chat, recurrences) gets substitution and the
        // queued row keeps the raw token for editing. In un gruppo il testo
        // arriva uguale a tutti: il segnaposto si toglie (D11).
        const tplName = isGroup ? null : msg.recipient_name;
        const outboundText = applyTemplateVariables(msg.parsed_message, tplName);
        const outboundCaption = applyTemplateVariables(
          msg.media_caption || msg.parsed_message || null,
          tplName
        );

        // Atomic point-of-no-return claim (replaces the old unconditional stamp).
        // send_attempted_at flips null->now() exactly once per attempt, so the
        // loser of two concurrent invocations skips HERE instead of double-sending.
        // This is the gate that actually holds when the upstream status CAS leaks
        // (2026-06-22 double-delivery): it sits AFTER the random jitter, so the two
        // invocations hit it staggered and the DB serializes them. The
        // stale-'processing' recovery at the top still keys off this column's
        // null/non-null meaning (NULL = never reached fetch, safe to retry).
        if (!(await claimSendAttempt(supabase, msg.id))) {
          // Lost the race: a concurrent invocation owns this send. Refund the
          // quota slot we claimed pre-send (both incremented messages_sent_today;
          // only the winner delivers) so the user isn't double-charged, then skip.
          await supabase.rpc('refund_daily_quota', { p_phone: ownerPhone });
          console.log('CRON: send already claimed by concurrent invocation, skipping id=' + msg.id);
          return 'skipped' as const;
        }

        const sendCtrl = new AbortController();
        const sendTimeoutUsedMs = sendTimeoutMs(signedMediaUrl ? 'media' : 'text', mediaSize, { group: isGroup });
        const sendTimeout = setTimeout(() => sendCtrl.abort(), sendTimeoutUsedMs);
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
                  ...(mediaMime ? { mimetype: mediaMime } : {}),
                  media: signedMediaUrl,
                  caption: outboundCaption || undefined,
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
                body: JSON.stringify({ number: msg.recipient_number, text: outboundText }),
                signal: sendCtrl.signal,
              }
            );
          }
        } catch (sendErr) {
          // Il gestore degli errori sta fuori dalla closure: gli si porta il
          // timeout effettivo per scriverlo onesto nel motivo.
          if (sendErr && typeof sendErr === 'object') (sendErr as any).timeoutMs = sendTimeoutUsedMs;
          throw sendErr;
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

        // Anti-ban rate counter — recorded AFTER the row is durably marked 'sent'
        // and wrapped so it CANNOT reject this promise. The message is already
        // delivered; a throw here (e.g. rate_limit_record RPC blip) would fall
        // into the failure handler below and trigger a bogus quota refund + a
        // duplicate send on the next tick. It is a counter, not worth re-sending.
        try {
          await recordSend(supabase, ownerPhone, instanceName);
        } catch (recordErr) {
          console.warn('CRON: recordSend failed post-send (non-fatal):', (recordErr as Error)?.message);
        }

        const driftMs = Date.now() - new Date(msg.scheduled_at).getTime();
        await logAuditEvent({
          userPhone: ownerPhone,
          eventType: 'message_sent',
          payload: {
            message_id: msg.id,
            drift_ms: driftMs,
            batch_size: batch.length,
            recipient_hash: await hashContactRef(msg.recipient_number),
            recipient_kind: isGroup ? 'group' : 'person',
            has_recurrence: !!msg.recurrence_rule,
          },
        });

        // Recurrence: the next occurrence is created by the reconciliation sweep
        // at the TOP of this handler (single, idempotent, race-safe path via
        // recurring_chains_needing_next() + the uniq_recurrence_occurrence index),
        // NOT inline here. Inline creation could be skipped by a lambda death
        // between this status='sent' UPDATE and the insert — silently ending the
        // chain. Reconciliation also covers rows resurrected by stale-recovery.

        // Daily counter was already incremented atomically at the pre-send
        // quota claim (claim_daily_quota); newSentToday captured there.

        // Upsell at 80% of daily limit (once per day). Gate extracted to
        // cron-utils.shouldSendUpsell: with billing off it NEVER fires (no
        // pricing copy during the free beta), and 'beta' is excluded as a
        // second belt on top of the flag.
        if (shouldSendUpsell({
          billingEnabled: isBillingEnabled(),
          plan,
          newSentToday,
          dailyLimit: planLimits.dailyLimit,
          upsellSentToday: !!msg.user_instances.upsell_sent_today,
        })) {
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

        // 2026-09-07: la conferma "✅ Inviato a X!" a OGNI invio riuscito è
        // spenta di default. Raddoppiava il volume in uscita dal numero
        // dell'utente (un promemoria = due messaggi), contraddiceva il
        // principio silenzioso (CLAUDE.md) e, sugli account passati al nuovo
        // identificativo @lid, creava una seconda chat "Nome (Tu)" sul telefono
        // (vault, diagnosi 6 set). Resta dietro flag per un opt-in futuro.
        if (process.env.OWNER_SENT_NOTIFY_ENABLED === 'true') {
          try {
            await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
              method: 'POST',
              headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: ownerPhone, text: '\u2705 Inviato ' + (isGroup ? 'nel gruppo «' + recipientDisplayName(msg) + '»' : 'a ' + (msg.recipient_name || msg.recipient_number)) + '!' })
            });
          } catch (notifyErr) {}
        }
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
          else if (r.value === 'failed') failed++;
        } else {
          // Promise rejected = send error, handle retry
          const msg = batch[j];
          const userInst = msg.user_instances;
          const instanceName = userInst?.instance_name;
          const ownerPhone = userInst?.phone_number;
          const err = r.reason;
          // Send timed out: the fetch was aborted but Baileys may have delivered.
          // Do NOT auto-requeue (that would double-send). Mark the row 'sent' with
          // a diagnostic marker (same policy as the stale-processing recovery),
          // and do NOT refund the quota slot — the message likely went out.
          const isTimeout = (err as any)?.name === 'AbortError' || (err as any)?.name === 'TimeoutError';
          if (isTimeout) {
            // Il marcatore 'send_timeout_indeterminate' in testa a error_message
            // è il contratto con la dashboard ("Da verificare"): non cambiarlo.
            // Stato 'sent' finché non esiste uno stato dedicato (serve migration).
            const usedMs = Number((err as any)?.timeoutMs);
            const timeoutS = Math.round((Number.isFinite(usedMs) && usedMs > 0 ? usedMs : sendTimeoutMs('text')) / 1000);
            await supabase.from('scheduled_messages').update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              error_message: 'send_timeout_indeterminate: nessuna conferma da Evolution entro ' + timeoutS + ' s, marcato inviato per evitare duplicati (verifica ✓✓ su WhatsApp se critico)',
            }).eq('id', msg.id);
            continue; // skip refund + requeue
          }
          // Gruppo (D10): un doppione in un gruppo lo vedono tutti. Si ritenta
          // solo ciò che è di sicuro prima dell'inoltro; per le persone nulla cambia.
          const isGroup = isGroupJid(msg.recipient_number);
          const groupOutcome = isGroup ? classifyGroupSendFailure(err) : null;
          if (groupOutcome === 'indeterminate') {
            // Come il timeout: niente rimborso, niente retry.
            await supabase.from('scheduled_messages').update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              error_message: 'send_indeterminate: risposta incerta da Evolution durante l\'invio nel gruppo, marcato inviato per evitare doppioni (controlla nel gruppo)',
            }).eq('id', msg.id);
            console.log('CRON: group send indeterminate for msg ' + msg.id + ' — marked sent, no retry');
            continue;
          }
          if (groupOutcome === 'unreachable' || groupOutcome === 'undeliverable') {
            // In pausa col motivo: niente retry_count, niente avviso, niente
            // 'failed' (non pesa sul freno dei fallimenti).
            if (ownerPhone) await supabase.rpc('refund_daily_quota', { p_phone: ownerPhone });
            const name = recipientDisplayName(msg);
            await supabase.from('scheduled_messages').update({
              status: 'paused',
              error_message: groupOutcome === 'unreachable' ? groupNotMemberText(name) : groupUndeliverableText(name),
              send_attempted_at: null,
            }).eq('id', msg.id);
            console.log('CRON: group send ' + groupOutcome + ' for msg ' + msg.id + ' — paused');
            skipped++;
            continue;
          }
          // Refund the quota slot claimed pre-send: this attempt failed. On a
          // retry the next attempt re-claims; if terminal nothing was delivered.
          // Either way this attempt must not consume the user's daily quota.
          if (ownerPhone) {
            await supabase.rpc('refund_daily_quota', { p_phone: ownerPhone });
          }
          // WhatsApp said the number does not exist ("exists": false): retrying
          // cannot help, so the row goes straight to 'failed' instead of burning
          // two more attempts 5 and 10 minutes later.
          const notOnWhatsApp = isNotOnWhatsAppError(err?.message);
          const disconnectedKind = !notOnWhatsApp && mapErrorReason(err?.message, { isGroup }).kind === 'disconnected';
          // Errore "da disconnessione" (Connection Closed, logged out, 401…)
          // con il DB che diceva 'open' (audit 25 set 2026): prima bruciava 3
          // retry generici in ~15 min e finiva 'failed', perché lo stato lo
          // scrive solo il webhook e un CONNECTION_UPDATE perso non ha repliche.
          // Si chiede a Evolution lo stato vero (una GET, una volta per istanza
          // per tick): se non è 'open' si riallinea il DB e la riga entra nella
          // scaletta della disconnessione senza consumare retry_count.
          if (disconnectedKind && instanceName) {
            const live = await liveStateOf(instanceName);
            if (live && live !== 'open') {
              // Compare-and-set: se nel frattempo il webhook ha scritto uno stato
              // più nuovo, vince il suo (stessa regola del riallineamento giornaliero).
              const prevStatus = msg.user_instances?.connection_status ?? null;
              const demote = supabase.from('user_instances').update({ connection_status: live }).eq('instance_name', instanceName);
              await (prevStatus === null ? demote.is('connection_status', null) : demote.eq('connection_status', prevStatus));
              const step = disconnectRetryStep((msg as any).disconnect_retry_count ?? 0, live);
              await supabase.from('scheduled_messages').update({
                status: 'pending',
                send_attempted_at: null,
                scheduled_at: step.retryInMinutes !== null
                  ? rescheduleSoon(msg.scheduled_at, step.retryInMinutes)
                  : applyCourtesyWindow(new Date(rescheduleTomorrow(msg.scheduled_at)), new Date()).toISOString(),
                disconnect_retry_count: step.newCount,
                error_message: 'Istanza disconnessa (rilevato all\'invio: ' + live + '), nuovo tentativo ' + (step.retryInMinutes !== null ? 'fra ' + step.retryInMinutes + ' min' : 'domani'),
              }).eq('id', msg.id);
              console.log('CRON: send failed on ' + instanceName + ' — Evolution says ' + live + ', DB realigned, row back to the disconnect ladder');
              disconnected++;
              continue;
            }
          }
          const newRetry = notOnWhatsApp ? Math.max(3, (msg.retry_count || 0) + 1) : (msg.retry_count || 0) + 1;
          // Requeue/terminal: clear send_attempted_at on the way back to 'pending'
          // (and harmlessly on 'failed') so a retried row starts its next attempt
          // clean (see buildFailureRequeueUpdate).
          await supabase.from('scheduled_messages').update(buildFailureRequeueUpdate({
            newRetryCount: newRetry,
            errorMessage: err?.message || 'Unknown error',
            originalScheduledAt: msg.scheduled_at,
            now: Date.now(),
          })).eq('id', msg.id);
          if (newRetry >= 3) {
            // Un avviso che parte dalla stessa istanza che ha appena fallito per
            // disconnessione non può arrivare: si salta (la card "Non inviato"
            // in dashboard dice già "WhatsApp disconnesso — ricollega").
            // Per i gruppi mai (D9): basta la card rossa, principio silenzioso.
            if (!disconnectedKind && !isGroup) {
              try {
                await fetch(process.env.EVOLUTION_API_URL + '/message/sendText/' + instanceName, {
                  method: 'POST',
                  headers: { 'apikey': process.env.EVOLUTION_API_KEY!, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ number: ownerPhone, text: '\u274c Impossibile inviare a ' + (msg.recipient_name || msg.recipient_number) + (notOnWhatsApp ? ': il numero salvato non è su WhatsApp.' : ' dopo 3 tentativi.') })
                });
              } catch (e) {}
            }
            failed++;
            await logAuditEvent({
              userPhone: ownerPhone,
              eventType: 'message_failed',
              payload: {
                message_id: msg.id,
                error_code: (err as Error)?.message?.substring(0, 200) || 'unknown',
                attempt: newRetry,
                recipient_hash: await hashContactRef(msg.recipient_number),
                recipient_kind: isGroup ? 'group' : 'person',
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
