/**
 * PII scrubber shared by all Sentry runtime configs (server, edge, client).
 * Runs inside the `beforeSend` hook so events leave the application already
 * sanitized — failures here must NEVER throw (it would drop the event).
 *
 * What we redact:
 *   - WhatsApp JIDs:        393331234567@s.whatsapp.net | @g.us | @newsletter
 *   - E.164 phone numbers:  +393331234567, 393331234567 (10–15 digits)
 *   - Email addresses:      RFC-loose match
 *
 * What we explicitly DO NOT redact:
 *   - Timestamps, IDs, status codes (different shape, not in our regexes)
 *   - URLs (would break Sentry's issue grouping)
 *   - `user.id` style hash tokens like `h:a1b2c3d4` from app/lib/audit.ts
 */

const JID_RE = /\b\d{8,15}@(?:s\.whatsapp\.net|g\.us|newsletter)\b/gi;
const EMAIL_RE = /\b[\w._%+-]+@[\w.-]+\.[a-z]{2,}\b/gi;
// Phone matcher runs AFTER JID + email so we don't double-redact the digits
// inside a JID we just replaced. 10–15 digit span with optional leading +.
const PHONE_RE = /\+?\b\d{10,15}\b/g;

export function scrubString(s: string): string {
  if (!s) return s;
  return s
    .replace(JID_RE, '[REDACTED_JID]')
    .replace(EMAIL_RE, '[REDACTED_EMAIL]')
    .replace(PHONE_RE, '[REDACTED_PHONE]');
}

/**
 * Walks an event-shaped object and scrubs any string leaf in-place-style by
 * returning a new value. Treats arrays + plain objects recursively; leaves
 * other types untouched. Tolerates cycles up to depth 8 (Sentry events are
 * shallow in practice).
 */
export function scrubObject<T = any>(value: T, depth = 0): T {
  if (depth > 8 || value == null) return value;
  if (typeof value === 'string') return scrubString(value) as unknown as T;
  if (Array.isArray(value)) return value.map(v => scrubObject(v, depth + 1)) as unknown as T;
  if (typeof value === 'object') {
    const out: any = {};
    for (const k of Object.keys(value as any)) {
      out[k] = scrubObject((value as any)[k], depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * The actual beforeSend callback passed to Sentry.init across all runtimes.
 * Best-effort: any exception returns the event unmodified rather than
 * dropping it — observability trumps perfect scrubbing.
 */
export function sentryBeforeSend<E>(event: E): E {
  try {
    return scrubObject(event);
  } catch {
    return event;
  }
}
