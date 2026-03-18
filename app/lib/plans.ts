export interface PlanLimits {
  dailyLimit: number;
  maxContacts: number;
  maxRetry: number;
  historyDays: number;
}

const PLANS: Record<string, PlanLimits> = {
  trial:    { dailyLimit: 20, maxContacts: 50,     maxRetry: 3, historyDays: 30 },
  free:     { dailyLimit: 3,  maxContacts: 5,      maxRetry: 1, historyDays: 7  },
  personal: { dailyLimit: 20, maxContacts: 50,     maxRetry: 3, historyDays: 30 },
  business: { dailyLimit: 50, maxContacts: 999999, maxRetry: 3, historyDays: 90 },
};

const FREE = PLANS.free;

export function getPlanLimits(plan: string): PlanLimits {
  return PLANS[plan] || FREE;
}

const PLAN_NAMES: Record<string, string> = {
  trial: 'Trial',
  free: 'Free',
  personal: 'Personal',
  business: 'Business',
};

export function getPlanName(plan: string): string {
  return PLAN_NAMES[plan] || 'Free';
}
