/**
 * Client Supabase service-role, in UN SOLO posto.
 *
 * Prima esisteva in 36 copie sparse per le route, in 7 varianti diverse: 5 di
 * queste avevano ancora il fallback alla chiave ANON che era stato
 * deliberatamente rimosso altrove (vedi il commento storico in
 * `api/messages/route.ts`). Con le copie sparse, una decisione di sicurezza
 * presa una volta non raggiunge i file scritti dopo — questo file esiste per
 * impedire che succeda di nuovo.
 *
 * Restano FUORI dal helper, di proposito (4 casi, ognuno con un motivo):
 *  - `api/webhook/route.ts` e `api/cron/send-messages/route.ts`: hot path,
 *    client a livello di modulo / firma propria; si toccano solo con un
 *    motivo funzionale, non per pulizia.
 *  - `lib/droplet.ts`: passa un fetch `cache: 'no-store'` custom (bug della
 *    Next Data Cache documentato lì).
 *  - `lib/audit.ts`: best-effort con warn-e-salta e ancora col fallback anon
 *    (DA-RIVEDERE: probabilmente va su getSupabaseAdminOrNull).
 *
 * Regola: MAI il fallback su anon key. Le route service-role scrivono su
 * tabelle protette da RLS; con la anon key fallirebbero in modo silenzioso e
 * confuso invece di dire subito cosa manca.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function url(): string | undefined {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
}

/**
 * Client service-role. Fallisce subito e a voce alta se manca la
 * configurazione: meglio un errore chiaro all'ingresso della route che una
 * query che ritorna zero righe senza spiegazioni.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const u = url();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!u) throw new Error('Missing SUPABASE_URL');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY required (anon-role fallback removed)');
  return createClient(u, key);
}

/**
 * Variante per i chiamanti che sanno gestire l'assenza di configurazione
 * (monitoring, metriche host): ritorna null invece di lanciare.
 */
export function getSupabaseAdminOrNull(): SupabaseClient | null {
  const u = url();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!u || !key) return null;
  return createClient(u, key);
}
