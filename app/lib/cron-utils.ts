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
