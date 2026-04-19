import { signCookie, verifyCookie, shouldRefresh } from '../app/lib/auth-cookie';

const SECRET = '0'.repeat(128);
const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, AUTH_COOKIE_SECRET: SECRET };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('signCookie + verifyCookie round-trip', () => {
  test('sign then verify returns the same payload', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const payload = verifyCookie(cookie);
    expect(payload).not.toBeNull();
    expect(payload!.phone).toBe('393331234567');
    expect(payload!.instanceName).toBe('SchedWhats-393331234567');
    expect(payload!.iat).toBeGreaterThan(0);
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  test('exp is iat + 90 days', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const p = verifyCookie(cookie)!;
    expect(p.exp - p.iat).toBe(90 * 24 * 60 * 60);
  });
});

describe('verifyCookie security', () => {
  test('returns null for tampered payload', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'X' });
    const [, sig] = cookie.split('.');
    const tamperedPayload = Buffer.from('{"phone":"VICTIM","instanceName":"X","iat":1,"exp":9999999999}').toString('base64url');
    expect(verifyCookie(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  test('returns null for tampered signature', () => {
    const cookie = signCookie({ phone: '393331234567', instanceName: 'X' });
    const [payload, sig] = cookie.split('.');
    const tamperedSig = sig.slice(0, -2) + 'AA';
    expect(verifyCookie(`${payload}.${tamperedSig}`)).toBeNull();
  });

  test('returns null for malformed cookie (no dot)', () => {
    expect(verifyCookie('justgarbage')).toBeNull();
  });

  test('returns null for empty/undefined cookie', () => {
    expect(verifyCookie('')).toBeNull();
    expect(verifyCookie(undefined)).toBeNull();
  });

  test('returns null for expired cookie', () => {
    const expiredPayload = Buffer.from(JSON.stringify({
      phone: '393331234567',
      instanceName: 'X',
      iat: 1000,
      exp: 2000,
    })).toString('base64url');
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', SECRET).update(expiredPayload).digest('base64url');
    expect(verifyCookie(`${expiredPayload}.${sig}`)).toBeNull();
  });
});

describe('shouldRefresh', () => {
  test('returns true if iat older than 7 days', () => {
    const oldIat = Math.floor(Date.now() / 1000) - (8 * 24 * 60 * 60);
    expect(shouldRefresh({ phone: 'X', instanceName: 'X', iat: oldIat, exp: oldIat + 9999999 })).toBe(true);
  });

  test('returns false if iat fresh', () => {
    const freshIat = Math.floor(Date.now() / 1000) - 60;
    expect(shouldRefresh({ phone: 'X', instanceName: 'X', iat: freshIat, exp: freshIat + 9999999 })).toBe(false);
  });
});

describe('signCookie env requirement', () => {
  test('throws if AUTH_COOKIE_SECRET missing', () => {
    delete process.env.AUTH_COOKIE_SECRET;
    expect(() => signCookie({ phone: 'X', instanceName: 'X' })).toThrow(/AUTH_COOKIE_SECRET/);
  });
});
