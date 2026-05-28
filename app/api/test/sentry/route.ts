import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export const dynamic = 'force-dynamic';

// Manual-only connectivity check for Sentry. Gated behind CRON_SECRET so
// external callers can't burn the Sentry event budget.
//
// Why explicit captureException + flush instead of `throw new Error(...)`:
//   - In Next.js App Router on serverless (Vercel), an unhandled throw inside
//     a route handler returns a 500 immediately. Sentry's transport is async
//     and batches HTTP delivery, so the lambda can freeze before the queued
//     event leaves the process — the dashboard never sees it.
//   - Sentry's `onRequestError` instrumentation export (instrumentation.ts)
//     only fires on Next.js 15+. We're on 14.2.15, so that path is a no-op.
//   - `await Sentry.flush(2000)` blocks until the transport ack'd everything
//     or 2s elapses. The boolean it returns is our smoking gun for delivery.
//
// PII scrubber check: the synthetic message embeds a fake phone + email + JID
// — confirm they appear as [REDACTED_*] in the Sentry event UI.
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dsnSet = Boolean(process.env.SENTRY_DSN);
  const initialized = typeof Sentry.isInitialized === 'function' ? Sentry.isInitialized() : null;

  if (!dsnSet) {
    return NextResponse.json({
      status: 'sentry_disabled',
      sentry_initialized: initialized,
      dsn_set: false,
      hint: 'SENTRY_DSN is unset on this deployment — nothing was sent to Sentry',
    });
  }

  if (initialized === false) {
    return NextResponse.json({
      status: 'sentry_not_initialized',
      sentry_initialized: false,
      dsn_set: true,
      hint: 'SENTRY_DSN is set but Sentry.init() never ran. Likely causes: ' +
            '(a) malformed DSN string, (b) instrumentation.ts register() not invoked, ' +
            '(c) sentry.server.config.ts threw at import time. Check Vercel build logs.',
    }, { status: 500 });
  }

  const err = new Error(
    'Sentry connectivity test — phone=393331234567 email=demo@example.com jid=393331234567@s.whatsapp.net'
  );

  const eventId = Sentry.captureException(err);
  const flushed = await Sentry.flush(2000);

  return NextResponse.json({
    status: 'captured',
    sentry_initialized: initialized,
    dsn_set: true,
    event_id: eventId,
    flushed,
    hint: flushed
      ? 'Event handed off to Sentry transport and flushed within 2s — verify on the dashboard within ~30s'
      : 'Sentry.flush(2000) returned false — transport did not drain in time, event may or may not be delivered',
  });
}
