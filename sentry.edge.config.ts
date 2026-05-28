// Sentry edge-runtime init. Loaded by instrumentation.ts when
// NEXT_RUNTIME === 'edge'. Same scrubbing as server config.
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend } from './app/lib/sentry-pii';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,
    beforeSend: sentryBeforeSend,
    beforeBreadcrumb: (breadcrumb) => {
      if (breadcrumb.message) breadcrumb.message = sentryBeforeSend({ m: breadcrumb.message }).m;
      if (breadcrumb.data) breadcrumb.data = sentryBeforeSend(breadcrumb.data);
      return breadcrumb;
    },
    sendDefaultPii: false,
  });
}
