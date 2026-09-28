/**
 * Stato VERO di un'istanza, letto da Evolution (GET /instance/connectionState).
 *
 * Perché esiste (audit 25 set 2026): connection_status in user_instances lo
 * scrive SOLO il webhook CONNECTION_UPDATE. Se quella scrittura fallisce
 * (Supabase in Gateway Timeout, 9-14 set) il webhook risponde 200 lo stesso,
 * Evolution non ritrasmette e il DB resta sbagliato fino al prossimo evento:
 *  - DB 'open', socket chiuso (un 401 di logout non ha eventi successivi): ogni
 *    promemoria brucia 3 retry generici e finisce 'failed';
 *  - DB 'close', WhatsApp funziona: tutto trattenuto e il banner rosso spinge a
 *    un re-pair inutile (logout + nuovo device = segnale di ban).
 *
 * Mai un polling per-minuto di tutte le istanze: si legge UNA istanza quando un
 * invio fallisce con un errore da disconnessione (cron) e tutte una volta al
 * giorno (daily-report). Nessun messaggio parte da qui: è una GET di stato.
 */

export type LiveConnectionStatus = 'open' | 'close' | 'connecting';

/** Stessa mappa di handleConnectionUpdate nel webhook. Ignoto → null. */
export function mapEvolutionState(state: unknown): LiveConnectionStatus | null {
  const s = typeof state === 'string' ? state : '';
  if (s === 'open' || s === 'connected') return 'open';
  if (s === 'close' || s === 'disconnected' || s === 'logged_out') return 'close';
  if (s === 'connecting' || s === 'qr') return 'connecting';
  return null;
}

const STATE_TIMEOUT_MS = 3000;

/**
 * Best-effort: null su qualsiasi dubbio (rete, 401 apikey, 404 istanza sparita,
 * 5xx, JSON strano). Chi chiama NON scrive nulla su null.
 */
export async function fetchEvolutionState(instanceName: string, fetchImpl: typeof fetch = fetch): Promise<LiveConnectionStatus | null> {
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey || !instanceName) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), STATE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${evoUrl}/instance/connectionState/${instanceName}`, {
      method: 'GET',
      headers: { apikey: evoKey },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body: any = await res.json().catch(() => null);
    return mapEvolutionState(body?.instance?.state ?? body?.state);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Riallinea connection_status di tutte le istanze allo stato di Evolution, in
 * entrambe le direzioni. Chiamata dal daily-report PRIMA dell'auto-riparazione
 * webhook, così un'istanza rimasta 'close' per errore ma in realtà aperta
 * riceve anche la config webhook aggiornata. CONNECTION_RECONCILE_DISABLED=true
 * la spegne.
 */
export async function reconcileInstanceStates(
  supabase: { from: (t: string) => any },
  fetchImpl: typeof fetch = fetch,
): Promise<{ checked: number; fixed: number; unknown: number; skipped: boolean }> {
  if (process.env.CONNECTION_RECONCILE_DISABLED === 'true') return { checked: 0, fixed: 0, unknown: 0, skipped: true };
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return { checked: 0, fixed: 0, unknown: 0, skipped: true };
  const { data, error } = await supabase
    .from('user_instances')
    .select('instance_name, connection_status')
    .not('instance_name', 'is', null)
    .limit(200);
  if (error) throw error;
  const rows = ((data || []) as Array<{ instance_name: string; connection_status: string | null }>).filter((r) => r.instance_name);
  let fixed = 0, unknown = 0;
  // In parallelo: poche istanze, 3 s di timeout ciascuna, e il daily-report
  // non deve sforare il suo budget per colpa di un'istanza lenta.
  const live = await Promise.all(rows.map((r) => fetchEvolutionState(r.instance_name, fetchImpl)));
  for (let i = 0; i < rows.length; i++) {
    const state = live[i];
    if (!state) { unknown++; continue; }
    if (state === rows[i].connection_status) continue;
    // Compare-and-set sul valore letto PRIMA della GET (review fase 1b): tra
    // la lettura e questa scrittura passano fino a 3 s, e se nel frattempo il
    // webhook ha scritto un 'open' fresco, un 'connecting' letto prima lo
    // sovrascriverebbe — e nessun altro evento arriva finché resta collegato.
    // Se la riga è cambiata, vince il webhook: 0 righe toccate.
    const prev = rows[i].connection_status;
    const base = supabase
      .from('user_instances')
      .update({ connection_status: state })
      .eq('instance_name', rows[i].instance_name);
    const { data: touched, error: updErr } = await (prev == null
      ? base.is('connection_status', null)
      : base.eq('connection_status', prev)
    ).select('instance_name');
    if (updErr) {
      console.warn('[connection-reconcile] ' + rows[i].instance_name + ' update failed: ' + updErr.message);
      continue;
    }
    if (Array.isArray(touched) && touched.length === 0) {
      console.log('[connection-reconcile] ' + rows[i].instance_name + ': stato cambiato durante il controllo, lascio quello del webhook');
      continue;
    }
    console.log('[connection-reconcile] ' + rows[i].instance_name + ': ' + (rows[i].connection_status || 'null') + ' → ' + state);
    fixed++;
  }
  return { checked: rows.length, fixed, unknown, skipped: false };
}
