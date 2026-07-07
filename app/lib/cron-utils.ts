/**
 * Pure utility functions extracted from cron/send-messages for testability.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface UserInstance {
  id: string;
  phone_number: string;
  instance_name: string;
  trial_ends_at: string | null;
  subscription_plan: string;
  connection_status: string;
}

export interface PendingMessage {
  id: string;
  scheduled_at: string;
  status: string;
  retry_count: number;
  recipient_number: string;
  recipient_name: string | null;
  parsed_message: string;
  user_instances: UserInstance;
}

export type SkipReason =
  | 'no_instance'
  | 'disconnected'
  | 'trial_expired'
  | 'send'
  | 'skip';

/**
 * Determines if a message should be skipped before sending, and why.
 * Returns the skip reason or 'send' if the message should be sent.
 */
export function shouldSendMessage(msg: PendingMessage): SkipReason {
  const userInst = msg.user_instances;
  if (!userInst || !userInst.instance_name) {
    return 'no_instance';
  }

  // P17: Check connection_status
  if (userInst.connection_status !== 'open') {
    return 'disconnected';
  }

  // P9: Check trial/subscription
  const subPlan = userInst.subscription_plan;
  const trialEnd = userInst.trial_ends_at;
  // 'beta' is the synthetic free-beta plan (app/lib/billing.ts): it must count
  // as paying here — beta users' trial_ends_at is typically months in the past,
  // so falling through to the trial branch would pause every beta message.
  const isPaying = subPlan === 'personal' || subPlan === 'professional' || subPlan === 'business' || subPlan === 'beta';
  // 'free' is the TERMINAL post-trial tier: its trial_ends_at is always in the
  // past (that's how the user became free), so gating it on the trial window
  // would (and did) pause every Free user forever and make the 3/day branch
  // dead code. Free must return 'send' here; its 3-msg/day allowance is enforced
  // downstream by claim_daily_quota (dailyLimit=3) + the daily-limit pre-check
  // in send-messages. 'trial_expired' is reserved for an actual 'trial' (or
  // unknown/empty legacy plan) whose trial date is expired or missing.
  if (!isPaying && subPlan !== 'free') {
    const trialExpiredAt = trialEnd ? new Date(trialEnd) : null;
    if (!trialExpiredAt || trialExpiredAt < new Date()) {
      return 'trial_expired';
    }
  }

  return 'send';
}

/**
 * Computes the rescheduled time for a disconnected instance (tomorrow same time).
 */
export function rescheduleTomorrow(scheduledAt: string): string {
  const tomorrow = new Date(scheduledAt);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString();
}

/**
 * Short retry: pushes scheduled_at forward by N minutes (default 5).
 * Used by the smart-retry path when an instance is briefly disconnected —
 * gives the user a chance to reconnect within the hour before the message
 * gets deferred to next day. Also used for cool-down (30min default override)
 * so a "3 msg / 24h" cap doesn't punish the next message with a 24h shift.
 */
export function rescheduleSoon(scheduledAt: string, minutes: number = 5): string {
  const next = new Date(scheduledAt);
  next.setMinutes(next.getMinutes() + minutes);
  return next.toISOString();
}

/**
 * Anti-ban jitter: shifts a scheduled_at timestamp by a random offset in
 * [0, maxJitterMs]. Two messages from the same user that share an identical
 * timestamp (e.g. "Convocazione 18:00" sent to 5 contacts) get distributed
 * across the jitter window, breaking the burst pattern that triggers
 * WhatsApp/Baileys rate limiting on the sender's personal number.
 *
 * Default 15s is below the 5-minute cron polling window (so the next cron
 * still picks the message up on time) and below user-perceptible delay for
 * the ICP-D use case (reminders, convocations).
 */
export function applyJitter(scheduledAt: string, maxJitterMs = 15_000): string {
  const base = new Date(scheduledAt).getTime();
  const offset = Math.floor(Math.random() * (maxJitterMs + 1));
  return new Date(base + offset).toISOString();
}

export interface RequeueUpdate {
  status: 'pending' | 'failed';
  // ALWAYS null on a requeue. A row that previously reached the send path has a
  // stale send_attempted_at; leaving it set lets the stale-'processing' recovery
  // (send-messages:156-165) mis-mark the NEXT attempt 'sent' without sending it.
  send_attempted_at: null;
  retry_count?: number;
  error_message?: string;
  scheduled_at?: string;
}

/**
 * Update payload to release a message locked to 'processing' back to 'pending'
 * when the atomic quota claim fails. Clears send_attempted_at (see RequeueUpdate).
 */
export function buildQuotaRequeueUpdate(): RequeueUpdate {
  return { status: 'pending', send_attempted_at: null };
}

/**
 * Update payload for a failed send attempt. retry < 3 → back to 'pending'
 * (rescheduled +retry*5min from now); retry >= 3 → terminal 'failed' keeping the
 * original scheduled_at. Always clears send_attempted_at (see RequeueUpdate).
 */
export function buildFailureRequeueUpdate(args: {
  newRetryCount: number;
  errorMessage: string;
  originalScheduledAt: string;
  now: number;
}): RequeueUpdate {
  const terminal = args.newRetryCount >= 3;
  return {
    status: terminal ? 'failed' : 'pending',
    retry_count: args.newRetryCount,
    error_message: args.errorMessage,
    scheduled_at: terminal
      ? args.originalScheduledAt
      : new Date(args.now + args.newRetryCount * 5 * 60 * 1000).toISOString(),
    send_attempted_at: null,
  };
}

/**
 * Atomic point-of-no-return claim for the actual Evolution send.
 *
 * `send_attempted_at` flips null -> now() exactly once per attempt (it is reset to
 * null on every requeue — see RequeueUpdate), so this conditional UPDATE has
 * exactly ONE winner even if two concurrent cron invocations both passed the
 * upstream status='processing' CAS. That CAS empirically leaked in prod
 * (2026-06-22 double-delivery: two triggers fired at :00, both claimed, both sent);
 * this gate is the real safety net because it sits AFTER the random jitter, so the
 * two invocations reach it staggered and the DB serializes them cleanly.
 *
 * Returns true iff THIS invocation won the claim and may send. false => a
 * concurrent invocation already owns this send; the caller MUST skip without
 * re-sending AND refund the quota slot it claimed pre-send (both invocations
 * incremented messages_sent_today, only the winner delivers).
 */
export async function claimSendAttempt(supabase: SupabaseClient, msgId: string): Promise<boolean> {
  const { data } = await supabase
    .from('scheduled_messages')
    .update({ send_attempted_at: new Date().toISOString() })
    .eq('id', msgId)
    .is('send_attempted_at', null)
    .select('id');
  return Array.isArray(data) && data.length > 0;
}
