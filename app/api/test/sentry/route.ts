import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Manual-only sanity check that Sentry is wired up correctly. Gated behind
// CRON_SECRET so external callers can't DoS the Sentry event budget.
// Expected workflow after onboarding the DSN:
//   1. curl 'https://app.url/api/test/sentry?secret=$CRON_SECRET'
//   2. Watch Sentry dashboard → an event named "Sentry connectivity test"
//      should land within ~30s.
//
// PII scrubber check: the thrown error message embeds a fake phone + email
// + JID — verify they appear as [REDACTED_*] in the Sentry event UI.
export async function GET(req: NextRequest) {
  const secret = new URL(req.url).searchParams.get('secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.SENTRY_DSN) {
    return NextResponse.json({
      status: 'sentry_disabled',
      hint: 'SENTRY_DSN is unset — error will be thrown locally but not reported to Sentry',
    });
  }

  // Intentional throw — the message contains synthetic PII the scrubber
  // must strip before the event leaves the process.
  throw new Error(
    'Sentry connectivity test — phone=393331234567 email=demo@example.com jid=393331234567@s.whatsapp.net'
  );
}
