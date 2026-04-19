import crypto from 'crypto';

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

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function b64urlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

export function signCookie(input: { phone: string; instanceName: string }): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthCookiePayload = {
    phone: input.phone,
    instanceName: input.instanceName,
    iat: now,
    exp: now + COOKIE_TTL_SECONDS,
  };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export function verifyCookie(raw: string | undefined): AuthCookiePayload | null {
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
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  let provided: Buffer;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(provided, expected)) return null;

  let payload: AuthCookiePayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
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
