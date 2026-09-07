/**
 * UNICA lista degli eventi Evolution sottoscritti al webhook. Prima viveva in
 * tre copie (auth/init, connect, lib/evolution/client) e due erano sbagliate:
 * includevano MESSAGING_HISTORY_SET, che NON è nell'enum v2 e fa rispondere
 * 400 a /webhook/set (la config intera non viene applicata, in silenzio).
 *
 * MESSAGES_UPDATE (7 set 2026): senza, le ricevute (SERVER_ACK / DELIVERED /
 * READ) non arrivano MAI — le spunte in dashboard erano strutturalmente
 * assenti, non "perse" (0 eventi su 248 il 6 set). Il webhook le gestisce da
 * maggio; mancava solo la sottoscrizione.
 */
export const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'CONTACTS_SET',
  'CONTACTS_UPSERT',
  'CONTACTS_UPDATE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
];

/** Body di POST /webhook/set (schema v2.3.7: root `webhook` obbligatoria, chiavi byEvents/base64). */
export function buildWebhookSetBody(): { webhook: Record<string, unknown> } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://whatslaterpush.vercel.app';
  const secret = process.env.WEBHOOK_SECRET || '';
  return {
    webhook: {
      enabled: true,
      url: `${appUrl}/api/webhook`,
      byEvents: false,
      base64: false,
      events: WEBHOOK_EVENTS,
      ...(secret ? { headers: { 'x-webhook-secret': secret } } : {}),
    },
  };
}

/**
 * Auto-riparazione: riallinea la config webhook di TUTTE le istanze aperte
 * alla lista corrente (idempotente). Chiamata dal daily-report delle 06:00 UTC:
 * così un evento aggiunto qui (MESSAGES_UPDATE) arriva anche alle istanze
 * collegate mesi fa, senza re-pairing e senza toccare Coolify a mano.
 * Best-effort: un'istanza che fallisce non blocca le altre. WEBHOOK_SELFHEAL_DISABLED=true la spegne.
 */
export async function refreshWebhooksForOpenInstances(
  supabase: { from: (t: string) => any },
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: number; failed: number; skipped: boolean }> {
  if (process.env.WEBHOOK_SELFHEAL_DISABLED === 'true') return { ok: 0, failed: 0, skipped: true };
  const evoUrl = process.env.EVOLUTION_API_URL;
  const evoKey = process.env.EVOLUTION_API_KEY;
  if (!evoUrl || !evoKey) return { ok: 0, failed: 0, skipped: true };
  const { data, error } = await supabase
    .from('user_instances')
    .select('instance_name')
    .eq('connection_status', 'open');
  if (error) throw error;
  const body = JSON.stringify(buildWebhookSetBody());
  let ok = 0, failed = 0;
  for (const row of (data || []) as { instance_name: string }[]) {
    if (!row.instance_name) continue;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetchImpl(`${evoUrl}/webhook/set/${row.instance_name}`, {
        method: 'POST',
        headers: { apikey: evoKey, 'Content-Type': 'application/json' },
        body,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) ok++; else { failed++; console.warn('[webhook-selfheal] ' + row.instance_name + ' → HTTP ' + res.status); }
    } catch (e) {
      failed++;
      console.warn('[webhook-selfheal] ' + row.instance_name + ' → ' + ((e as any)?.message || e));
    }
  }
  return { ok, failed, skipped: false };
}
