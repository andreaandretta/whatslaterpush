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
  free:         { dailyLimit: 3,  maxContacts: 10,     maxRetry: 1, historyDays: 7,  customLabels: false },
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

export type PaidPlan = 'personal' | 'professional' | 'business';
export interface StripePriceMap { personal?: string; professional?: string; business?: string }

/**
 * Reverse-maps a Stripe price id back to its plan name (the forward map lives in
 * create-checkout's PRICE_IDS env vars). Returns null for an unknown/missing price
 * — the caller treats null as "do not change the stored plan".
 */
export function planFromStripePrice(priceId: string | null | undefined, priceMap: StripePriceMap): PaidPlan | null {
  // Guard first: a missing price id must never match an unconfigured (undefined)
  // price slot via undefined === undefined.
  if (!priceId) return null;
  if (priceId === priceMap.personal) return 'personal';
  if (priceId === priceMap.professional) return 'professional';
  if (priceId === priceMap.business) return 'business';
  return null;
}

/**
 * The plan a subscription should map to, from its Stripe status + active price:
 *  - active/trialing/past_due -> the tier implied by the price. past_due is a
 *    GRACE state: Stripe keeps retrying a failed charge for days, and downgrading
 *    a recoverable blip would pause a paying user's operational reminders. We keep
 *    the tier and only drop when the subscription truly ends. (null if the price
 *    is unrecognized: caller must NOT clobber the stored plan on a mis-config.)
 *  - canceled/unpaid -> 'free' (the subscription has actually ended / exhausted
 *    dunning; the paying relationship is over).
 *  - any other status (incomplete/incomplete_expired/paused/unknown) -> null
 *    (indeterminate, leave the stored plan unchanged).
 */
export function resolveSubscriptionPlan(
  status: string,
  priceId: string | null | undefined,
  priceMap: StripePriceMap
): PaidPlan | 'free' | null {
  if (status === 'canceled' || status === 'unpaid') {
    return 'free';
  }
  if (status === 'active' || status === 'trialing' || status === 'past_due') {
    return planFromStripePrice(priceId, priceMap);
  }
  return null;
}
