/**
 * Pure utility functions extracted from cron/send-messages for testability.
 */

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
  const isPaying = subPlan === 'personal' || subPlan === 'professional' || subPlan === 'business';
  // 'free' is the TERMINAL post-trial tier: its trial_ends_at is always in the
  // past (that's how the user became free), so gating it on the trial window
  // would (and did) pause every Free user forever and make the 3/day branch
  // dead code. Free must return 'send' here; its 3-msg/day allowance is enforced
  // downstream by claim_daily_quota (dailyLimit=3) + the line-329 pre-check.
  // 'trial_expired' is reserved for an actual 'trial' (or unknown/empty legacy
  // plan) whose trial date is expired or missing.
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
