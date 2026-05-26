import { signPayload, verifySignature, b64urlEncode, b64urlDecode } from '../app/lib/hmac';

const SECRET = 'top-secret-32-chars-or-more-please';
const ALT_SECRET = 'a-different-secret-also-long-enough';

describe('signPayload', () => {
  test('returns deterministic output for identical body+secret', async () => {
    const a = await signPayload('hello world', SECRET);
    const b = await signPayload('hello world', SECRET);
    expect(a).toBe(b);
  });

  test('produces base64url output (no padding, no +/)', async () => {
    const sig = await signPayload('any body', SECRET);
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sig).not.toContain('=');
    expect(sig).not.toContain('+');
    expect(sig).not.toContain('/');
  });

  test('different bodies → different signatures', async () => {
    const a = await signPayload('body one', SECRET);
    const b = await signPayload('body two', SECRET);
    expect(a).not.toBe(b);
  });

  test('different secrets → different signatures', async () => {
    const a = await signPayload('same body', SECRET);
    const b = await signPayload('same body', ALT_SECRET);
    expect(a).not.toBe(b);
  });

  test('handles empty body without throwing', async () => {
    const sig = await signPayload('', SECRET);
    expect(typeof sig).toBe('string');
    expect(sig.length).toBeGreaterThan(0);
  });
});

describe('verifySignature', () => {
  test('returns true for a freshly signed body (round trip)', async () => {
    const body = '{"event":"messages.upsert","data":{"x":1}}';
    const sig = await signPayload(body, SECRET);
    expect(await verifySignature(body, sig, SECRET)).toBe(true);
  });

  test('returns false when body is tampered', async () => {
    const sig = await signPayload('original', SECRET);
    expect(await verifySignature('tampered', sig, SECRET)).toBe(false);
  });

  test('returns false when signature is tampered', async () => {
    const sig = await signPayload('body', SECRET);
    const tampered = sig.slice(0, -3) + 'AAA';
    expect(await verifySignature('body', tampered, SECRET)).toBe(false);
  });

  test('returns false with wrong secret', async () => {
    const sig = await signPayload('body', SECRET);
    expect(await verifySignature('body', sig, ALT_SECRET)).toBe(false);
  });

  test('returns false for empty signature', async () => {
    expect(await verifySignature('body', '', SECRET)).toBe(false);
  });

  test('returns false for non-base64url garbage signature without throwing', async () => {
    expect(await verifySignature('body', '!!!not-valid-b64url!!!', SECRET)).toBe(false);
  });

  test('returns false for length mismatch (different short signatures)', async () => {
    // A signature of completely different length from HMAC-SHA256 (~43 chars b64url)
    // must be rejected before any timing-sensitive comparison.
    expect(await verifySignature('body', 'AAAA', SECRET)).toBe(false);
  });
});

describe('signCookie back-compat (auth-cookie still produces valid signed format)', () => {
  // Smoke test: confirms the refactor didn't change the on-the-wire cookie
  // format. Detailed cookie tests live in auth-cookie.test.ts.
  test('cookie is "<payloadB64>.<sigB64>" and verifies with the same secret', async () => {
    process.env.AUTH_COOKIE_SECRET = '0'.repeat(128);
    const { signCookie, verifyCookie } = await import('../app/lib/auth-cookie');
    const cookie = await signCookie({ phone: '393331234567', instanceName: 'X' });
    expect(cookie.split('.').length).toBe(2);
    const payload = await verifyCookie(cookie);
    expect(payload).not.toBeNull();
    expect(payload!.phone).toBe('393331234567');
  });
});

describe('b64url helpers', () => {
  test('encode then decode is identity for ASCII', () => {
    const original = new TextEncoder().encode('Hello, World!');
    const decoded = b64urlDecode(b64urlEncode(original));
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  test('handles bytes that would produce + and / in standard base64', () => {
    // Bytes designed to yield + and / in standard base64; b64url must replace them.
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xfb, 0xef, 0xee]);
    const encoded = b64urlEncode(bytes);
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(Array.from(b64urlDecode(encoded))).toEqual(Array.from(bytes));
  });
});
