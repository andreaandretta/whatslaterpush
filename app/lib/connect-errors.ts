// Task 58 (tier pairing-resilience, 20 ago) — classificazione degli errori di
// /api/auth/init per la UI di /connect.
//
// Lezione dell'incidente 17-19 ago: ogni fallimento era un alert() generico e
// l'utente ri-cliccava a raffica — e ogni retry consumava il rate-limit Meta
// del SUO numero (visto dal vivo: 7 tentativi bruciati in minuti, numero in
// castigo). Tre categorie, tre comportamenti:
//   rate_limited → countdown reale dal Retry-After, CTA bloccato: riprovare
//                  subito ALLUNGA il blocco, la UI deve impedirlo fisicamente;
//   ours         → 5xx nostro (teardown zombie, create rigettata…): copy che
//                  scagiona l'utente — il monitoring ci ha già avvisato;
//   generic      → 400 di validazione e simili: messaggio del server, nessun
//                  freno significativo.
// Pura e senza dipendenze: testabile senza DOM.

export type InitUiError = {
  kind: 'rate_limited' | 'ours' | 'generic';
  title: string;
  message: string;
  cooldownSec: number;
};

const MAX_COOLDOWN_SEC = 600; // mai un lucchetto oltre 10 min, qualunque cosa dica il server

export function classifyInitError(status: number, body: any, retryAfterHeader?: string | null): InitUiError {
  if (status === 429) {
    const parsed = parseInt(retryAfterHeader || '', 10);
    const cooldownSec = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_COOLDOWN_SEC, MAX_COOLDOWN_SEC);
    return {
      kind: 'rate_limited',
      title: 'Troppi tentativi ravvicinati',
      message: 'WhatsApp limita i tentativi di collegamento: riprovare subito allunga il blocco sul tuo numero. Aspetta il timer, poi riprova una sola volta.',
      cooldownSec,
    };
  }
  if (status >= 500) {
    return {
      kind: 'ours',
      title: 'Problema dal lato nostro',
      message: 'Non sei tu: abbiamo un problema tecnico e siamo già stati avvisati automaticamente. Riprova tra un minuto.',
      cooldownSec: 60,
    };
  }
  return {
    kind: 'generic',
    title: 'Controlla e riprova',
    message: (body && typeof body.error === 'string' && body.error) || 'Errore di connessione. Riprova.',
    cooldownSec: 5,
  };
}
