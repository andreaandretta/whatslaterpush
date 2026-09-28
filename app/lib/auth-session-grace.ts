// Finestre di grazia della sessione di pairing (pending_auth_sessions), fase 1b.
//
// Il TTL di 10 minuti fissato da /api/auth/init non coincide con la vita reale
// del pairing: Evolution continua a ruotare il codice (QRCODE_UPDATED, ~45 s)
// oltre i 10 minuti e la pagina mostra sempre quello corrente. Chi lo inseriva
// al minuto 12 collegava davvero il telefono (paired_at timbrato) ma la
// sessione non veniva mai autenticata → niente cookie → al nuovo tentativo
// 409 "questo numero ha già un account", recupero solo dall'operatore.
//
// PENDING: per quanto, dopo expires_at, il webhook può ancora autenticare la
//   sessione (solo se il telefono che si collega è quello della sessione) e
//   /connect continua a interrogarla.
// AUTHENTICATED: per quanto, dopo expires_at, il browser può ancora ritirare
//   il cookie di una sessione già autenticata (monouso: si cancella al ritiro).
// Entrambe restano sotto l'ora dopo cui il cron send-messages cancella le
// righe scadute (expires_at < now - 1h).
export const PENDING_SESSION_GRACE_MS = 20 * 60 * 1000;
export const AUTHENTICATED_SESSION_GRACE_MS = 60 * 60 * 1000;
