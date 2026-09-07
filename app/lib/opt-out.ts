/**
 * Opt-out del destinatario — l'UNICO uso che WhatsLater fa di un messaggio in
 * arrivo. Il testo viene letto in memoria solo per (a) segnare la data
 * dell'ultimo messaggio ricevuto da quel numero (whatsapp_contacts.last_inbound_at,
 * prova che esiste una chat) e (b) riconoscere "stop / basta / non scrivermi".
 * Niente viene salvato né loggato: né il testo, né un estratto.
 *
 * Dietro OPT_OUT_ENABLED finché migration 20260907 e privacy non sono aggiornate.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { suppressRecipient } from './suppressions';

// Solo messaggi brevi che SONO la richiesta, non che la contengono: "stop"
// sì, "stop, ci vediamo alle 18" no (quello è una risposta normale).
export const OPT_OUT_RE = /^\s*(stop|basta|non\s+scrivermi(\s+pi[uù])?|non\s+mandarmi\s+pi[uù]\s+(niente|nulla|messaggi)|cancellami|rimuovimi|toglimi|unsubscribe|smettila|smetti)\s*[!.]*\s*$/i;
export const OPT_OUT_MAX_CHARS = 40;

export function isOptOutText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = String(text).trim();
  if (t.length === 0 || t.length > OPT_OUT_MAX_CHARS) return false;
  return OPT_OUT_RE.test(t);
}

/**
 * Numero del mittente da una WAMessageKey: chat 1:1 soltanto. Con il nuovo
 * identificativo @lid (2025) il numero vero viaggia in remoteJidAlt / senderPn;
 * se manca, non tiriamo a indovinare (null).
 */
export function recipientFromKey(key: any): string | null {
  const jid: string = String(key?.remoteJid || '');
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
  const digitsOf = (j: string) => j.split('@')[0].split(':')[0].replace(/\D/g, '');
  if (jid.endsWith('@s.whatsapp.net')) {
    const d = digitsOf(jid);
    return d.length >= 8 && d.length <= 15 ? d : null;
  }
  if (jid.endsWith('@lid')) {
    const alt: string = String(key?.remoteJidAlt || key?.senderPn || '');
    if (!alt.endsWith('@s.whatsapp.net')) return null;
    const d = digitsOf(alt);
    return d.length >= 8 && d.length <= 15 ? d : null;
  }
  return null;
}

export function inboundText(msgContent: any): string {
  return msgContent?.conversation || msgContent?.extendedTextMessage?.text || '';
}

export type InboundOutcome = 'ignored' | 'touched' | 'opted_out';

export async function handleInboundOptOut(
  supabase: SupabaseClient,
  instanceName: string,
  msgKey: any,
  msgContent: any
): Promise<InboundOutcome> {
  const recipient = recipientFromKey(msgKey);
  if (!recipient || !instanceName) return 'ignored';
  const { data: owner } = await supabase
    .from('user_instances')
    .select('phone_number')
    .eq('instance_name', instanceName)
    .maybeSingle();
  const ownerPhone: string | null = (owner as any)?.phone_number || null;
  if (!ownerPhone) return 'ignored';

  // (a) prova di chat esistente: solo la data, sulla riga se già esiste.
  await supabase
    .from('whatsapp_contacts')
    .update({ last_inbound_at: new Date().toISOString() })
    .eq('user_phone', ownerPhone)
    .eq('contact_number', recipient);

  // (b) opt-out: il testo vive solo in questa variabile.
  if (!isOptOutText(inboundText(msgContent))) return 'touched';
  await suppressRecipient(supabase, ownerPhone, recipient, 'opt_out');
  return 'opted_out';
}
