import { createClient } from '@supabase/supabase-js';

// Closed catalog of event_types. New events should be added here so the SLA
// dashboard / queries know what to look for. Free-form strings still work but
// won't be auto-classified.
export type AuditEventType =
  | 'schedule_created'
  | 'message_sent'
  | 'message_failed'
  | 'tier_changed'
  | 'webhook_received'
  | 'auth_login'
  | 'auth_logout'
  | 'payment_event'
  | (string & {});

interface AuditEventParams {
  userPhone?: string | null;
  eventType: AuditEventType;
  payload?: Record<string, unknown>;
  ipAddress?: string | null;
}

// SHA-256 truncated to 8 hex chars. Suitable for opaque dedup tokens in audit
// payloads (e.g. correlating two events about the same contact_number) WITHOUT
// storing the cleartext. Not a cryptographic identifier.
export async function hashContactRef(value: string): Promise<string> {
  if (!value) return 'h:00000000';
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 4; i++) hex += arr[i].toString(16).padStart(2, '0');
  return 'h:' + hex;
}

// Fire-and-forget audit write. Never throws — failures are logged as warnings
// so the primary request path is never blocked by audit infrastructure.
// Returns a Promise the caller can choose to await (most do; cron paths
// can `void` it when latency is critical).
export async function logAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.warn('AUDIT: missing Supabase credentials, skipping event=' + params.eventType);
      return;
    }
    const supabase = createClient(url, key);
    const { error } = await supabase.from('audit_events').insert({
      user_phone: params.userPhone || null,
      event_type: params.eventType,
      payload: params.payload || {},
      ip_address: params.ipAddress || null,
    });
    if (error) {
      console.warn('AUDIT: insert failed event=' + params.eventType + ' err=' + error.message);
    }
  } catch (err) {
    console.warn('AUDIT: log threw event=' + params.eventType + ' err=' + (err as Error)?.message);
  }
}

// Helper to extract client IP from a Next.js request. Vercel uses
// x-forwarded-for; fall back to x-real-ip; null if neither.
export function clientIpFromHeaders(headers: { get: (name: string) => string | null }): string | null {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip');
}
