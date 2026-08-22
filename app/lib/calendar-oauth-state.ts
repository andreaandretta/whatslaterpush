/**
 * OAuth `state` parameter for the Google Calendar connect flow.
 *
 * HMAC-signed JSON {n, ts} keyed by AUTH_COOKIE_SECRET (same primitives as the
 * session cookie — hmac.ts, Web Crypto, base64url). The state is a pure
 * anti-CSRF nonce: bad signature or age > 10 min → reject. The USER IDENTITY
 * deliberately does NOT travel in the state (review LOW #2): the phone would
 * transit Google, browser history and access logs in clear-decodable base64.
 * The callback takes the identity from the sw_session cookie instead
 * (review LOW #3 — the middleware already requires it on that path).
 */
import { signPayload, verifySignature, b64urlEncode, b64urlDecode } from './hmac';

export const STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  n: string;  // random nonce — no identity, no meaning
  ts: number; // epoch ms at signing time
}

function getSecret(): string {
  const s = process.env.AUTH_COOKIE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('AUTH_COOKIE_SECRET not set or too short (need 32+ chars)');
  }
  return s;
}

export async function signOAuthState(now: Date = new Date()): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  const payload: OAuthStatePayload = {
    n: Array.from(nonce, (b) => b.toString(16).padStart(2, '0')).join(''),
    ts: now.getTime(),
  };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await signPayload(payloadB64, getSecret());
  return `${payloadB64}.${sig}`;
}

export async function verifyOAuthState(
  raw: string | null | undefined,
  now: Date = new Date()
): Promise<boolean> {
  if (!raw || typeof raw !== 'string') return false;
  const parts = raw.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;

  let secret: string;
  try {
    secret = getSecret();
  } catch {
    return false;
  }

  const valid = await verifySignature(payloadB64, sigB64, secret);
  if (!valid) return false;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return false;
  }
  if (typeof payload?.n !== 'string' || typeof payload?.ts !== 'number') return false;

  const age = now.getTime() - payload.ts;
  if (age > STATE_TTL_MS) return false; // stale → replay risk, reject
  if (age < -60 * 1000) return false;   // future-dated beyond clock-skew tolerance
  return true;
}
