// Maps the raw `error_message` the cron persists on a failed scheduled_message
// into a short, human Italian reason for the dashboard. The cron stores the
// raw Evolution failure verbatim — typically `"HTTP <code>: <body>"` (no
// structured error code; 401/403/404/429 are never parsed) — so the only place
// we can turn that into user-facing copy is here, client-side. We NEVER surface
// the raw string/code: anything unmatched falls through to a generic message.

export type MessageErrorKind = 'disconnected' | 'invalid_number' | 'rate_limited' | 'generic';

export interface MappedError {
  kind: MessageErrorKind;
  /** Short Italian reason shown under the "Non inviato" card. Never a raw code. */
  label: string;
}

const REASONS: Record<MessageErrorKind, string> = {
  disconnected: 'WhatsApp disconnesso — ricollega',
  invalid_number: 'Numero non su WhatsApp',
  rate_limited: 'Troppi invii — riprova più tardi',
  generic: 'Invio non riuscito — riprova',
};

// Order is significant: a dropped session (401/403/404, "connection closed",
// "logged out") is checked BEFORE a generic bad-request (400) so a transport/
// auth failure that happens to carry a 4xx body is never mislabelled
// "Numero non su WhatsApp" — the right remedy there is "Ricollega", not "fix the
// number". Network/timeout/5xx errors intentionally fall through to generic:
// they're our server↔Evolution link, not the user's WhatsApp pairing, so
// nudging them to reconnect would be misleading.
const DISCONNECTED = /disconness|logged out|logout|loggedout|connection (closed|terminated)|not connected|session (closed|expired)|unauthor|forbidden|reconnect|\b40[134]\b|instance[^.]*not[^.]*(found|connected)/;
const INVALID_NUMBER = /not on whatsapp|not .*registered|does(n'?t| not) exist|"?exists"?\s*[:=]\s*false|invalid[^.]*(number|recipient|jid)|number[^.]*not[^.]*valid|bad request|\b400\b/;
const RATE_LIMITED = /\b429\b|rate[\s_-]?limit|too many/;

export function mapErrorReason(raw?: string | null): MappedError {
  const s = (raw || '').toLowerCase();
  if (DISCONNECTED.test(s)) return { kind: 'disconnected', label: REASONS.disconnected };
  if (INVALID_NUMBER.test(s)) return { kind: 'invalid_number', label: REASONS.invalid_number };
  if (RATE_LIMITED.test(s)) return { kind: 'rate_limited', label: REASONS.rate_limited };
  return { kind: 'generic', label: REASONS.generic };
}
