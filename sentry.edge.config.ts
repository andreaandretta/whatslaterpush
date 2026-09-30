// Sentry edge-runtime init. Loaded by instrumentation.ts when
// NEXT_RUNTIME === 'edge'. Same scrubbing as server config.
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend, sentryBeforeBreadcrumb } from './app/lib/sentry-pii';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
    beforeSend: sentryBeforeSend,
    // Decodifica le stringhe URL-encoded prima di ripulirle e toglie la query
    // di findGroupInfos (?groupJid=…) salvata dall'integrazione fetch (D16).
    beforeBreadcrumb: sentryBeforeBreadcrumb,
    sendDefaultPii: false,
  });
}
