/**
 * Calendar sync — AES-256-GCM crypto for the Google refresh token at rest.
 * Payload: base64(iv):base64(tag):base64(ciphertext), key from
 * CALENDAR_TOKEN_SECRET (64 hex chars). Fail-loud on bad env or tampering.
 */
import { encryptToken, decryptToken } from '../app/lib/calendar-crypto';

const SECRET = 'a'.repeat(64); // 64 hex chars = 32 bytes

const ORIGINAL_ENV = process.env;
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, CALENDAR_TOKEN_SECRET: SECRET };
});
afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('calendar-crypto', () => {
  test('roundtrip: decrypt(encrypt(x)) === x', () => {
    const token = '1//0gABCDEF-google-refresh-token_xyz';
    const payload = encryptToken(token);
    expect(payload).not.toContain(token);
    expect(payload.split(':')).toHaveLength(3);
    expect(decryptToken(payload)).toBe(token);
  });

  test('random IV: same plaintext → different payloads, both decryptable', () => {
    const a = encryptToken('same-token');
    const b = encryptToken('same-token');
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('same-token');
    expect(decryptToken(b)).toBe('same-token');
  });

  test('tampered ciphertext → throws (GCM auth)', () => {
    const payload = encryptToken('secret-token');
    const [iv, tag, ct] = payload.split(':');
    const buf = Buffer.from(ct, 'base64');
    buf[0] ^= 0xff;
    const tampered = `${iv}:${tag}:${buf.toString('base64')}`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  test('tampered tag → throws', () => {
    const payload = encryptToken('secret-token');
    const [iv, tag, ct] = payload.split(':');
    const buf = Buffer.from(tag, 'base64');
    buf[0] ^= 0xff;
    expect(() => decryptToken(`${iv}:${buf.toString('base64')}:${ct}`)).toThrow();
  });

  test('wrong key → throws', () => {
    const payload = encryptToken('secret-token');
    process.env.CALENDAR_TOKEN_SECRET = 'b'.repeat(64);
    expect(() => decryptToken(payload)).toThrow();
  });

  test('malformed payload → throws', () => {
    expect(() => decryptToken('not-a-payload')).toThrow(/malformed/);
    expect(() => decryptToken('a:b')).toThrow(/malformed/);
    expect(() => decryptToken('')).toThrow();
  });

  test('missing env → encrypt AND decrypt throw (fail-loud)', () => {
    const payload = encryptToken('x');
    delete process.env.CALENDAR_TOKEN_SECRET;
    expect(() => encryptToken('x')).toThrow(/CALENDAR_TOKEN_SECRET/);
    expect(() => decryptToken(payload)).toThrow(/CALENDAR_TOKEN_SECRET/);
  });

  test('malformed env (short / non-hex) → throws', () => {
    process.env.CALENDAR_TOKEN_SECRET = 'abc123'; // too short
    expect(() => encryptToken('x')).toThrow(/CALENDAR_TOKEN_SECRET/);
    process.env.CALENDAR_TOKEN_SECRET = 'z'.repeat(64); // not hex
    expect(() => encryptToken('x')).toThrow(/CALENDAR_TOKEN_SECRET/);
  });

  test('empty plaintext → throws', () => {
    expect(() => encryptToken('')).toThrow();
  });
});
