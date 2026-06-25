/**
 * Unit tests for app/lib/monitoring-filters.ts — test-instance detection.
 * Pre-launch noise suppression: instances belonging to the operator's own test
 * phones must be excluded from every monitoring check.
 */

import { isTestInstance, getTestPrefixes } from '../app/lib/monitoring-filters';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // Restore only the vars we touch so other suites are unaffected.
  delete process.env.MONITORING_TEST_PREFIXES;
  delete process.env.MONITORING_TEST_INSTANCES;
  delete process.env.MONITORING_TEST_NUMBERS;
  process.env.MONITORING_TEST_PREFIXES = ORIGINAL_ENV.MONITORING_TEST_PREFIXES;
  process.env.MONITORING_TEST_INSTANCES = ORIGINAL_ENV.MONITORING_TEST_INSTANCES;
  process.env.MONITORING_TEST_NUMBERS = ORIGINAL_ENV.MONITORING_TEST_NUMBERS;
});

describe('isTestInstance — default wltest prefix', () => {
  test('matches wltest* by default (no env set)', () => {
    delete process.env.MONITORING_TEST_PREFIXES;
    expect(isTestInstance('wltest-1')).toBe(true);
    expect(isTestInstance('WLTEST-uppercase')).toBe(true);
    expect(isTestInstance('wltest')).toBe(true);
  });

  test('does NOT match a real SchedWhats instance by default', () => {
    delete process.env.MONITORING_TEST_NUMBERS;
    delete process.env.MONITORING_TEST_INSTANCES;
    expect(isTestInstance('SchedWhats-393331112233', '393331112233')).toBe(false);
  });

  test('default prefixes always include wltest even when extra prefixes are configured', () => {
    process.env.MONITORING_TEST_PREFIXES = 'demo-,sandbox-';
    expect(getTestPrefixes()).toEqual(expect.arrayContaining(['demo-', 'sandbox-', 'wltest']));
    expect(isTestInstance('demo-42')).toBe(true);
    expect(isTestInstance('wltest-7')).toBe(true);
  });
});

describe('isTestInstance — MONITORING_TEST_NUMBERS (covers SchedWhats-<phone>)', () => {
  test('matches an instance whose embedded number is listed', () => {
    process.env.MONITORING_TEST_NUMBERS = '393780311526, 393780311599';
    expect(isTestInstance('SchedWhats-393780311526', '393780311526')).toBe(true);
    expect(isTestInstance('SchedWhats-393780311599')).toBe(true);
  });

  test('accepts numbers in any format (digits-only normalisation)', () => {
    process.env.MONITORING_TEST_NUMBERS = '+39 378 0311526';
    expect(isTestInstance('SchedWhats-393780311526', '393780311526')).toBe(true);
  });

  test('matches via owner phone even if name has no digits', () => {
    process.env.MONITORING_TEST_NUMBERS = '393331112233';
    expect(isTestInstance('operator-instance', '393331112233')).toBe(true);
  });

  test('does not match an unrelated number', () => {
    process.env.MONITORING_TEST_NUMBERS = '393780311526';
    expect(isTestInstance('SchedWhats-393331112233', '393331112233')).toBe(false);
  });

  test('ignores short fragments (<7 digits) to avoid colliding with real users', () => {
    process.env.MONITORING_TEST_NUMBERS = '1526';
    // A real user whose number merely ends in 1526 must NOT be muted.
    expect(isTestInstance('SchedWhats-393331111526', '393331111526')).toBe(false);
  });

  test('uses suffix/exact match, not arbitrary substring (no mid-number collision)', () => {
    process.env.MONITORING_TEST_NUMBERS = '3780311526';
    // 3780311526 appears in the MIDDLE of this real number, not as a suffix → no match.
    expect(isTestInstance('SchedWhats-393780311526999', '393780311526999')).toBe(false);
    // …but a genuine suffix match is caught.
    expect(isTestInstance('SchedWhats-393780311526', '393780311526')).toBe(true);
  });
});

describe('isTestInstance — MONITORING_TEST_INSTANCES (exact names)', () => {
  test('matches an exact instance name (case-insensitive)', () => {
    process.env.MONITORING_TEST_INSTANCES = 'SchedWhats-ABANDONED, operator-main';
    expect(isTestInstance('schedwhats-abandoned')).toBe(true);
    expect(isTestInstance('operator-main')).toBe(true);
    expect(isTestInstance('SchedWhats-realuser')).toBe(false);
  });
});

describe('isTestInstance — edge cases', () => {
  test('empty / null inputs are not test instances', () => {
    delete process.env.MONITORING_TEST_NUMBERS;
    expect(isTestInstance(null, null)).toBe(false);
    expect(isTestInstance('', '')).toBe(false);
    expect(isTestInstance(undefined)).toBe(false);
  });
});
