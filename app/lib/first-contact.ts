/**
 * Corsia lenta per i numeri NUOVI — lato DB (l'aritmetica pura è in
 * app/lib/anti-ban.ts).
 *
 * "Conosciuto" = l'utente gli ha già mandato un messaggio da WhatsLater
 * (qualsiasi giorno, oggi compreso: chi è passato dalla corsia stamattina
 * non ci ripassa) OPPURE il numero sta nella rubrica del telefono / ha già
 * una chat (whatsapp_contacts con sorgente non manuale). Tutto il resto è
 * "nuovo" e conta verso il cap giornaliero di numeri nuovi.
 *
 * FAIL-OPEN: un errore di query non deve bloccare la coda di tutti; logga e
 * lascia passare. È un freno morbido, non un lucchetto.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { KNOWN_CONTACT_SOURCES, countNewRecipients } from './anti-ban';

export async function isKnownRecipient(supabase: SupabaseClient, ownerPhone: string, recipient: string): Promise<boolean> {
  try {
    const { count: priorSent, error: e1 } = await supabase
      .from('scheduled_messages')
      .select('id', { count: 'exact', head: true })
      .eq('instance_phone', ownerPhone)
      .eq('recipient_number', recipient)
      .eq('status', 'sent');
    if (e1) throw e1;
    if ((priorSent || 0) > 0) return true;
    const { count: inBook, error: e2 } = await supabase
      .from('whatsapp_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_phone', ownerPhone)
      .eq('contact_number', recipient)
      .in('source', KNOWN_CONTACT_SOURCES);
    if (e2) throw e2;
    return (inBook || 0) > 0;
  } catch (err) {
    console.error('[first-contact] lookup failed, treating recipient as known (fail-open):', (err as any)?.message || err);
    return true;
  }
}

/** Destinatari distinti a cui l'utente ha scritto OGGI e che prima di oggi non conosceva. */
export async function countNewRecipientsSentToday(supabase: SupabaseClient, ownerPhone: string, todayStartIso: string): Promise<number> {
  try {
    const { data: todayRows, error: e0 } = await supabase
      .from('scheduled_messages')
      .select('recipient_number')
      .eq('instance_phone', ownerPhone)
      .eq('status', 'sent')
      .gte('sent_at', todayStartIso);
    if (e0) throw e0;
    const today = Array.from(new Set((todayRows || []).map((r: any) => r.recipient_number).filter(Boolean))) as string[];
    if (today.length === 0) return 0;
    const { data: priorRows, error: e1 } = await supabase
      .from('scheduled_messages')
      .select('recipient_number')
      .eq('instance_phone', ownerPhone)
      .eq('status', 'sent')
      .lt('sent_at', todayStartIso)
      .in('recipient_number', today);
    if (e1) throw e1;
    const { data: bookRows, error: e2 } = await supabase
      .from('whatsapp_contacts')
      .select('contact_number')
      .eq('user_phone', ownerPhone)
      .in('contact_number', today)
      .in('source', KNOWN_CONTACT_SOURCES);
    if (e2) throw e2;
    const known = new Set<string>();
    for (const r of priorRows || []) if ((r as any).recipient_number) known.add((r as any).recipient_number);
    for (const r of bookRows || []) if ((r as any).contact_number) known.add((r as any).contact_number);
    return countNewRecipients(today, known);
  } catch (err) {
    console.error('[first-contact] count failed, treating as 0 (fail-open):', (err as any)?.message || err);
    return 0;
  }
}
