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
  test('sign then verify returns the same payload', async () => {
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const payload = await verifyCookie(cookie);
    expect(payload).not.toBeNull();
    expect(payload!.phone).toBe('393331234567');
    expect(payload!.instanceName).toBe('SchedWhats-393331234567');
    expect(payload!.iat).toBeGreaterThan(0);
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  test('exp is iat + 90 days', async () => {
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'SchedWhats-393331234567' });
    const p = (await verifyCookie(cookie))!;
    expect(p.exp - p.iat).toBe(90 * 24 * 60 * 60);
  });
});

describe('verifyCookie security', () => {
  test('returns null for tampered payload', async () => {
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'X' });
    const [, sig] = cookie.split('.');
    const tamperedPayload = Buffer.from('{"phone":"VICTIM","instanceName":"X","iat":1,"exp":9999999999}').toString('base64url');
    expect(await verifyCookie(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  test('returns null for tampered signature', async () => {
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'X' });
    const [payload, sig] = cookie.split('.');
    const tamperedSig = sig.slice(0, -2) + 'AA';
    expect(await verifyCookie(`${payload}.${tamperedSig}`)).toBeNull();
  });

  test('returns null for malformed cookie (no dot)', async () => {
    expect(await verifyCookie('justgarbage')).toBeNull();
  });

  test('returns null for empty/undefined cookie', async () => {
    expect(await verifyCookie('')).toBeNull();
    expect(await verifyCookie(undefined)).toBeNull();
  });

  test('returns null for expired cookie', async () => {
    const expiredPayload = JSON.stringify({ phone: '393331234567', instanceName: 'X', iat: 1000, exp: 2000 });
    const payloadB64 = Buffer.from(expiredPayload).toString('base64url');
    const key = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    const sigB64 = Buffer.from(new Uint8Array(sigBuf)).toString('base64url');
    expect(await verifyCookie(`${payloadB64}.${sigB64}`)).toBeNull();
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
  test('throws if AUTH_COOKIE_SECRET missing', async () => {
    delete process.env.AUTH_COOKIE_SECRET;
    await expect(signCookie({ phone: 'X', instanceName: 'X' })).rejects.toThrow(/AUTH_COOKIE_SECRET/);
  });
});
