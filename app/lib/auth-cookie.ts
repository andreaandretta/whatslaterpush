import { signPayload, verifySignature, b64urlDecode, b64urlEncode } from './hmac';

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
  const sig = await signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
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

  const valid = await verifySignature(payloadB64, sigB64, secret);
  if (!valid) return null;

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
