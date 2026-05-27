// instrumentation.ts
// Self-calling cron runner — fires every 60s on the Node.js server process
// Next.js 13.4+ automatically executes register() on server startup (not in Edge runtime)
//
// CRON TRIGGER STACK (3 layers, by design — see CLAUDE.md "Monitoring"):
//   1. cron-job.org pinger @60s  → primary (external, free tier)
//   2. This self-cron @60s       → fallback when cron-job.org is down or
//                                  while the deployed lambda is warming up
//   3. vercel.json @0 0 * * *    → daily safety net (handles cleanup tasks
//                                  + catches anything stuck for >24h)
//
// Doubling up #1 and #2 is intentional. The atomic lock in
// app/api/cron/send-messages/route.ts ("Atomic lock: claim message before
// sending") prevents double-firing on the same scheduled_message row — only
// the first claimer flips status pending → processing → sent.
//
// If you ever disable one of these triggers, audit:
//   - cron-job.org panel: is the ping still firing?
//   - Vercel logs: is `[instrumentation]` line present at boot?
//   - audit_events table: gaps in event_type='message_sent' rows?

export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return; // only run in Node.js runtime

  const CRON_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/cron/send-messages';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  const INTERVAL_MS = 60 * 1000; // every 60 seconds

  console.log('[instrumentation] Cron self-runner starting — interval:', INTERVAL_MS, 'ms');
  console.log('[instrumentation] Cron URL:', CRON_URL);

  // Initial delay of 10s to let the server fully boot
  await new Promise(r => setTimeout(r, 10000));

  async function runCron() {
    try {
      const url = CRON_URL + (CRON_SECRET ? `?secret=${CRON_SECRET}` : '');
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(30000) });
      const data = await res.json().catch(() => ({}));
      console.log(`[cron-runner] ${new Date().toISOString()} status=${res.status} sent=${data.sent ?? '?'} failed=${data.failed ?? '?'} pending=${data.skipped ?? '?'}`);
    } catch (err: any) {
      console.error('[cron-runner] Error:', err.message);
    }
  }

  // Fire immediately then every INTERVAL_MS
  runCron();
  setInterval(runCron, INTERVAL_MS);
}
