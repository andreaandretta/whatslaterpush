// Sentry browser-runtime init. Auto-loaded by Next.js when
// @sentry/nextjs is installed. Skipped silently if NEXT_PUBLIC_SENTRY_DSN
// is unset — local dev and pre-DSN-onboarded state.
import * as Sentry from '@sentry/nextjs';
import { sentryBeforeSend } from './app/lib/sentry-pii';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || 'production',
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend: sentryBeforeSend,
    beforeBreadcrumb: (breadcrumb) => {
      if (breadcrumb.message) breadcrumb.message = sentryBeforeSend({ m: breadcrumb.message }).m;
      if (breadcrumb.data) breadcrumb.data = sentryBeforeSend(breadcrumb.data);
      return breadcrumb;
    },
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
