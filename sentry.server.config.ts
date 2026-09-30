// Sentry server-runtime init. Loaded by instrumentation.ts on Node startup
// when NEXT_RUNTIME === 'nodejs'. Skipped silently if SENTRY_DSN is unset
// — that's the local-dev and pre-DSN-onboarded state.
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend, sentryBeforeBreadcrumb } from './app/lib/sentry-pii';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    // Performance sampling off by default — Free tier 50K events/mo budgets
    // are spent on errors, not traces. Bump when we have headroom.
    tracesSampleRate: 0,
    // PII scrubber runs last in the pipeline (see app/lib/sentry-pii.ts).
    beforeSend: sentryBeforeSend,
    // Decodifica le stringhe URL-encoded prima di ripulirle e toglie la query
    // di findGroupInfos (?groupJid=…) salvata dall'integrazione fetch (D16).
    beforeBreadcrumb: sentryBeforeBreadcrumb,
    sendDefaultPii: false,
  });
}
