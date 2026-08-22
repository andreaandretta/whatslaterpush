/**
 * AES-256-GCM encryption for the Google Calendar refresh token at rest.
 *
 * Payload format: base64(iv):base64(tag):base64(ciphertext). Key comes from
 * CALENDAR_TOKEN_SECRET (64 hex chars = 32 bytes, `openssl rand -hex 32`).
 * Fail-loud on missing/malformed env or tampered payloads — a silent fallback
 * here would either store a token in the clear or feed garbage to Google.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16;

function getKey(): Buffer {
  const hex = process.env.CALENDAR_TOKEN_SECRET;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'CALENDAR_TOKEN_SECRET must be 64 hex chars (32 bytes — generate with `openssl rand -hex 32`)'
    );
  }
  return Buffer.from(hex, 'hex');
}

export function encryptToken(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('encryptToken: plaintext must be a non-empty string');
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptToken(payload: string): string {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new Error('decryptToken: payload must be a non-empty string');
  }
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('decryptToken: malformed payload (expected iv:tag:ciphertext)');
  }
  const [iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, 'base64'));
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) {
    throw new Error('decryptToken: malformed payload (bad iv/tag/ciphertext length)');
  }
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  // GCM auth failure (tampered ciphertext/tag or wrong key) throws here.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
