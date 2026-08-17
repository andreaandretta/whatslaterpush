// Shared Evolution-instance teardown. Extracted from app/api/auth/init and
// app/api/connect (where forceDeleteInstance was duplicated) so /api/auth/logout
// can reuse it. A dashboard "Disconnetti" must actually tear down the Evolution
// instance — not just clear the session cookie — otherwise the number stays
// user_instances.connection_status='open' and the anti-hijack guard in
// /api/auth/init (commit 6124075) blocks the legitimate owner from re-pairing
// their own number after logout ("Questo numero è già collegato").

export function instanceNameForPhone(phone: string): string {
  return `SchedWhats-${phone}`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Ogni chiamata a Evolution è bounded (pattern del repo: AbortController + cap,
// vedi app/api/webhook/route.ts). Senza cap una fetch appesa su un nodo
// malmesso mangia il maxDuration=30 della route init e il client riceve un 504
// opaco invece di un errore onesto con cleanup.
const CALL_TIMEOUT_MS = 3500;
async function boundedFetch(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Teardown VERIFICATO (bug 2026-08-17, "codice morto"): logout+delete come
// prima, ma la risposta non viene più ignorata — al termine si controlla che
// l'istanza sia davvero sparita. Serve perché un'istanza zombie (socket
// bloccato 'connecting') NON è cancellabile col percorso normale: v2.3.7
// deleteInstance fa logout su open/connecting e sock.logout() lancia su un
// socket rotto → delete 400 per sempre.
//
// L'escalation restart→delete è BEST-EFFORT, non un self-heal garantito:
// Evolution auto-riconnette dopo il client.end() del restart (close con
// statusReason ≠ loggedOut → reconnect immediato), quindi sul vero zombie
// 'connecting' la seconda delete può rifallire → false → il chiamante deve
// abortire il pairing (una create fallirebbe "name already in use" e il
// fallback /instance/connect su 'connecting' restituirebbe lo stale qrCode
// in-memory: il codice morto). Recovery: runbook operatore.
// L'escalation risolve invece in modo affidabile la divergenza row/registry
// (row Prisma orfana con registry vuoto: delete senza logout → row pulita).
//
// Callers best-effort (logout, /api/connect legacy) possono ignorare il bool.
export async function forceDeleteInstance(name: string): Promise<boolean> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) return false;
  const headers = { apikey: evoKey };

  // "Sparita" = SOLO il 404 JSON della guard di Evolution (getInstance():
  // né registry in-memory né row Prisma). Tutto il resto è fail-closed:
  // 200 con state = presente; 200 SENZA state = divergenza row/registry (la
  // create 403-erebbe sulla row, quindi conta come presente); 401/5xx/HTML del
  // reverse-proxy = non provato → presente. Mai pairing alla cieca.
  const gone = async (): Promise<boolean> => {
    try {
      const res = await boundedFetch(`${evoUrl}/instance/connectionState/${name}`, { headers });
      if (res.status !== 404) return false;
      const d: any = await res.json().catch(() => null);
      return d?.status === 404; // 404 HTML del proxy (container giù) ≠ guard
    } catch {
      return false;
    }
  };

  const tryCall = async (path: string, method: string) => {
    try {
      await boundedFetch(`${evoUrl}${path}`, { method, headers });
    } catch { /* ignore — best effort */ }
  };

  await tryCall(`/instance/logout/${name}`, 'DELETE');
  await sleep(500);
  await tryCall(`/instance/delete/${name}`, 'DELETE');
  await sleep(1500);
  if (await gone()) return true;

  // Escalation best-effort (restart è POST in v2.3.7) — vedi commento sopra.
  await tryCall(`/instance/restart/${name}`, 'POST');
  await sleep(500);
  await tryCall(`/instance/delete/${name}`, 'DELETE');
  await sleep(500);
  return gone();
}
