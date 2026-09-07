/**
 * Destinatari a cui NON scrivere più (tabella recipient_suppressions, migration
 * 20260907). Due sorgenti: l'opt-out ("stop", app/lib/opt-out.ts) e i rifiuti
 * ripetuti di WhatsApp (custody ack, app/lib/custody-ack.ts). Il cron d'invio e
 * il Calendar sync la consultano prima di ogni invio.
 *
 * FAIL-OPEN sulle letture (un errore di query non blocca la coda), ma la
 * scrittura di una sospensione lancia: se non riusciamo a segnarla, meglio
 * saperlo dal log che crederla fatta.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logAuditEvent } from './audit';

export type SuppressionReason = 'opt_out' | 'ack_error' | 'manual';

export interface Suppression { owner_phone: string; recipient_number: string; reason: SuppressionReason; created_at?: string }

/** Le sospensioni esistono solo dopo la migration: uno dei due flag deve essere acceso. */
export function suppressionsEnabled(): boolean {
  return process.env.OPT_OUT_ENABLED === 'true' || process.env.CUSTODY_ACK_ENABLED === 'true';
}

export function suppressionReasonText(reason: SuppressionReason | string): string {
  switch (reason) {
    case 'opt_out':
      return 'In pausa: il destinatario ha chiesto di non ricevere più messaggi (ha scritto "stop"). Riprendi solo se te lo ha chiesto lui.';
    case 'ack_error':
      return 'In pausa: WhatsApp ha rifiutato gli ultimi 3 messaggi a questo numero (bloccato o non attivo). Scrivigli a mano prima di riprendere.';
    default:
      return 'In pausa: destinatario sospeso.';
  }
}

export async function getSuppression(supabase: SupabaseClient, ownerPhone: string, recipient: string): Promise<Suppression | null> {
  try {
    const { data, error } = await supabase
      .from('recipient_suppressions')
      .select('owner_phone, recipient_number, reason, created_at')
      .eq('owner_phone', ownerPhone)
      .eq('recipient_number', recipient)
      .maybeSingle();
    if (error) throw error;
    return (data as Suppression) || null;
  } catch (err) {
    console.error('[suppressions] lookup failed (fail-open):', (err as any)?.message || err);
    return null;
  }
}

export async function listSuppressedRecipients(supabase: SupabaseClient, ownerPhone: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('recipient_suppressions')
      .select('recipient_number')
      .eq('owner_phone', ownerPhone);
    if (error) throw error;
    return new Set((data || []).map((r: any) => r.recipient_number).filter(Boolean));
  } catch (err) {
    console.error('[suppressions] list failed (fail-open):', (err as any)?.message || err);
    return new Set();
  }
}

/** Mette in pausa i pending verso il destinatario, con il motivo in chiaro. Ritorna quante righe. */
export async function pausePendingToRecipient(supabase: SupabaseClient, ownerPhone: string, recipient: string, reason: SuppressionReason): Promise<number> {
  const { data, error } = await supabase
    .from('scheduled_messages')
    .update({ status: 'paused', error_message: suppressionReasonText(reason) })
    .eq('instance_phone', ownerPhone)
    .eq('recipient_number', recipient)
    .eq('status', 'pending')
    .select('id');
  if (error) throw error;
  return data?.length || 0;
}

/** Registra la sospensione (idempotente) e ferma la coda verso quel numero. */
export async function suppressRecipient(supabase: SupabaseClient, ownerPhone: string, recipient: string, reason: SuppressionReason): Promise<{ paused: number }> {
  const { error } = await supabase
    .from('recipient_suppressions')
    .upsert({ owner_phone: ownerPhone, recipient_number: recipient, reason }, { onConflict: 'owner_phone,recipient_number' });
  if (error) throw error;
  const paused = await pausePendingToRecipient(supabase, ownerPhone, recipient, reason);
  // Audit senza il numero del destinatario: basta sapere che è successo e perché.
  await logAuditEvent({ userPhone: ownerPhone, eventType: 'recipient_suppressed', payload: { reason, paused } });
  return { paused };
}
