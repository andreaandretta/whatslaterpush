/**
 * Message status receipts, in both shapes we can receive.
 *
 * Raw Baileys:      { key: { id }, update: { status: 3 } }        (number)
 * Evolution API v2: { keyId, status: 'DELIVERY_ACK', ... }         (string)
 *
 * The webhook used to accept only numbers, so every Evolution receipt was
 * dropped and delivered_at / read_at were never written (found 21 set 2026 on
 * the first real message sent after MESSAGES_UPDATE was subscribed).
 *
 * Codes follow Baileys WAMessageStatus.
 */
export const MESSAGE_STATUS = {
  ERROR: 0,
  PENDING: 1,
  SERVER_ACK: 2,
  DELIVERY_ACK: 3,
  READ: 4,
  PLAYED: 5,
} as const;

export type MessageStatusCode = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

const BY_NAME: Record<string, MessageStatusCode> = MESSAGE_STATUS;

/** Number 0-5, numeric string, or Evolution status name (any case) → code; anything else → null. */
export function parseMessageStatus(raw: unknown): MessageStatusCode | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 && raw <= 5 ? (raw as MessageStatusCode) : null;
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  if (/^[0-5]$/.test(s)) return Number(s) as MessageStatusCode;
  return s in BY_NAME ? BY_NAME[s] : null;
}

/**
 * Pulls the WhatsApp message id, the status code and fromMe out of one update
 * item. Never throws. fromMe is null when the payload does not say.
 *
 * fromMe matters: the message id is the SAME on the sender's and the recipient's
 * side. When both numbers are connected to WhatsLater (the founder's own test
 * numbers), the RECIPIENT's instance emits { keyId: X, fromMe: false, status: 'READ' }
 * and would mark the sender's row as read for the wrong reason.
 */
export function extractStatusUpdate(upd: any): { msgId: string | null; status: MessageStatusCode | null; fromMe: boolean | null } {
  if (!upd || typeof upd !== 'object') return { msgId: null, status: null, fromMe: null };
  const id = upd?.key?.id || upd?.keyId;
  const msgId = typeof id === 'string' && id ? id : null;
  const nested = parseMessageStatus(upd?.update?.status);
  const status = nested !== null ? nested : parseMessageStatus(upd?.status);
  const rawFromMe = upd?.key?.fromMe ?? upd?.fromMe;
  const fromMe = typeof rawFromMe === 'boolean' ? rawFromMe : null;
  return { msgId, status, fromMe };
}
