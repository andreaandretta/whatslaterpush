// Reusable HMAC-SHA256 utilities backed by the Web Crypto API (works on
// Edge runtime + Node 16+). Constant-time comparison via XOR-and-diff.
// Output is base64url-encoded (URL/cookie-safe, no padding).
//
// Used by:
//   - app/lib/auth-cookie.ts to sign session cookies (sw_session)
//   - app/api/webhook/route.ts to verify inbound Evolution webhook bodies
// Caller passes any string body and secret. Empty inputs are still hashable —
// callers should reject empty secrets upstream if that's a security concern.

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  return globalThis.crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Returns base64url-encoded HMAC-SHA256 of `body` keyed by `secret`.
export async function signPayload(body: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return b64urlEncode(new Uint8Array(sig));
}

// Verifies `signature` against HMAC-SHA256(body, secret) using constant-time
// compare. Accepts the same base64url format produced by signPayload.
// Returns false on any decode/length mismatch — never throws.
export async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  if (typeof signature !== 'string' || signature.length === 0) return false;

  let provided: Uint8Array;
  try {
    provided = b64urlDecode(signature);
  } catch {
    return false;
  }

  let key: CryptoKey;
  try {
    key = await importHmacKey(secret);
  } catch {
    return false;
  }

  const expectedBuffer = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return timingSafeEqualBytes(provided, new Uint8Array(expectedBuffer));
}

// Re-export base64url helpers so auth-cookie.ts (which encodes its payload
// before signing) can share them without duplicating the implementations.
export { b64urlEncode, b64urlDecode };
