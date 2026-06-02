export interface PlanLimits {
  dailyLimit: number;
  maxContacts: number;
  maxRetry: number;
  historyDays: number;
  // Custom contact labels (LabelPicker filter + LabelCreateModal). Free
  // tier gets the read-only chip-bar so legacy data stays visible, but
  // create/delete is gated to anyone on a paid (or trial) plan.
  customLabels: boolean;
}

const PLANS: Record<string, PlanLimits> = {
  trial:        { dailyLimit: 20, maxContacts: 50,     maxRetry: 3, historyDays: 30, customLabels: true  },
  free:         { dailyLimit: 3,  maxContacts: 5,      maxRetry: 1, historyDays: 7,  customLabels: false },
  personal:     { dailyLimit: 20, maxContacts: 50,     maxRetry: 3, historyDays: 30, customLabels: true  },
  professional: { dailyLimit: 35, maxContacts: 200,    maxRetry: 3, historyDays: 60, customLabels: true  },
  business:     { dailyLimit: 50, maxContacts: 999999, maxRetry: 3, historyDays: 90, customLabels: true  },
};

const FREE = PLANS.free;

export function getPlanLimits(plan: string): PlanLimits {
  return PLANS[plan] || FREE;
}

const PLAN_NAMES: Record<string, string> = {
  trial: 'Trial',
  free: 'Free',
  personal: 'Personal',
  professional: 'Professional',
  business: 'Business',
};

export function getPlanName(plan: string): string {
  return PLAN_NAMES[plan] || 'Free';
}
