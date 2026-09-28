/**
 * Testo italiano per una risposta di errore delle API messaggi, da mostrare in
 * modale o in un toast. Regole:
 *  1. se il server manda `message` (stringa) si usa quello: è il contratto per
 *     ogni errore nuovo, già scritto per l'utente;
 *  2. altrimenti una frase per ogni codice noto;
 *  3. mai "Errore: <codice>" — prima un queue_full o un invalid_media_url
 *     arrivavano all'utente così, e un errore Postgres in inglese uguale.
 */
export interface ApiErrorBody {
  error?: unknown;
  message?: unknown;
  reason?: unknown;
  plan?: unknown;
  limit?: unknown;
  pending?: unknown;
}

export const GENERIC_ERROR_TEXT = 'Qualcosa non è andato — riprova.';

const CODE_TEXT: Record<string, string> = {
  invalid_phone: 'Numero non valido.',
  invalid_message: 'Messaggio non valido (vuoto o oltre 3500 caratteri).',
  invalid_datetime: 'Data/ora non valida (deve essere almeno 1 minuto nel futuro).',
  invalid_recurrence_rule: 'Ripetizione non valida.',
  self_target: 'Non puoi schedulare a te stesso.',
  recipient_is_lid: 'Questo contatto è salvato con un codice interno di WhatsApp, non con il numero. Cercalo di nuovo in rubrica o scrivi il numero a mano.',
  recipient_not_on_whatsapp: 'WhatsApp non conosce questo numero: controlla che sia giusto e che abbia WhatsApp.',
  invalid_media_type: 'Questo tipo di allegato non si può inviare. Scegli una foto, un video, un documento o un audio.',
  invalid_media_url: 'L\'allegato non è più disponibile: toglilo e caricalo di nuovo.',
  no_fields_to_update: 'Non hai cambiato niente: il messaggio resta com\'era.',
  invalid_status: 'Operazione non valida per questo messaggio.',
  message_not_editable: 'Il messaggio non è più modificabile (già in invio o inviato).',
  message_not_cancellable: 'Il messaggio è già in invio o inviato.',
  not_retryable: 'Questo messaggio non si può rimettere in coda: aggiorna la pagina.',
  not_retryable_permanent: 'Riprovare non serve: WhatsApp non conosce questo numero. Programma di nuovo il messaggio con il numero giusto.',
  queue_full: 'Hai troppi messaggi in coda. Aspetta che ne venga inviato qualcuno.',
  Unauthorized: 'La sessione è scaduta: ricarica la pagina.',
  'User not found': 'Account non trovato: ricollega WhatsApp.',
  'id required': GENERIC_ERROR_TEXT,
  'Message not found or not owned': 'Messaggio non trovato: forse è già stato eliminato. Aggiorna la pagina.',
};

export function apiErrorText(body: ApiErrorBody | null | undefined, status?: number): string {
  const b = body || {};
  if (typeof b.message === 'string' && b.message.trim().length > 0) return b.message.trim();
  const code = typeof b.error === 'string' ? b.error : '';

  if (code === 'plan_contacts_limit_exceeded') {
    // plan 'beta' = free beta: no plan name (nothing purchasable) and the
    // copy must not match the 'Aggiorna piano' link gate in ScheduleModal.
    return b.plan === 'beta'
      ? `Hai raggiunto il limite beta di ${b.limit} contatti attivi.`
      : `Hai raggiunto il limite di ${b.limit} contatti del piano ${b.plan}.`;
  }
  if (code === 'queue_full' && typeof b.pending === 'number' && typeof b.limit === 'number') {
    return `Hai già ${b.pending} messaggi in coda (massimo ${b.limit}). Aspetta che ne venga inviato qualcuno.`;
  }
  if (code === 'invalid_message' && b.reason === 'text_required_without_media') {
    return 'Senza allegato serve un testo: scrivi qualcosa prima di togliere l\'allegato.';
  }
  if (Object.prototype.hasOwnProperty.call(CODE_TEXT, code)) return CODE_TEXT[code];
  // Varianti di numero non valido (es. invalid_phone_country): stessa frase.
  if (code.startsWith('invalid_phone')) return CODE_TEXT.invalid_phone;
  if (status === 409) return 'Il messaggio non è più modificabile (già in invio).';
  if (status !== undefined && status >= 500) return 'Qualcosa non è andato dal nostro lato — riprova tra poco.';
  return GENERIC_ERROR_TEXT;
}
