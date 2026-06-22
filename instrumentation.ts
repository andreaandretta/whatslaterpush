// instrumentation.ts
// Two responsibilities executed by Next.js on server startup:
//   1. Sentry SDK init (server + edge runtimes)
//   2. Self-calling cron runner @60s (Node-runtime only)
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
//
// Sentry note: init is gated by SENTRY_DSN inside the runtime configs, so
// missing-DSN dev environments just skip silently.

import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
    return; // edge has no setInterval — self-cron skipped
  }

  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // only run cron in Node runtime

  const CRON_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000') + '/api/cron/send-messages';
  const CRON_SECRET = process.env.CRON_SECRET || '';
  const INTERVAL_MS = 60 * 1000; // every 60 seconds

  console.log('[instrumentation] Cron self-runner starting — interval:', INTERVAL_MS, 'ms');
  console.log('[instrumentation] Cron URL:', CRON_URL);

  // Initial delay of 10s to let the server fully boot
  await new Promise(r => setTimeout(r, 10000));

  // Stagger to the :30 mark so this self-cron does NOT fire simultaneously with
  // the cron-job.org pinger (which hits :00). Same 60s cadence + redundancy, but
  // the two triggers now land ~30s apart instead of colliding at :00 — removing
  // the simultaneous double-claim race at the source. (The send_attempted_at gate
  // in send-messages is the safety net; this just reduces how often two
  // invocations race at all — see the 2026-06-22 double-delivery.)
  {
    const now = new Date();
    let delay = ((30 - now.getUTCSeconds() + 60) % 60) * 1000 - now.getUTCMilliseconds();
    if (delay < 0) delay += 60_000;
    await new Promise(r => setTimeout(r, delay));
  }

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

// Exported per Sentry v10 contract — captures errors thrown in App Router
// route handlers, Server Components, etc. No-op when SDK isn't initialized.
export const onRequestError = Sentry.captureRequestError;
