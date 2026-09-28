// Sessione di pairing che sopravvive a un reload di /connect (fase 1b).
//
// Prima il sessionId viveva solo nello stato React. Scenario reale: l'utente
// passa a WhatsApp per inserire il codice, Android ricarica la scheda per
// memoria (o l'utente la chiude pensando di aver finito), la pagina riparte
// dal passo 1 senza niente da interrogare → il telefono risulta collegato ma
// il browser non riceve mai il cookie. Al nuovo tentativo paired_at è già
// timbrato e init risponde 409 "questo numero ha già un account": bloccato
// fuori, con recupero solo dall'operatore.
//
// Doppia copia: sessionStorage (reload della stessa scheda) e il FRAMMENTO
// dell'URL (#s=…: resta nella cronologia e in una scheda ripristinata). Il
// frammento non viene mai inviato al server, quindi il sessionId continua a
// non finire nei log di accesso Vercel (motivo per cui /api/auth/check lo
// riceve nel body, audit Codex #9). Tutto best-effort: storage bloccato o
// finestra privata → si torna al comportamento di prima.

const KEY = 'wl_pairing_session';
const HASH_RE = /(?:^#|&)s=([0-9a-f-]{36})(?:&|$)/i;

export type StoredPairing = { sessionId: string; phone: string };

export function savePairingSession(sessionId: string, phone: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ sessionId, phone })); } catch { /* storage bloccato */ }
  try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + '#s=' + sessionId); } catch { /* ignore */ }
}

export function loadPairingSession(): StoredPairing | null {
  let stored: StoredPairing | null = null;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.sessionId === 'string' && parsed.sessionId) {
      stored = { sessionId: parsed.sessionId, phone: typeof parsed.phone === 'string' ? parsed.phone : '' };
    }
  } catch { /* ignore */ }
  let fromHash: string | null = null;
  try { fromHash = window.location.hash.match(HASH_RE)?.[1] || null; } catch { /* ignore */ }
  // Il frammento vince: è la copia legata a QUESTA scheda/cronologia.
  if (fromHash && fromHash !== stored?.sessionId) return { sessionId: fromHash, phone: '' };
  return stored;
}

export function clearPairingSession(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  try {
    if (HASH_RE.test(window.location.hash)) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  } catch { /* ignore */ }
}
