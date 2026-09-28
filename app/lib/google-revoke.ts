import { decryptToken } from './calendar-crypto';

// Revoca del grant Google Calendar (fase 1b). Né "Elimina account" né
// "Disconnetti Calendar" chiamavano Google: cancellare la riga toglie il token
// a noi, ma l'autorizzazione resta attiva sull'account Google dell'utente
// (visibile in "App con accesso"). Best-effort: false su qualsiasi problema
// (token illeggibile, rete, 4xx di un token già revocato), mai eccezioni —
// chi chiama prosegue comunque con la cancellazione.
// Token nel body form-urlencoded, mai nella query: non finisce nei log.
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const REVOKE_TIMEOUT_MS = 3000;

export async function revokeGoogleGrant(encryptedRefreshToken: string | null | undefined, fetchImpl?: typeof fetch): Promise<boolean> {
  if (!encryptedRefreshToken) return false;
  let token: string;
  try {
    token = decryptToken(encryptedRefreshToken);
  } catch {
    return false;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REVOKE_TIMEOUT_MS);
  try {
    const res = await (fetchImpl || fetch)(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: ctrl.signal,
    });
    return !!res?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
