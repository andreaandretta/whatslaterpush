import type { SupabaseClient } from '@supabase/supabase-js';

// ── Atomic cross-lambda webhook dedup via processed_webhook_events ──
// Extracted from app/api/webhook/route.ts for unit testability (the route's own
// integration harness is broken — see the test-harness backlog task).

/**
 * Claims a WhatsApp message id with INSERT ... ON CONFLICT DO NOTHING.
 * Returns true if THIS call claimed it (fresh -> process), false if it was already
 * claimed (Evolution retry / parallel lambda -> skip). Fail-OPEN on a DB error:
 * better a rare duplicate than dropping a real message.
 */
export async function claimWebhookEvent(supabase: SupabaseClient, msgId: string): Promise<boolean> {
  if (!msgId) return true; // no id to dedup on -> let it through
  const { data, error } = await supabase
    .from('processed_webhook_events')
    .upsert({ message_key: msgId }, { onConflict: 'message_key', ignoreDuplicates: true })
    .select('message_key');
  if (error) {
    console.error('WEBHOOK: dedup claim error for ' + msgId + ':', error.message);
    return true; // fail-open
  }
  return !!(data && data.length > 0);
}

/**
 * Releases a claim so Evolution's retry can REPROCESS a message whose first
 * delivery was claimed but then failed downstream. Call ONLY on error paths —
 * success/handled returns must KEEP the claim so an already-handled event is not
 * re-processed on retry. Idempotent + fail-soft: deleting an absent key is a
 * no-op, and a delete error is logged but never thrown (the caller is already on
 * an error path and must still return its 500).
 */
export async function releaseWebhookEvent(supabase: SupabaseClient, msgId: string): Promise<void> {
  if (!msgId) return;
  const { error } = await supabase
    .from('processed_webhook_events')
    .delete()
    .eq('message_key', msgId);
  if (error) console.error('WEBHOOK: dedup release error for ' + msgId + ':', error.message);
}
