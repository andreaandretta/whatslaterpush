/**
 * Sincronizzazione del pairing code mostrato in /connect (incidente 23 ago:
 * "terno al lotto").
 *
 * Evolution RIGENERA il codice ogni ~45s (evento QRCODE_UPDATED) ma la UI
 * mostrava lo stesso codice per 10 minuti: dopo la prima rotazione l'utente
 * inseriva un codice già morto → "codice errato" sul telefono. Qui il webhook
 * salva il codice CORRENTE sulla pending_auth_session dell'istanza, e
 * /api/auth/check lo restituisce al poll della pagina: quello a schermo è
 * sempre quello valido. Zero chiamate extra verso Evolution/Meta — solo
 * piggyback su webhook e poll già esistenti.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Estrae il pairing code da un payload QRCODE_UPDATED (forme note v2). */
export function extractPairingCode(payload: unknown): string | null {
  const p = payload as Record<string, any> | null | undefined;
  const candidate =
    p?.data?.qrcode?.pairingCode ??
    p?.data?.pairingCode ??
    p?.qrcode?.pairingCode ??
    null;
  if (typeof candidate !== 'string') return null;
  const clean = candidate.trim().toUpperCase();
  // I codici Baileys sono 8 alfanumerici (mostrati XXXX-XXXX). Accetta con o
  // senza trattino; rifiuta tutto il resto (mai propagare spazzatura alla UI).
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(clean)) return null;
  return clean.includes('-') ? clean : `${clean.slice(0, 4)}-${clean.slice(4)}`;
}

/**
 * Salva il codice corrente sulle pending session ATTIVE dell'istanza.
 * Best-effort: un errore qui non deve mai rompere il webhook.
 */
export async function syncPairingCode(
  supabase: SupabaseClient,
  instanceName: string,
  pairingCode: string
): Promise<void> {
  if (!instanceName || !pairingCode) return;
  const { error } = await supabase
    .from('pending_auth_sessions')
    .update({
      pairing_code: pairingCode,
      pairing_code_updated_at: new Date().toISOString(),
    })
    .eq('instance_name', instanceName)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  if (error) console.error('[pairing-sync] update failed:', error.message);
}

/**
 * Propaga lo stato di connessione ('connecting' | 'open' | 'close') alle
 * pending session dell'istanza — alimenta il feedback "richiesta ricevuta
 * da WhatsApp" nella UI. Best-effort come sopra.
 */
export async function syncConnState(
  supabase: SupabaseClient,
  instanceName: string,
  state: string | null | undefined
): Promise<void> {
  if (!instanceName || !state) return;
  if (!['connecting', 'open', 'close'].includes(state)) return;
  const { error } = await supabase
    .from('pending_auth_sessions')
    .update({ conn_state: state })
    .eq('instance_name', instanceName)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  if (error) console.error('[pairing-sync] conn_state update failed:', error.message);
}
