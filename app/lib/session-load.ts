// Caricamento sessione della dashboard (fase 1b).
//
// Prima QUALSIASI errore di /api/auth/me — rete assente all'apertura della PWA,
// "Load failed" appena iOS risveglia l'app, un 5xx, la pagina HTML di un
// captive portal (res.json() lancia) — mandava a /connect. Lì l'utente vede
// "Passo 1 — il tuo numero", lo reinserisce convinto di essere scollegato, e
// init scollegava un WhatsApp che funzionava. /api/auth/me risponde 401 SOLO
// per un cookie assente o non valido: è l'unico caso che porta a /connect.
// Tutto il resto è transitorio → "connessione assente, riprovo" e nuovo
// tentativo con backoff.

export type MeOutcome =
  | { kind: 'ok'; phone: string; instanceName: string }
  | { kind: 'login' }
  | { kind: 'retry' };

export async function checkSession(fetchImpl?: typeof fetch): Promise<MeOutcome> {
  try {
    const res = await (fetchImpl || fetch)('/api/auth/me', { cache: 'no-store' });
    if (res.status === 401) return { kind: 'login' };
    if (!res.ok) return { kind: 'retry' };
    const data: any = await res.json();
    if (!data || typeof data.phone !== 'string' || !data.phone) return { kind: 'retry' };
    return { kind: 'ok', phone: data.phone, instanceName: data.instanceName };
  } catch {
    return { kind: 'retry' };
  }
}

// 2 s, 4 s, 8 s… fino a 30 s: abbastanza presto da non far aspettare chi è
// tornato in copertura, abbastanza piano da non martellare.
export function sessionRetryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));
}

// Unico punto di navigazione "dura" del caricamento sessione (mockabile nei test).
export function goTo(url: string): void {
  window.location.href = url;
}
