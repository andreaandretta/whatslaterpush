import { isBillingEnabled, getEffectivePlan, BETA_PLAN } from '../app/lib/billing';
import { getPlanLimits, getPlanName } from '../app/lib/plans';

// Beta gratuita kill-switch (decision 2026-07-07). The env is read at CALL
// time (never at import time), so tests can flip it per-case. Contract under
// test is the reactivation guarantee: env deleted → billing enforced.
const ORIGINAL = process.env.BILLING_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BILLING_ENABLED;
  else process.env.BILLING_ENABLED = ORIGINAL;
});

describe('isBillingEnabled', () => {
  test('env UNSET -> billing enforced (the safe default; reactivation = delete the var)', () => {
    delete process.env.BILLING_ENABLED;
    expect(isBillingEnabled()).toBe(true);
  });

  test("'false' -> billing disabled (beta mode)", () => {
    process.env.BILLING_ENABLED = 'false';
    expect(isBillingEnabled()).toBe(false);
  });

  test("'true' -> billing enforced", () => {
    process.env.BILLING_ENABLED = 'true';
    expect(isBillingEnabled()).toBe(true);
  });

  test("typos and non-exact values ('FALSE', '0', 'off') -> billing enforced (exact-string idiom)", () => {
    for (const v of ['FALSE', '0', 'off', ' false']) {
      process.env.BILLING_ENABLED = v;
      expect(isBillingEnabled()).toBe(true);
    }
  });
});

describe('getEffectivePlan', () => {
  describe('billing ON: raw plan passes through untouched', () => {
    test('each stored plan resolves to itself', () => {
      delete process.env.BILLING_ENABLED;
      for (const plan of ['trial', 'free', 'personal', 'professional', 'business']) {
        expect(getEffectivePlan(plan)).toBe(plan);
      }
    });

    test("null/undefined/empty -> 'free' (same fallback the call sites use today)", () => {
      delete process.env.BILLING_ENABLED;
      expect(getEffectivePlan(null)).toBe('free');
      expect(getEffectivePlan(undefined)).toBe('free');
      expect(getEffectivePlan('')).toBe('free');
    });
  });

  describe('billing OFF: everyone resolves to the synthetic beta plan', () => {
    test('every raw plan (and null) resolves to BETA_PLAN', () => {
      process.env.BILLING_ENABLED = 'false';
      for (const plan of ['trial', 'free', 'personal', 'professional', 'business', '', null, undefined] as const) {
        expect(getEffectivePlan(plan as any)).toBe(BETA_PLAN);
      }
    });
  });
});

describe('beta plan wiring (the silent-fallback trap)', () => {
  // getPlanLimits falls back to FREE for unknown keys (plans.ts): if 'beta'
  // were not registered in PLANS, beta mode would silently cap everyone at
  // 3 msg/day — the exact opposite of the intent, with no error anywhere.
  // These tests lock the wiring end-to-end.
  test('effective plan under beta resolves to the REAL beta limits, not the free fallback', () => {
    process.env.BILLING_ENABLED = 'false';
    const limits = getPlanLimits(getEffectivePlan('free'));
    expect(limits.dailyLimit).toBe(50);
    expect(limits.maxContacts).toBe(300);
    expect(limits.maxRetry).toBe(3);
    expect(limits.historyDays).toBe(90);
    expect(limits.customLabels).toBe(true);
  });

  test("getPlanName under beta -> 'Beta gratuita' (not the 'Free' fallback)", () => {
    process.env.BILLING_ENABLED = 'false';
    expect(getPlanName(getEffectivePlan('personal'))).toBe('Beta gratuita');
  });
});
