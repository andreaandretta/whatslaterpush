// Maps the raw `error_message` the cron persists on a failed scheduled_message
// into a short, human Italian reason for the dashboard. The cron stores the
// raw Evolution failure verbatim — typically `"HTTP <code>: <body>"` (no
// structured error code; 401/403/404/429 are never parsed) — so the only place
// we can turn that into user-facing copy is here, client-side. We NEVER surface
// the raw string/code: anything unmatched falls through to a generic message.

export type MessageErrorKind = 'disconnected' | 'invalid_number' | 'media_rejected' | 'rate_limited' | 'generic';

export interface MappedError {
  kind: MessageErrorKind;
  /** Short Italian reason shown under the "Non inviato" card. Never a raw code. */
  label: string;
}

const REASONS: Record<MessageErrorKind, string> = {
  disconnected: 'WhatsApp disconnesso — ricollega',
  invalid_number: 'Numero non su WhatsApp',
  media_rejected: 'Allegato non accettato da WhatsApp — cambia file',
  rate_limited: 'Troppi invii — riprova più tardi',
  generic: 'Invio non riuscito — riprova',
};

// Order is significant: a dropped session (401/403/404, "connection closed",
// "logged out") is checked BEFORE the number check so a transport/auth failure
// that happens to carry a 4xx body is never mislabelled "Numero non su
// WhatsApp" — the right remedy there is "Ricollega", not "fix the number".
// Network/timeout/5xx errors intentionally fall through to generic: they're our
// server↔Evolution link, not the user's WhatsApp pairing, so nudging them to
// reconnect would be misleading.
const DISCONNECTED = /disconness|logged out|logout|loggedout|connection (closed|terminated)|not connected|session (closed|expired)|unauthor|forbidden|reconnect|\b40[134]\b|instance[^.]*not[^.]*(found|connected)/;
// Solo quando il NUMERO è davvero il problema: "exists": false di WhatsApp o un
// testo che parla esplicitamente di numero/jid. Prima bastavano "Bad Request" o
// "400": OGNI 400 di Evolution ha "error":"Bad Request" nel corpo, quindi un
// allegato rifiutato diventava "Numero non su WhatsApp" su un contatto buono.
const INVALID_NUMBER = /not on whatsapp|not .*registered|does(n'?t| not) exist|"?exists"?\s*[:=]\s*false|invalid[^.]*(number|recipient|jid)|number[^.]*not[^.]*valid/;
const BAD_REQUEST = /bad request|\b400\b/;
const RATE_LIMITED = /\b429\b|rate[\s_-]?limit|too many/;

/**
 * `opts.hasMedia`: la riga aveva un allegato. Un 400 che NON parla del numero
 * su un messaggio con allegato è quasi sempre il file (formato non accettato,
 * file già tolto dalla pulizia dei 30 giorni): va detto, non spacciato per
 * numero sbagliato. Senza allegato un 400 generico resta "generic" (Riprova).
 */
export function mapErrorReason(raw?: string | null, opts: { hasMedia?: boolean } = {}): MappedError {
  const s = (raw || '').toLowerCase();
  if (DISCONNECTED.test(s)) return { kind: 'disconnected', label: REASONS.disconnected };
  if (INVALID_NUMBER.test(s)) return { kind: 'invalid_number', label: REASONS.invalid_number };
  if (opts.hasMedia && BAD_REQUEST.test(s)) return { kind: 'media_rejected', label: REASONS.media_rejected };
  if (RATE_LIMITED.test(s)) return { kind: 'rate_limited', label: REASONS.rate_limited };
  return { kind: 'generic', label: REASONS.generic };
}

/**
 * Evolution's 400 for a recipient WhatsApp does not know:
 * `{"jid":"…@s.whatsapp.net","exists":false,…}`. Permanent: retrying cannot
 * help (typically a Linked ID stored as a phone number, see app/lib/jid.ts).
 * Narrower than the 'invalid_number' kind above, which also covers explicit
 * "number does not exist"-style messages.
 */
export function isNotOnWhatsAppError(message: unknown): boolean {
  return typeof message === 'string' && /"exists"\s*:\s*false/.test(message);
}

/**
 * Riga 'sent' che in realtà nessuno ha confermato: il cron l'ha segnata inviata
 * per NON rischiare un doppio invio (timeout della chiamata o lambda morta a
 * metà), ma Evolution non ha mai restituito un id. Il cron lascia un marcatore
 * all'inizio di error_message (send_indeterminate / send_timeout_indeterminate).
 * Una spunta di consegna/lettura arrivata dopo è la prova che mancava.
 * Attenzione: le righe 'sent' possono tenere un error_message vecchio (es.
 * "Istanza disconnessa, retry 2/12") — conta SOLO il marcatore.
 */
export function isIndeterminateSend(msg: {
  status?: string | null;
  error_message?: string | null;
  evolution_message_id?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
}): boolean {
  if (msg.status !== 'sent') return false;
  if (msg.evolution_message_id || msg.delivered_at || msg.read_at) return false;
  return typeof msg.error_message === 'string' && /^send_(timeout_)?indeterminate\b/.test(msg.error_message);
}

/**
 * Motivo breve (italiano) di una riga ancora in coda che il SISTEMA ha
 * spostato o messo in pausa. Il cron scrive il motivo in error_message e
 * sovrascrive scheduled_at: senza questa riga la lista mostrava un normale
 * "Parte tra 11h" e l'utente non sapeva perché il promemoria di stasera
 * sarebbe partito domattina. null = nessun motivo da mostrare.
 * (L'orario originale non è salvato da nessuna parte: arriva con la Fase 2.)
 */
export function mapPendingReason(raw?: string | null): string | null {
  const text = (raw || '').trim();
  if (!text) return null;
  const s = text.toLowerCase();
  // I motivi di pausa di suppressions.ts sono già frasi complete per l'utente.
  if (s.startsWith('in pausa')) return text;
  if (s.startsWith('trial scaduto')) return 'In pausa: la prova gratuita è scaduta';
  if (/istanza disconness|instance disconnected/.test(s)) {
    return /domani|rescheduled to/.test(s)
      ? 'Spostato a domani: WhatsApp scollegato'
      : 'In attesa: WhatsApp scollegato';
  }
  if (s.startsWith('limite giornaliero')) {
    return s.includes('primi giorni')
      ? 'Spostato a domattina: nei primi giorni dal collegamento si inviano pochi messaggi al giorno'
      : 'Spostato a domattina: raggiunto il limite di messaggi del giorno';
  }
  if (s.startsWith('numeri nuovi')) return 'Spostato a domattina: pochi numeri nuovi al giorno, per proteggere il tuo WhatsApp';
  if (s.startsWith('cool-down')) return 'Spostato di 30 min: già 3 messaggi a questo contatto nelle ultime 24 ore';
  if (s.startsWith('invii sospesi')) return 'Spostato a domattina: troppi invii non riusciti nelle ultime 24 ore';
  if (s.startsWith('rate limit')) return 'Spostato a domattina: troppi invii ravvicinati';
  // Il resto è un tentativo fallito che il cron rimette in coda da solo
  // (HTTP 5xx, rete...): mai mostrare il testo grezzo.
  return 'Nuovo tentativo a breve: l\'invio precedente non è riuscito';
}
