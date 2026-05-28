// Sentry server-runtime init. Loaded by instrumentation.ts on Node startup
// when NEXT_RUNTIME === 'nodejs'. Skipped silently if SENTRY_DSN is unset
// — that's the local-dev and pre-DSN-onboarded state.
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend } from './app/lib/sentry-pii';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
    // Performance sampling off by default — Free tier 50K events/mo budgets
    // are spent on errors, not traces. Bump when we have headroom.
    tracesSampleRate: 0,
    // PII scrubber runs last in the pipeline (see app/lib/sentry-pii.ts).
    beforeSend: sentryBeforeSend,
    beforeBreadcrumb: (breadcrumb) => {
      if (breadcrumb.message) breadcrumb.message = sentryBeforeSend({ m: breadcrumb.message }).m;
      if (breadcrumb.data) breadcrumb.data = sentryBeforeSend(breadcrumb.data);
      return breadcrumb;
    },
    sendDefaultPii: false,
  });
}
