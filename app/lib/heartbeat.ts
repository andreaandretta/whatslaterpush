// Task 56 (backlog #6): battito per ogni cron. Prima di questo, solo
// send-messages scriveva su ops_heartbeat: un cron collaterale morto in
// silenzio (com'è successo per SETTIMANE ai tre cron con l'auth rotta, hotfix
// c9fe33a) non veniva notato da nessuno. Ogni cron ora timbra all'ingresso;
// checkCollateralCrons in monitoring.ts confronta i timbri con la cadenza
// attesa e avvisa quando un battito manca.
import { createClient } from '@supabase/supabase-js';

export async function stampHeartbeat(name: string): Promise<void> {
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await supabase.from('ops_heartbeat').upsert(
      { name, ts: new Date().toISOString() },
      { onConflict: 'name' }
    );
  } catch {
    // best effort: il battito non deve mai rompere il cron che lo emette
  }
}
