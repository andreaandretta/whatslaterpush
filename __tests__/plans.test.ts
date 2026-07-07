import { getPlanLimits, getPlanName, planFromStripePrice, resolveSubscriptionPlan } from '../app/lib/plans';

// FIX 4: Stripe price->plan reverse mapping + subscription-status->plan decision.
// These are the pure core of the webhook's tier sync; the webhook wiring that
// uses them is integration-tested in payment-webhook.integration.test.ts.
const PRICES = { personal: 'price_pers', professional: 'price_prof', business: 'price_biz' };

describe('planFromStripePrice', () => {
  test('maps each known price id to its plan', () => {
    expect(planFromStripePrice('price_pers', PRICES)).toBe('personal');
    expect(planFromStripePrice('price_prof', PRICES)).toBe('professional');
    expect(planFromStripePrice('price_biz', PRICES)).toBe('business');
  });

  test('unknown price id -> null', () => {
    expect(planFromStripePrice('price_nope', PRICES)).toBeNull();
  });

  test('null/undefined price id -> null', () => {
    expect(planFromStripePrice(null, PRICES)).toBeNull();
    expect(planFromStripePrice(undefined, PRICES)).toBeNull();
  });

  // The footgun: an UNCONFIGURED price slot (undefined) must NOT match an
  // undefined/missing price id (undefined === undefined). Guards against
  // accidentally granting 'personal' when STRIPE_PRICE_PERSONAL is unset.
  test('undefined price id does NOT false-match an unconfigured (undefined) price slot', () => {
    expect(planFromStripePrice(undefined, { personal: undefined, professional: 'price_prof', business: 'price_biz' })).toBeNull();
  });
});

describe('resolveSubscriptionPlan', () => {
  test('active/trialing -> the tier implied by the active price', () => {
    expect(resolveSubscriptionPlan('active', 'price_pers', PRICES)).toBe('personal');
    expect(resolveSubscriptionPlan('trialing', 'price_prof', PRICES)).toBe('professional');
    expect(resolveSubscriptionPlan('active', 'price_biz', PRICES)).toBe('business');
  });

  test('past_due KEEPS the tier from the price (grace — Stripe is still retrying a recoverable blip)', () => {
    expect(resolveSubscriptionPlan('past_due', 'price_biz', PRICES)).toBe('business');
    expect(resolveSubscriptionPlan('past_due', 'price_pers', PRICES)).toBe('personal');
  });

  test('canceled / unpaid -> free (subscription truly ended / dunning exhausted)', () => {
    expect(resolveSubscriptionPlan('canceled', 'price_biz', PRICES)).toBe('free');
    expect(resolveSubscriptionPlan('unpaid', 'price_biz', PRICES)).toBe('free');
  });

  test('active with an UNKNOWN price -> null (do not clobber the stored plan on a price mis-config)', () => {
    expect(resolveSubscriptionPlan('active', 'price_nope', PRICES)).toBeNull();
  });

  test('indeterminate statuses (incomplete/incomplete_expired/paused/unknown) -> null (no change)', () => {
    expect(resolveSubscriptionPlan('incomplete', 'price_pers', PRICES)).toBeNull();
    expect(resolveSubscriptionPlan('incomplete_expired', 'price_pers', PRICES)).toBeNull();
    expect(resolveSubscriptionPlan('paused', 'price_pers', PRICES)).toBeNull();
    expect(resolveSubscriptionPlan('something_new', 'price_pers', PRICES)).toBeNull();
  });
});

describe('getPlanLimits', () => {
  test('returns trial limits (same as personal)', () => {
    const limits = getPlanLimits('trial');
    expect(limits.dailyLimit).toBe(20);
    expect(limits.maxContacts).toBe(50);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(30);
  });

  test('returns free limits', () => {
    const limits = getPlanLimits('free');
    expect(limits.dailyLimit).toBe(3);
    expect(limits.maxContacts).toBe(10);
    expect(limits.maxRetry).toBe(1);
    expect(limits.historyDays).toBe(7);
  });

  test('returns personal limits', () => {
    const limits = getPlanLimits('personal');
    expect(limits.dailyLimit).toBe(20);
    expect(limits.maxContacts).toBe(50);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(30);
  });

  test('returns professional limits', () => {
    const limits = getPlanLimits('professional');
    expect(limits.dailyLimit).toBe(35);
    expect(limits.maxContacts).toBe(200);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(60);
  });

  test('returns business limits', () => {
    const limits = getPlanLimits('business');
    expect(limits.dailyLimit).toBe(50);
    expect(limits.maxContacts).toBe(999999);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(90);
  });

  // Synthetic free-beta plan (BILLING_ENABLED=false, see app/lib/billing.ts).
  // Runtime-only: never persisted (the DB CHECK constraint rejects it).
  // dailyLimit 50 is a hard ceiling: rate-limit.ts assumes the highest tier
  // cap stays well under SPAM_THRESHOLD=100 (H11).
  test('returns beta limits (free-beta: generous but capped)', () => {
    const limits = getPlanLimits('beta');
    expect(limits.dailyLimit).toBe(50);
    expect(limits.maxContacts).toBe(300);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(90);
  });

  test('defaults to free for unknown plans', () => {
    const limits = getPlanLimits('unknown');
    expect(limits.dailyLimit).toBe(3);
  });

  test('defaults to free for empty string', () => {
    const limits = getPlanLimits('');
    expect(limits.dailyLimit).toBe(3);
  });
});

describe('getPlanName', () => {
  test('returns display name for each plan', () => {
    expect(getPlanName('free')).toBe('Free');
    expect(getPlanName('trial')).toBe('Trial');
    expect(getPlanName('personal')).toBe('Personal');
    expect(getPlanName('professional')).toBe('Professional');
    expect(getPlanName('business')).toBe('Business');
  });

  test("beta plan -> 'Beta gratuita' (must NOT hit the 'Free' fallback)", () => {
    expect(getPlanName('beta')).toBe('Beta gratuita');
  });
});

describe('customLabels flag', () => {
  test('free plan: customLabels is false', () => {
    expect(getPlanLimits('free').customLabels).toBe(false);
  });

  test('trial + paid plans: customLabels is true', () => {
    expect(getPlanLimits('trial').customLabels).toBe(true);
    expect(getPlanLimits('personal').customLabels).toBe(true);
    expect(getPlanLimits('professional').customLabels).toBe(true);
    expect(getPlanLimits('business').customLabels).toBe(true);
  });

  test('beta plan: customLabels is true (everything included during the beta)', () => {
    expect(getPlanLimits('beta').customLabels).toBe(true);
  });

  test('unknown plan falls back to free (no customLabels)', () => {
    expect(getPlanLimits('unknown').customLabels).toBe(false);
  });
});
