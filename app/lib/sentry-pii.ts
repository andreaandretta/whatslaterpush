/**
 * PII scrubber shared by all Sentry runtime configs (server, edge, client).
 * Runs inside the `beforeSend` hook so events leave the application already
 * sanitized — failures here must NEVER throw (it would drop the event).
 *
 * What we redact:
 *   - WhatsApp JIDs:        393331234567@s.whatsapp.net | @g.us | @newsletter,
 *                           gruppi 120363…@g.us (fino a 22 cifre) e <cifre>-<ts>@g.us,
 *                           anche URL-encoded (`%40`, es. ?groupJid=… di findGroupInfos)
 *   - E.164 phone numbers:  +393331234567, 393331234567 (10–15 digits)
 *   - Email addresses:      RFC-loose match
 *
 * What we explicitly DO NOT redact:
 *   - Timestamps, IDs, status codes (different shape, not in our regexes)
 *   - URLs (would break Sentry's issue grouping)
 *   - `user.id` style hash tokens like `h:a1b2c3d4` from app/lib/audit.ts
 */

const JID_RE = /\b\d{8,22}(?:-\d{6,12})?(?:@|%40)(?:s\.whatsapp\.net|g\.us|newsletter)\b/gi;
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

/**
 * `breadcrumb.data` delle fetch: l'integrazione di Sentry salva la query
 * (`http.query`) e l'URL così come sono, cioè URL-encoded. Ogni stringa si
 * decodifica (se si può) prima di ripulirla, e la query di findGroupInfos
 * (`groupJid=…`) si toglie del tutto.
 */
export function scrubBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (typeof v !== 'string') {
      out[k] = scrubObject(v);
      continue;
    }
    let decoded = v;
    try { decoded = decodeURIComponent(v); } catch { /* resta com'è */ }
    if (k === 'http.query' && /groupjid=/i.test(decoded)) continue;
    out[k] = scrubString(decoded);
  }
  return out;
}

/** beforeBreadcrumb condiviso dalle config Sentry. Come beforeSend, non lancia mai. */
export function sentryBeforeBreadcrumb<B extends { message?: string; data?: Record<string, any> }>(breadcrumb: B): B {
  try {
    if (breadcrumb.message) breadcrumb.message = scrubString(breadcrumb.message);
    if (breadcrumb.data) breadcrumb.data = scrubBreadcrumbData(breadcrumb.data);
  } catch { /* meglio il breadcrumb che niente */ }
  return breadcrumb;
}
