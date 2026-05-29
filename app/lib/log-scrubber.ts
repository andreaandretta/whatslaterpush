import { hashContactRefSync } from './audit';

// PII scrubber for the webhook dbLog payloads written to the `webhook_logs`
// table. The table sits outside the Sentry transport (which has its own PII
// regex scrubber in app/lib/sentry-pii.ts) and historically stored raw user
// messages + sender phone numbers verbatim — see CONTACT_NOT_FOUND,
// MSG_RECEIVED, BEFORE_REWRITE etc in webhook/route.ts. This module rewrites
// the payload object before JSON.stringify so the on-disk row never holds
// cleartext PII.
//
// The field allowlists below were derived by greppping dbLog( call sites in
// app/api/webhook/route.ts on 2026-05-29. If you add a new dbLog with a PII
// payload, add the field name to the appropriate set here too.
//
// Scope: top-level object keys only. Nested objects, arrays of strings, and
// string-typed `data` payloads pass through unchanged — callers are
// responsible for not nesting PII deeper than one level. The 2000-char
// truncation in dbLog is a second line of defense for those edge cases.

const BODY_FIELDS = new Set<string>([
  'text',
  'body',
  'raw',
  'user',
  'from',
  'to',
  'rawMessage',
  'finalMessage',
  'message_text',
  'messageText',
  'searched',
]);

const HASH_FIELDS = new Set<string>([
  'sender',
  'phone',
  'sender_phone',
  'senderPhone',
  'ownerPhone',
  'owner_phone',
  'recipient_name',
  'recipientName',
]);

export function scrubPiiForLog(payload: Record<string, unknown>): Record<string, unknown> {
  const scrubbed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (BODY_FIELDS.has(k) && typeof v === 'string') {
      scrubbed[k] = v.length > 0 ? `[REDACTED_BODY:${v.length}chars]` : '';
    } else if (HASH_FIELDS.has(k) && v != null) {
      scrubbed[k] = hashContactRefSync(String(v));
    } else {
      scrubbed[k] = v;
    }
  }
  return scrubbed;
}
