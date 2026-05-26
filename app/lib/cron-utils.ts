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
  if (!isPaying) {
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
