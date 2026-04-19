export interface AuthCookiePayload {
  phone: string;
  instanceName: string;
  iat: number;
  exp: number;
}

const COOKIE_TTL_SECONDS = 90 * 24 * 60 * 60;
const REFRESH_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;

function getSecret(): string {
  const s = process.env.AUTH_COOKIE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUTH_COOKIE_SECRET not set or too short (need 32+ chars)');
  }
  return s;
}

// base64url helpers using built-in atob/btoa (available on Edge + Node 16+)
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

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder().encode(secret);
  return globalThis.crypto.subtle.importKey('raw', enc, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

// Constant-time compare for two Uint8Arrays of equal length
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signCookie(input: { phone: string; instanceName: string }): Promise<string> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthCookiePayload = {
    phone: input.phone,
    instanceName: input.instanceName,
    iat: now,
    exp: now + COOKIE_TTL_SECONDS,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = b64urlEncode(payloadBytes);

  const key = await getHmacKey(secret);
  const sigBuffer = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const sig = new Uint8Array(sigBuffer);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export async function verifyCookie(raw: string | undefined): Promise<AuthCookiePayload | null> {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return null;
  }

  let providedSig: Uint8Array;
  try {
    providedSig = b64urlDecode(sigB64);
  } catch {
    return null;
  }

  let key: CryptoKey;
  try {
    key = await getHmacKey(secret);
  } catch {
    return null;
  }

  const expectedBuffer = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  const expectedSig = new Uint8Array(expectedBuffer);

  if (!timingSafeEqualBytes(providedSig, expectedSig)) return null;

  let payload: AuthCookiePayload;
  try {
    const payloadBytes = b64urlDecode(payloadB64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (
    typeof payload?.phone !== 'string' ||
    typeof payload?.instanceName !== 'string' ||
    typeof payload?.iat !== 'number' ||
    typeof payload?.exp !== 'number'
  ) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;
  return payload;
}

export function shouldRefresh(payload: AuthCookiePayload): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - payload.iat > REFRESH_THRESHOLD_SECONDS;
}

export const AUTH_COOKIE_NAME = 'sw_session';
export const AUTH_COOKIE_MAX_AGE = COOKIE_TTL_SECONDS;
