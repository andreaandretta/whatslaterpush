import { getPlanLimits, getPlanName } from '../app/lib/plans';

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
    expect(limits.maxContacts).toBe(5);
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

  test('unknown plan falls back to free (no customLabels)', () => {
    expect(getPlanLimits('unknown').customLabels).toBe(false);
  });
});
