/**
 * Custody ack (pattern #1 in CLAUDE.md): oggi status='sent' significa
 * "scritto sul socket verso WhatsApp", non "WhatsApp lo ha accettato". Con
 * MESSAGES_UPDATE sottoscritto arrivano SERVER_ACK(2) ed ERROR(0):
 *  - 2 → server_ack_at: la promessa "sai se è partito davvero" diventa vera;
 *  - 0 → ack_error_at + motivo; al 3° rifiuto in 7 giorni verso lo stesso
 *    numero il destinatario viene sospeso (probabile blocco): continuare a
 *    scrivergli è il segnale più puro di automazione per Meta.
 * Dietro CUSTODY_ACK_ENABLED finché la migration 20260907 non è applicata.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { suppressRecipient } from './suppressions';

export const ACK_ERRORS_TO_SUSPEND = 3;
export const ACK_ERROR_WINDOW_DAYS = 7;
export const ACK_ERROR_MESSAGE = 'WhatsApp non ha accettato il messaggio (numero bloccato, non attivo o non raggiungibile)';

/** Ritorna il numero di righe toccate. */
export async function recordCustodyAck(supabase: SupabaseClient, evolutionMessageId: string, status: 0 | 2): Promise<number> {
  const nowIso = new Date().toISOString();
  if (status === 2) {
    const { data, error } = await supabase
      .from('scheduled_messages')
      .update({ server_ack_at: nowIso })
      .eq('evolution_message_id', evolutionMessageId)
      .is('server_ack_at', null)
      .select('id');
    if (error) throw error;
    return data?.length || 0;
  }
  const { data: rows, error } = await supabase
    .from('scheduled_messages')
    .update({ ack_error_at: nowIso, error_message: ACK_ERROR_MESSAGE })
    .eq('evolution_message_id', evolutionMessageId)
    .is('ack_error_at', null)
    .select('id, instance_phone, recipient_number');
  if (error) throw error;
  for (const r of rows || []) {
    const owner = (r as any).instance_phone;
    const recipient = (r as any).recipient_number;
    if (owner && recipient) await maybeSuspendRecipient(supabase, owner, recipient);
  }
  return rows?.length || 0;
}

export function shouldSuspend(ackErrorsInWindow: number): boolean {
  return ackErrorsInWindow >= ACK_ERRORS_TO_SUSPEND;
}

async function maybeSuspendRecipient(supabase: SupabaseClient, ownerPhone: string, recipient: string): Promise<void> {
  const since = new Date(Date.now() - ACK_ERROR_WINDOW_DAYS * 86_400_000).toISOString();
  const { count, error } = await supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('instance_phone', ownerPhone)
    .eq('recipient_number', recipient)
    .gte('ack_error_at', since);
  if (error) throw error;
  if (!shouldSuspend(count || 0)) return;
  await suppressRecipient(supabase, ownerPhone, recipient, 'ack_error');
}
