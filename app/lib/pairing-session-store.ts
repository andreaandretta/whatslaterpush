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
// Solo sessionStorage (reload della stessa scheda). Niente più frammento
// nell'URL (#s=…): finiva nella cronologia del browser e nelle breadcrumb di
// Sentry, e su un PC condiviso chiunque riaprisse quella voce poteva ritirare
// il cookie (revisione 28 set 2026). Tutto best-effort: storage bloccato o
// finestra privata → si torna al comportamento di prima.

const KEY = 'wl_pairing_session';
const HASH_RE = /(?:^#|&)s=([0-9a-f-]{36})(?:&|$)/i;

export type StoredPairing = { sessionId: string; phone: string };

export function savePairingSession(sessionId: string, phone: string): void {
  try { sessionStorage.setItem(KEY, JSON.stringify({ sessionId, phone })); } catch { /* storage bloccato */ }
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
  // Un #s= rimasto da una versione precedente si toglie dall'indirizzo e si ignora.
  try {
    if (HASH_RE.test(window.location.hash)) {
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  } catch { /* ignore */ }
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
