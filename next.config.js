const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    typescript: {
          ignoreBuildErrors: true,
    },
    images: {
          unoptimized: true,
          // Whitelist WhatsApp's profile picture CDN. ContactAvatar loads
          // these URLs (cached in whatsapp_contacts.profile_pic_url) directly
          // as <img src>. Inert today because of `unoptimized: true`, but
          // documented so future next/image migrations or CSP additions
          // already have it covered.
          remotePatterns: [
              { protocol: 'https', hostname: 'pps.whatsapp.net' },
          ],
    },
    env: {
          SYSTEM_STATUS: process.env.SYSTEM_STATUS || 'active',
    },
}

// Sentry build-time wrapper. Source map upload is gated by SENTRY_AUTH_TOKEN
// — when unset (local dev + first-deploy-before-Andrea-onboards-Sentry),
// withSentryConfig is a passthrough.
module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    // Avoid ad-blocker drops by tunneling client SDK ingest through our own
    // domain. Disable by removing this line if you'd rather hit Sentry direct.
    tunnelRoute: '/monitoring',
})
